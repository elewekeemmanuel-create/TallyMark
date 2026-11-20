-- ============================================================================
-- Tallymark V2 Slice 2 Migration (006): Customer "I've Paid" Claims & Push RPCs
--
-- Design rules:
--   - Additive only on top of 005_v2_quotations_invoices.sql.
--   - Transactional and idempotent.
--   - All SECURITY DEFINER functions use fixed search_path = public,
--     schema-qualified objects, validated arguments, no dynamic SQL, and
--     explicitly REVOKE EXECUTE FROM PUBLIC.
--   - Claim confirmation ALWAYS runs public.record_payment() atomically.
--   - Rejection reasons are strictly private and NEVER returned by get_public_invoice.
-- ============================================================================

begin;

-- 1. Update get_public_invoice to expose ONLY non-PII pending/rejected status flags (never decision_reason)
create or replace function public.get_public_invoice(p_public_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invoices%rowtype;
  v_payments jsonb;
  v_today_lagos date := (now() at time zone 'Africa/Lagos')::date;
  v_is_overdue boolean;
  v_pending_claims integer := 0;
  v_has_rejected_claim boolean := false;
  v_latest_pending_ref text := null;
begin
  if p_public_id is null or char_length(trim(p_public_id)) < 16 or char_length(trim(p_public_id)) > 64 then
    return null;
  end if;

  select * into v_inv
  from public.invoices
  where public_id = trim(p_public_id)
    and status <> 'DRAFT'
    and snapshot_json is not null;

  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'paymentDate', p.payment_date,
      'amountKobo', p.amount_kobo,
      'paymentMethod', p.payment_method,
      'receiptNumber', r.receipt_number,
      'receiptPublicId', r.public_id
    ) order by p.payment_date asc, p.created_at asc
  ), '[]'::jsonb)
  into v_payments
  from public.payments p
  left join public.receipts r on r.id = p.receipt_id
  where p.invoice_id = v_inv.id and p.is_voided = false;

  select count(*) into v_pending_claims
  from public.payment_claims
  where invoice_id = v_inv.id and status = 'PENDING';

  select claim_ref into v_latest_pending_ref
  from public.payment_claims
  where invoice_id = v_inv.id and status = 'PENDING'
  order by created_at desc
  limit 1;

  select exists(
    select 1 from public.payment_claims
    where invoice_id = v_inv.id and status = 'REJECTED'
  ) into v_has_rejected_claim;

  v_is_overdue := (v_inv.status in ('SENT', 'PART_PAID') and v_inv.balance_due_kobo > 0 and v_today_lagos > v_inv.due_date);

  return jsonb_build_object(
    'publicId', v_inv.public_id,
    'status', v_inv.status,
    'isOverdue', v_is_overdue,
    'amountPaidKobo', v_inv.amount_paid_kobo,
    'writtenOffKobo', v_inv.written_off_kobo,
    'balanceDueKobo', v_inv.balance_due_kobo,
    'sentAt', v_inv.sent_at,
    'voidReason', v_inv.void_reason,
    'voidedAt', v_inv.voided_at,
    'pendingClaimsCount', v_pending_claims,
    'latestPendingClaimRef', v_latest_pending_ref,
    'hasRejectedClaim', v_has_rejected_claim,
    'snapshot', v_inv.snapshot_json,
    'payments', v_payments
  );
end;
$$;
revoke all on function public.get_public_invoice(text) from public;
grant execute on function public.get_public_invoice(text) to anon, authenticated;

