-- ============================================================================
-- Tallymark V2 Slice 4 Migration (008): Receivables Sync, Reminders & Indexes
--
-- Design rules:
--   - Additive only on top of 005, 006, and 007.
--   - Transactional and idempotent.
--   - All SECURITY DEFINER functions use fixed search_path = public,
--     schema-qualified objects, validated arguments, no dynamic SQL, and
--     explicitly REVOKE EXECUTE FROM PUBLIC.
--   - Keeps V1 part-paid receipts and credit sales synced in public.debts so
--     source filters, ageing buckets, reminders, and statements work across
--     all receivables uniformly without altering V1 tables.
-- ============================================================================

begin;

-- 1. Helpful indexes for receivables filtering and 3-day reminder lookup
create index if not exists idx_payment_reminders_debt_sent
  on public.payment_reminders(business_id, debt_id, sent_at desc);

create index if not exists idx_debts_business_source_status
  on public.debts(business_id, source_type, status);

-- 2. Sync owner's V1 part-paid receipts and credit sales into unified public.debts
create or replace function public.v2_sync_legacy_debts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz_id uuid;
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;

  select id into v_biz_id from public.businesses where owner_id = v_uid;
  if not found then
    raise exception 'Business not found';
  end if;

  -- Upsert part-paid V1 SALE receipts into public.debts
  insert into public.debts (
    business_id, source_type, source_id, reference_number,
    customer_id, customer_name, customer_phone,
    issue_date, due_date, total_kobo, amount_paid_kobo, written_off_kobo,
    balance_due_kobo, status, created_at, updated_at
  )
  select
    r.business_id,
    'RECEIPT',
    r.id,
    coalesce(r.receipt_number, ''),
    (
      select c.id from public.customers c
      where c.business_id = r.business_id
        and lower(c.name) = lower(coalesce(r.customer_name, ''))
      limit 1
    ),
    coalesce(nullif(trim(r.customer_name), ''), 'Walk-in Customer'),
    coalesce(r.customer_phone, ''),
    r.issued_date_lagos,
    null,
    r.total_kobo,
    r.amount_paid_kobo,
    0,
    greatest(0, r.balance_due_kobo),
    case
      when r.status = 'VOID' then 'VOID'
      when r.balance_due_kobo <= 0 then 'PAID'
      when r.amount_paid_kobo > 0 then 'PART_PAID'
      else 'OPEN'
    end,
    coalesce(r.issued_at, now()),
    now()
  from public.receipts r
  where r.business_id = v_biz_id
    and r.receipt_kind = 'SALE'
    and (r.status = 'PART_PAID' or exists (
      select 1 from public.debts d
      where d.source_type = 'RECEIPT' and d.source_id = r.id
    ))
  on conflict (source_type, source_id) do update
    set amount_paid_kobo = excluded.amount_paid_kobo,
        balance_due_kobo = excluded.balance_due_kobo,
        status = excluded.status,
        updated_at = now();

  get diagnostics v_count = row_count;

  -- Upsert V1 credit_sales into public.debts
  insert into public.debts (
    business_id, source_type, source_id, reference_number,
    customer_id, customer_name, customer_phone,
    issue_date, due_date, total_kobo, amount_paid_kobo, written_off_kobo,
    balance_due_kobo, status, created_at, updated_at
  )
  select
    cs.business_id,
    'CREDIT_SALE',
    cs.id,
    case
      when coalesce(trim(cs.item_note), '') <> '' then 'Credit · ' || left(trim(cs.item_note), 32)
      else 'Credit · ' || cs.entry_date::text
    end,
    (
      select c.id from public.customers c
      where c.business_id = cs.business_id
        and lower(c.name) = lower(coalesce(cs.customer_name, ''))
      limit 1
    ),
    coalesce(nullif(trim(cs.customer_name), ''), 'Walk-in Customer'),
    coalesce(cs.customer_phone, ''),
    cs.entry_date,
    cs.due_date,
    cs.total_kobo,
    cs.amount_paid_kobo,
    0,
    greatest(0, cs.balance_due_kobo),
    case
      when cs.status = 'VOID' then 'VOID'
      when cs.status = 'PAID' or cs.balance_due_kobo <= 0 then 'PAID'
      when cs.amount_paid_kobo > 0 then 'PART_PAID'
      else 'OPEN'
    end,
    coalesce(cs.created_at, now()),
    now()
  from public.credit_sales cs
  where cs.business_id = v_biz_id
    and (cs.status in ('UNPAID', 'PART_PAID') or exists (
      select 1 from public.debts d
      where d.source_type = 'CREDIT_SALE' and d.source_id = cs.id
    ))
  on conflict (source_type, source_id) do update
    set amount_paid_kobo = excluded.amount_paid_kobo,
        balance_due_kobo = excluded.balance_due_kobo,
        status = excluded.status,
        due_date = excluded.due_date,
        updated_at = now();

  return v_count;
end;
$$;
revoke all on function public.v2_sync_legacy_debts() from public;
grant execute on function public.v2_sync_legacy_debts() to authenticated;

-- 3. Log a WhatsApp payment reminder with 3-day duplicate check and audit entry
create or replace function public.v2_log_reminder(
  p_debt_id uuid,
  p_tone text default 'gentle',
  p_channel text default 'whatsapp'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz_id uuid;
  v_debt public.debts%rowtype;
  v_tone text := case when lower(coalesce(p_tone, 'gentle')) = 'firm' then 'firm' else 'gentle' end;
  v_channel text := 'whatsapp';
  v_prev_sent timestamptz;
  v_warned_recent boolean := false;
  v_rem public.payment_reminders%rowtype;
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;

  select id into v_biz_id from public.businesses where owner_id = v_uid;
  if not found then
    raise exception 'Business not found';
  end if;

  select * into v_debt
  from public.debts
  where id = p_debt_id and business_id = v_biz_id;

  if not found then
    raise exception 'Balance record not found';
  end if;

  if v_debt.balance_due_kobo <= 0 or v_debt.status not in ('OPEN', 'PART_PAID') then
    raise exception 'This balance is already closed';
  end if;

  select sent_at into v_prev_sent
  from public.payment_reminders
  where business_id = v_biz_id and debt_id = v_debt.id
  order by sent_at desc
  limit 1;

  if v_prev_sent is not null and (now() - v_prev_sent) < interval '3 days' then
    v_warned_recent := true;
  end if;

  insert into public.payment_reminders (
    business_id, debt_id, customer_id, tone, channel, sent_at, sent_by
  ) values (
    v_biz_id, v_debt.id, v_debt.customer_id, v_tone, v_channel, now(), v_uid
  )
  returning * into v_rem;

  insert into public.audit_log (
    business_id, actor_id, action, entity_type, entity_id, metadata_json
  ) values (
    v_biz_id,
    v_uid,
    'reminder_sent',
    'debt',
    v_debt.id,
    jsonb_build_object(
      'tone', v_tone,
      'channel', v_channel,
      'reference_number', v_debt.reference_number,
      'warned_recent', v_warned_recent
    )
  );

  return jsonb_build_object(
    'reminder', jsonb_build_object(
      'id', v_rem.id,
      'businessId', v_rem.business_id,
      'debtId', v_rem.debt_id,
      'customerId', v_rem.customer_id,
      'tone', v_rem.tone,
      'channel', v_rem.channel,
      'sentAt', v_rem.sent_at,
      'sentBy', v_rem.sent_by
    ),
    'warnedRecent', v_warned_recent,
    'previousReminderAt', v_prev_sent
  );
end;
$$;
revoke all on function public.v2_log_reminder(uuid, text, text) from public;
grant execute on function public.v2_log_reminder(uuid, text, text) to authenticated;

-- Ask PostgREST to reload schema cache
select pg_notify('pgrst', 'reload schema');

commit;