-- 2. Confirm a pending payment claim: atomically runs record_payment(), issues receipt, updates claim, logs audit
create or replace function public.v2_confirm_claim(
  p_claim_id uuid,
  p_amount_kobo bigint default null,
  p_method text default 'Transfer',
  p_payment_date date default null,
  p_reference text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz public.businesses%rowtype;
  v_claim public.payment_claims%rowtype;
  v_debt public.debts%rowtype;
  v_pay_amount bigint;
  v_pay_ref text;
  v_idem text;
  v_pay_result jsonb;
  v_payment_id uuid;
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid;
  if not found then
    raise exception 'Business not found';
  end if;

  select * into v_claim
  from public.payment_claims
  where id = p_claim_id and business_id = v_biz.id
  for update;

  if not found then
    raise exception 'Payment claim not found';
  end if;

  if v_claim.status <> 'PENDING' then
    raise exception 'This payment report has already been decided';
  end if;

  select * into v_debt
  from public.debts
  where business_id = v_biz.id
    and source_type = 'INVOICE'
    and source_id = v_claim.invoice_id
  for update;

  if not found then
    raise exception 'Invoice receivable record not found';
  end if;

  v_pay_amount := coalesce(p_amount_kobo, v_claim.amount_kobo);
  v_pay_ref := left(trim(coalesce(p_reference, v_claim.reference, '')), 80);
  v_idem := coalesce(nullif(trim(coalesce(p_idempotency_key, '')), ''), 'claim-confirm-' || v_claim.id::text);

  v_pay_result := public.record_payment(
    v_debt.id,
    v_pay_amount,
    coalesce(nullif(trim(coalesce(p_method, '')), ''), 'Transfer'),
    coalesce(p_payment_date, (now() at time zone 'Africa/Lagos')::date),
    v_pay_ref,
    v_idem
  );

  v_payment_id := (v_pay_result -> 'payment' ->> 'id')::uuid;

  update public.payment_claims
  set
    status = 'CONFIRMED',
    decided_at = now(),
    decided_by = v_uid,
    payment_id = v_payment_id
  where id = v_claim.id
  returning * into v_claim;

  perform public.v2_log_audit(
    v_biz.id,
    v_uid,
    'claim_confirmed',
    'payment_claim',
    v_claim.id,
    jsonb_build_object(
      'claim_ref', v_claim.claim_ref,
      'invoice_id', v_claim.invoice_id,
      'confirmed_amount_kobo', v_pay_amount,
      'payment_id', v_payment_id
    )
  );

  return jsonb_build_object(
    'claim', to_jsonb(v_claim),
    'payment', v_pay_result -> 'payment',
    'receipt', v_pay_result -> 'receipt',
    'debt', v_pay_result -> 'debt'
  );
end;
$$;
revoke all on function public.v2_confirm_claim(uuid, bigint, text, date, text, text) from public;
grant execute on function public.v2_confirm_claim(uuid, bigint, text, date, text, text) to authenticated;

-- 3. Reject a pending payment claim: stores private reason, never creates money entry, logs audit
create or replace function public.v2_reject_claim(
  p_claim_id uuid,
  p_reason text
)
returns public.payment_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz public.businesses%rowtype;
  v_claim public.payment_claims%rowtype;
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception 'Enter a short private reason (at least 3 characters)';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid;
  if not found then
    raise exception 'Business not found';
  end if;

  select * into v_claim
  from public.payment_claims
  where id = p_claim_id and business_id = v_biz.id
  for update;

  if not found then
    raise exception 'Payment claim not found';
  end if;

  if v_claim.status <> 'PENDING' then
    raise exception 'This payment report has already been decided';
  end if;

  update public.payment_claims
  set
    status = 'REJECTED',
    decision_reason = left(trim(p_reason), 240),
    decided_at = now(),
    decided_by = v_uid
  where id = v_claim.id
  returning * into v_claim;

  perform public.v2_log_audit(
    v_biz.id,
    v_uid,
    'claim_rejected',
    'payment_claim',
    v_claim.id,
    jsonb_build_object(
      'claim_ref', v_claim.claim_ref,
      'invoice_id', v_claim.invoice_id
    )
  );

  return v_claim;
end;
$$;
revoke all on function public.v2_reject_claim(uuid, text) from public;
grant execute on function public.v2_reject_claim(uuid, text) to authenticated;

-- 4. Retention job helper: marks proofs decided > 90 days ago as deleted while keeping claim metadata
-- Callable only by service_role (never authenticated or anon)
create or replace function public.v2_purge_expired_claim_proofs(
  p_cutoff timestamptz default (now() - interval '90 days')
)
returns table(claim_id uuid, business_id uuid, proof_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec record;
begin
  for v_rec in
    select pc.id, pc.business_id, pc.proof_path, pc.claim_ref
    from public.payment_claims pc
    where pc.status in ('CONFIRMED', 'REJECTED')
      and pc.decided_at is not null
      and pc.decided_at <= p_cutoff
      and pc.proof_path is not null
      and pc.proof_deleted_at is null
    for update skip locked
  loop
    update public.payment_claims
    set proof_path = null, proof_deleted_at = now()
    where id = v_rec.id;

    perform public.v2_log_audit(
      v_rec.business_id,
      null,
      'claim_proof_purged',
      'payment_claim',
      v_rec.id,
      jsonb_build_object('claim_ref', v_rec.claim_ref, 'retention_days', 90)
    );

    claim_id := v_rec.id;
    business_id := v_rec.business_id;
    proof_path := v_rec.proof_path;
    return next;
  end loop;
end;
$$;
revoke all on function public.v2_purge_expired_claim_proofs(timestamptz) from public;
revoke all on function public.v2_purge_expired_claim_proofs(timestamptz) from anon, authenticated;

-- Notify PostgREST to reload schema cache
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
end;
$$;

commit;
