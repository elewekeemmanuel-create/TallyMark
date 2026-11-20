-- Tallymark Phase 5: Security Hardening & Lifecycle Integrity Migration
-- Run after 001_phase1a_schema.sql, 002_phase2_cashbook.sql, and 003_analytics_events.sql.

-- 1. Lock down direct table grants on public_receipts (read strictly via get_public_receipt RPC)
revoke all on public.public_receipts from anon, authenticated;

-- 2. Validate VAT rate bounds on businesses
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'businesses_vat_rate_bps_check'
  ) then
    alter table public.businesses
      add constraint businesses_vat_rate_bps_check check (vat_rate_bps between 0 and 5000);
  end if;
end $$;

-- 3. Complete owner-scoped RLS on ledger_entries so client-side Supabase inserts
--    (Quick Sales, Credit Sales, Expenses, Voice Confirm, and Visible Corrections)
--    succeed for the authenticated owner while enforcing strict tenant isolation.
drop policy if exists "Owner inserts own ledger" on public.ledger_entries;
create policy "Owner inserts own ledger" on public.ledger_entries
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and business_id in (select id from public.businesses where owner_id = auth.uid())
  );

-- Only allow updating a ledger row to attach receipt_id (when issuing a receipt from a quick sale).
-- Closed-day and amount immutability remain enforced by trg_enforce_closed_day_ledger.
drop policy if exists "Owner links receipt to own ledger" on public.ledger_entries;
create policy "Owner links receipt to own ledger" on public.ledger_entries
  for update to authenticated
  using (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  )
  with check (
    business_id in (select id from public.businesses where owner_id = auth.uid())
    and receipt_id is not null
  );

-- 4. Re-verify private expense-proofs storage policies (owner UID folder isolation, no overwrite)
drop policy if exists "Owner uploads own expense proofs" on storage.objects;
create policy "Owner uploads own expense proofs" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'expense-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Owner reads own expense proofs" on storage.objects;
create policy "Owner reads own expense proofs" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'expense-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Owner deletes own expense proofs" on storage.objects;
create policy "Owner deletes own expense proofs" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'expense-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 5. Hardened issue_receipt RPC (enforces closed-day lock + populates Phase 2 ledger metadata)
create or replace function public.issue_receipt(
  p_customer_name text default '',
  p_customer_phone text default '',
  p_items jsonb default '[]'::jsonb,
  p_payment_method text default 'Cash',
  p_amount_paid_kobo bigint default 0,
  p_note text default '',
  p_sold_by text default '',
  p_issued_date_lagos date default ((now() at time zone 'Africa/Lagos')::date),
  p_template text default null,
  p_source text default 'manual'
)
returns public.receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz public.businesses%rowtype;
  v_seq integer;
  v_receipt_number text;
  v_public_id text;
  v_item jsonb;
  v_calculated_items jsonb := '[]'::jsonb;
  v_subtotal bigint := 0;
  v_discount_total bigint := 0;
  v_net bigint := 0;
  v_vat bigint := 0;
  v_total bigint := 0;
  v_balance bigint := 0;
  v_status text;
  v_template text;
  v_receipt public.receipts%rowtype;
  v_qty numeric;
  v_unit bigint;
  v_gross bigint;
  v_disc bigint;
  v_line_total bigint;
  v_issued_date date := coalesce(p_issued_date_lagos, (now() at time zone 'Africa/Lagos')::date);
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if p_payment_method not in ('Cash', 'Transfer', 'POS', 'Card', 'Other') then
    raise exception 'Invalid payment method';
  end if;
  if coalesce(p_source, 'manual') not in ('manual', 'voice') then
    raise exception 'Invalid source';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid for update;
  if not found then
    raise exception 'Business onboarding required';
  end if;

  if exists (select 1 from public.day_closures where business_id = v_biz.id and close_date = v_issued_date) then
    raise exception 'Day % is closed. Post a visible correction entry instead.', v_issued_date;
  end if;

  if jsonb_array_length(p_items) < 1 then
    raise exception 'At least one line item is required';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(0.001, (v_item->>'qty')::numeric);
    v_unit := greatest(0, (v_item->>'unitPriceKobo')::bigint);
    v_gross := round(v_qty * v_unit);
    v_disc := least(v_gross, greatest(0, coalesce((v_item->>'discountKobo')::bigint, 0)));
    v_line_total := v_gross - v_disc;

    v_subtotal := v_subtotal + v_gross;
    v_discount_total := v_discount_total + v_disc;

    v_calculated_items := v_calculated_items || jsonb_build_object(
      'description', trim(coalesce(v_item->>'description', '')),
      'qty', v_qty,
      'unitPriceKobo', v_unit,
      'discountKobo', v_disc,
      'grossKobo', v_gross,
      'lineTotalKobo', v_line_total
    );
  end loop;

  v_net := greatest(0, v_subtotal - v_discount_total);
  if v_biz.vat_enabled and v_net > 0 then
    if v_biz.vat_mode = 'exclusive' then
      v_vat := round(v_net * v_biz.vat_rate_bps / 10000.0);
      v_total := v_net + v_vat;
    else
      v_vat := round(v_net * v_biz.vat_rate_bps / (10000.0 + v_biz.vat_rate_bps));
      v_total := v_net;
    end if;
  else
    v_total := v_net;
  end if;

  if p_amount_paid_kobo < 0 or p_amount_paid_kobo > v_total then
    raise exception 'Invalid amount paid';
  end if;

  v_balance := v_total - p_amount_paid_kobo;
  v_status := case when v_balance = 0 then 'PAID' else 'PART_PAID' end;
  v_seq := v_biz.next_sequence;
  v_receipt_number := v_biz.receipt_prefix || lpad(v_seq::text, 4, '0');
  v_public_id := replace(gen_random_uuid()::text, '-', '');
  v_template := coalesce(p_template, v_biz.default_template);

  update public.businesses set next_sequence = next_sequence + 1, updated_at = now() where id = v_biz.id;

  insert into public.receipts (
    business_id, public_id, sequence_number, receipt_number, receipt_kind,
    customer_name, customer_phone, items_json, subtotal_kobo, discount_total_kobo,
    vat_enabled, vat_mode, vat_rate_bps, vat_kobo, total_kobo,
    initial_paid_kobo, amount_paid_kobo, balance_due_kobo, payment_method,
    note, sold_by, source, template, status, issued_date_lagos, created_by
  ) values (
    v_biz.id, v_public_id, v_seq, v_receipt_number, 'SALE',
    coalesce(p_customer_name, ''), coalesce(p_customer_phone, ''), v_calculated_items,
    v_subtotal, v_discount_total, v_biz.vat_enabled, v_biz.vat_mode, v_biz.vat_rate_bps,
    v_vat, v_total, p_amount_paid_kobo, p_amount_paid_kobo, v_balance, p_payment_method,
    coalesce(p_note, ''), coalesce(p_sold_by, ''), coalesce(p_source, 'manual'),
    v_template, v_status, v_issued_date, v_uid
  ) returning * into v_receipt;

  insert into public.ledger_entries (
    business_id, entry_type, entry_kind, amount_kobo, cash_received_kobo, payment_method,
    receipt_id, customer_name, customer_phone, note, sold_by, source, entry_date, created_by
  ) values (
    v_biz.id, 'SALE', 'RECEIPT', v_total, p_amount_paid_kobo, p_payment_method,
    v_receipt.id, coalesce(p_customer_name, ''), coalesce(p_customer_phone, ''),
    coalesce(nullif(p_note, ''), 'Sale ' || v_receipt_number),
    coalesce(p_sold_by, ''), coalesce(p_source, 'manual'), v_issued_date, v_uid
  );

  insert into public.public_receipts (
    public_id, receipt_id, receipt_number, receipt_kind, business_name,
    business_logo_data_url, business_address, business_phone, business_email,
    brand_color, currency, customer_name, customer_phone, items_json,
    subtotal_kobo, discount_total_kobo, vat_enabled, vat_mode, vat_rate_bps,
    vat_kobo, total_kobo, amount_paid_kobo, balance_due_kobo, payment_method,
    note, sold_by, template, status, issued_date_lagos, issued_at
  ) values (
    v_public_id, v_receipt.id, v_receipt_number, 'SALE', v_biz.name,
    v_biz.logo_data_url, v_biz.address, v_biz.phone, v_biz.email,
    v_biz.brand_color, v_biz.currency, v_receipt.customer_name, v_receipt.customer_phone,
    v_calculated_items, v_subtotal, v_discount_total, v_biz.vat_enabled,
    v_biz.vat_mode, v_biz.vat_rate_bps, v_vat, v_total, p_amount_paid_kobo,
    v_balance, p_payment_method, v_receipt.note, v_receipt.sold_by, v_template,
    v_status, v_issued_date, v_receipt.issued_at
  );

  if nullif(trim(coalesce(p_customer_name, '')), '') is not null then
    insert into public.customers (business_id, name, phone)
    values (v_biz.id, trim(p_customer_name), trim(coalesce(p_customer_phone, '')));
  end if;

  return v_receipt;
end;
$$;

-- 6. Hardened receive_balance RPC (closed-day check + Phase 2 ledger metadata)
create or replace function public.receive_balance(
  p_parent_receipt_id uuid,
  p_amount_kobo bigint,
  p_payment_method text default 'Cash',
  p_note text default '',
  p_sold_by text default '',
  p_issued_date_lagos date default ((now() at time zone 'Africa/Lagos')::date),
  p_template text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz public.businesses%rowtype;
  v_parent public.receipts%rowtype;
  v_seq integer;
  v_receipt_number text;
  v_public_id text;
  v_template text;
  v_new_paid bigint;
  v_new_balance bigint;
  v_new_status text;
  v_items jsonb;
  v_child public.receipts%rowtype;
  v_issued_date date := coalesce(p_issued_date_lagos, (now() at time zone 'Africa/Lagos')::date);
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid for update;
  if not found then
    raise exception 'Business not found';
  end if;

  if exists (select 1 from public.day_closures where business_id = v_biz.id and close_date = v_issued_date) then
    raise exception 'Day % is closed. Post a visible correction entry instead.', v_issued_date;
  end if;

  select * into v_parent from public.receipts where id = p_parent_receipt_id and business_id = v_biz.id for update;
  if not found then
    raise exception 'Receipt not found';
  end if;
  if v_parent.status = 'VOID' then
    raise exception 'Cannot receive balance on a voided receipt';
  end if;
  if v_parent.receipt_kind <> 'SALE' then
    raise exception 'Balance payments only apply to original sale receipts';
  end if;
  if p_amount_kobo <= 0 or p_amount_kobo > v_parent.balance_due_kobo then
    raise exception 'Invalid balance payment amount';
  end if;

  v_seq := v_biz.next_sequence;
  v_receipt_number := v_biz.receipt_prefix || lpad(v_seq::text, 4, '0');
  v_public_id := replace(gen_random_uuid()::text, '-', '');
  v_template := coalesce(p_template, v_parent.template, v_biz.default_template);
  v_new_paid := v_parent.amount_paid_kobo + p_amount_kobo;
  v_new_balance := greatest(0, v_parent.total_kobo - v_new_paid);
  v_new_status := case when v_new_balance = 0 then 'PAID' else 'PART_PAID' end;

  v_items := jsonb_build_array(jsonb_build_object(
    'description', 'Balance payment for Receipt ' || v_parent.receipt_number,
    'qty', 1,
    'unitPriceKobo', p_amount_kobo,
    'discountKobo', 0,
    'grossKobo', p_amount_kobo,
    'lineTotalKobo', p_amount_kobo
  ));

  update public.businesses set next_sequence = next_sequence + 1, updated_at = now() where id = v_biz.id;

  insert into public.receipts (
    business_id, public_id, sequence_number, receipt_number, receipt_kind,
    parent_receipt_id, parent_receipt_number, customer_name, customer_phone,
    items_json, subtotal_kobo, discount_total_kobo, vat_enabled, vat_mode, vat_rate_bps,
    vat_kobo, total_kobo, initial_paid_kobo, amount_paid_kobo, balance_due_kobo,
    payment_method, note, sold_by, source, template, status, issued_date_lagos, created_by
  ) values (
    v_biz.id, v_public_id, v_seq, v_receipt_number, 'BALANCE_PAYMENT',
    v_parent.id, v_parent.receipt_number, v_parent.customer_name, v_parent.customer_phone,
    v_items, p_amount_kobo, 0, false, 'exclusive', 0,
    0, p_amount_kobo, p_amount_kobo, p_amount_kobo, v_new_balance,
    p_payment_method, coalesce(p_note, ''), coalesce(nullif(p_sold_by, ''), v_parent.sold_by),
    'manual', v_template, 'PAID', v_issued_date, v_uid
  ) returning * into v_child;

  update public.receipts set amount_paid_kobo = v_new_paid, balance_due_kobo = v_new_balance, status = v_new_status where id = v_parent.id returning * into v_parent;
  update public.public_receipts set amount_paid_kobo = v_new_paid, balance_due_kobo = v_new_balance, status = v_new_status where receipt_id = v_parent.id;

  insert into public.public_receipts (
    public_id, receipt_id, receipt_number, receipt_kind, parent_receipt_number,
    business_name, business_logo_data_url, business_address, business_phone, business_email,
    brand_color, currency, customer_name, customer_phone, items_json,
    subtotal_kobo, discount_total_kobo, vat_enabled, vat_mode, vat_rate_bps,
    vat_kobo, total_kobo, amount_paid_kobo, balance_due_kobo, payment_method,
    note, sold_by, template, status, issued_date_lagos, issued_at
  ) values (
    v_public_id, v_child.id, v_receipt_number, 'BALANCE_PAYMENT', v_parent.receipt_number,
    v_biz.name, v_biz.logo_data_url, v_biz.address, v_biz.phone, v_biz.email,
    v_biz.brand_color, v_biz.currency, v_parent.customer_name, v_parent.customer_phone, v_items,
    p_amount_kobo, 0, false, 'exclusive', 0,
    0, p_amount_kobo, p_amount_kobo, v_new_balance, p_payment_method,
    v_child.note, v_child.sold_by, v_template, 'PAID', v_issued_date, v_child.issued_at
  );

  insert into public.ledger_entries (
    business_id, entry_type, entry_kind, amount_kobo, cash_received_kobo, payment_method,
    receipt_id, parent_entry_id, customer_name, customer_phone, note, sold_by, source, entry_date, created_by
  ) values (
    v_biz.id, 'PAYMENT_RECEIVED', 'DEBT_PAYMENT', p_amount_kobo, p_amount_kobo, p_payment_method,
    v_child.id, v_parent.id, v_parent.customer_name, v_parent.customer_phone,
    coalesce(nullif(p_note, ''), 'Balance received for ' || v_parent.receipt_number),
    v_child.sold_by, 'manual', v_issued_date, v_uid
  );

  return jsonb_build_object('receipt', to_jsonb(v_child), 'parentReceipt', to_jsonb(v_parent));
end;
$$;

-- 7. Hardened void_receipt RPC (marks correction safely if today is closed + populates VOID_REVERSAL)
create or replace function public.void_receipt(p_receipt_id uuid, p_reason text)
returns public.receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz public.businesses%rowtype;
  v_row public.receipts%rowtype;
  v_parent public.receipts%rowtype;
  v_restored_paid bigint;
  v_restored_bal bigint;
  v_restored_status text;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_is_closed boolean := false;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Void reason must be at least 3 characters';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid;
  if not found then
    raise exception 'Business not found';
  end if;

  select * into v_row from public.receipts where id = p_receipt_id and business_id = v_biz.id for update;
  if not found then
    raise exception 'Receipt not found';
  end if;
  if v_row.status = 'VOID' then
    raise exception 'Receipt is already voided';
  end if;

  if v_row.receipt_kind = 'BALANCE_PAYMENT' and v_row.parent_receipt_id is not null then
    select * into v_parent from public.receipts where id = v_row.parent_receipt_id and business_id = v_biz.id for update;
    if found and v_parent.status <> 'VOID' then
      v_restored_paid := greatest(0, v_parent.amount_paid_kobo - v_row.total_kobo);
      v_restored_bal := greatest(0, v_parent.total_kobo - v_restored_paid);
      v_restored_status := case when v_restored_bal = 0 then 'PAID' else 'PART_PAID' end;
      update public.receipts set amount_paid_kobo = v_restored_paid, balance_due_kobo = v_restored_bal, status = v_restored_status where id = v_parent.id;
      update public.public_receipts set amount_paid_kobo = v_restored_paid, balance_due_kobo = v_restored_bal, status = v_restored_status where receipt_id = v_parent.id;
    end if;
  end if;

  update public.receipts
  set status = 'VOID', void_reason = trim(p_reason), voided_at = now(), voided_by = v_uid
  where id = v_row.id
  returning * into v_row;

  update public.public_receipts
  set status = 'VOID', void_reason = trim(p_reason), voided_at = now()
  where receipt_id = v_row.id;

  v_is_closed := exists (select 1 from public.day_closures where business_id = v_biz.id and close_date = v_today);

  insert into public.ledger_entries (
    business_id, entry_type, entry_kind, amount_kobo, cash_received_kobo, payment_method,
    receipt_id, customer_name, customer_phone, note, sold_by, source, is_correction, correction_reason, entry_date, created_by
  ) values (
    v_biz.id, 'ADJUSTMENT', 'VOID_REVERSAL', -v_row.total_kobo, -v_row.initial_paid_kobo, v_row.payment_method,
    v_row.id, v_row.customer_name, v_row.customer_phone,
    'VOID ' || v_row.receipt_number || ': ' || trim(p_reason), v_row.sold_by,
    'manual', v_is_closed, case when v_is_closed then 'Void receipt ' || v_row.receipt_number || ': ' || trim(p_reason) else '' end,
    v_today, v_uid
  );

  return v_row;
end;
$$;

-- 8. Hardened record_credit_payment RPC (adds closed-day lock validation)
create or replace function public.record_credit_payment(
  p_credit_sale_id uuid,
  p_amount_kobo bigint,
  p_payment_method text default 'Cash',
  p_note text default '',
  p_sold_by text default '',
  p_issued_date_lagos date default ((now() at time zone 'Africa/Lagos')::date),
  p_template text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz public.businesses%rowtype;
  v_cs public.credit_sales%rowtype;
  v_seq integer;
  v_receipt_number text;
  v_public_id text;
  v_template text;
  v_new_paid bigint;
  v_new_balance bigint;
  v_new_status text;
  v_items jsonb;
  v_receipt public.receipts%rowtype;
  v_issued_date date := coalesce(p_issued_date_lagos, (now() at time zone 'Africa/Lagos')::date);
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid for update;
  if not found then
    raise exception 'Business not found';
  end if;

  if exists (select 1 from public.day_closures where business_id = v_biz.id and close_date = v_issued_date) then
    raise exception 'Day % is closed. Post a visible correction entry instead.', v_issued_date;
  end if;

  select * into v_cs from public.credit_sales where id = p_credit_sale_id and business_id = v_biz.id for update;
  if not found then
    raise exception 'Credit sale not found';
  end if;
  if v_cs.status = 'VOID' then
    raise exception 'Cannot record payment on a voided credit sale';
  end if;
  if p_amount_kobo <= 0 or p_amount_kobo > v_cs.balance_due_kobo then
    raise exception 'Invalid payment amount';
  end if;

  v_seq := v_biz.next_sequence;
  v_receipt_number := v_biz.receipt_prefix || lpad(v_seq::text, 4, '0');
  v_public_id := replace(gen_random_uuid()::text, '-', '');
  v_template := coalesce(p_template, v_biz.default_template);
  v_new_paid := v_cs.amount_paid_kobo + p_amount_kobo;
  v_new_balance := greatest(0, v_cs.total_kobo - v_new_paid);
  v_new_status := case when v_new_balance = 0 then 'PAID' else 'PART_PAID' end;

  v_items := jsonb_build_array(jsonb_build_object(
    'description', coalesce(nullif(v_cs.item_note, ''), 'Credit balance payment'),
    'qty', 1,
    'unitPriceKobo', p_amount_kobo,
    'discountKobo', 0,
    'grossKobo', p_amount_kobo,
    'lineTotalKobo', p_amount_kobo
  ));

  update public.businesses set next_sequence = next_sequence + 1, updated_at = now() where id = v_biz.id;

  insert into public.receipts (
    business_id, public_id, sequence_number, receipt_number, receipt_kind,
    customer_name, customer_phone, items_json, subtotal_kobo, discount_total_kobo,
    vat_enabled, vat_mode, vat_rate_bps, vat_kobo, total_kobo,
    initial_paid_kobo, amount_paid_kobo, balance_due_kobo, payment_method,
    note, sold_by, source, template, status, issued_date_lagos, created_by
  ) values (
    v_biz.id, v_public_id, v_seq, v_receipt_number, 'BALANCE_PAYMENT',
    v_cs.customer_name, v_cs.customer_phone, v_items, p_amount_kobo, 0,
    false, 'exclusive', 0, 0, p_amount_kobo,
    p_amount_kobo, p_amount_kobo, v_new_balance, p_payment_method,
    coalesce(nullif(p_note, ''), 'Payment on credit sale (' || v_cs.entry_date::text || ')'),
    coalesce(nullif(p_sold_by, ''), v_cs.sold_by),
    'manual', v_template, 'PAID', v_issued_date, v_uid
  ) returning * into v_receipt;

  update public.credit_sales
  set amount_paid_kobo = v_new_paid, balance_due_kobo = v_new_balance, status = v_new_status, receipt_id = coalesce(receipt_id, v_receipt.id)
  where id = v_cs.id returning * into v_cs;

  insert into public.public_receipts (
    public_id, receipt_id, receipt_number, receipt_kind, business_name,
    business_logo_data_url, business_address, business_phone, business_email,
    brand_color, currency, customer_name, customer_phone, items_json,
    subtotal_kobo, discount_total_kobo, vat_enabled, vat_mode, vat_rate_bps,
    vat_kobo, total_kobo, amount_paid_kobo, balance_due_kobo, payment_method,
    note, sold_by, template, status, issued_date_lagos, issued_at
  ) values (
    v_public_id, v_receipt.id, v_receipt_number, 'BALANCE_PAYMENT', v_biz.name,
    v_biz.logo_data_url, v_biz.address, v_biz.phone, v_biz.email,
    v_biz.brand_color, v_biz.currency, v_cs.customer_name, v_cs.customer_phone, v_items,
    p_amount_kobo, 0, false, 'exclusive', 0, 0, p_amount_kobo, p_amount_kobo, v_new_balance,
    p_payment_method, v_receipt.note, v_receipt.sold_by, v_template, 'PAID',
    v_issued_date, v_receipt.issued_at
  );

  insert into public.ledger_entries (
    business_id, entry_type, entry_kind, amount_kobo, cash_received_kobo, payment_method,
    receipt_id, credit_sale_id, customer_name, customer_phone, note, sold_by, source, entry_date, created_by
  ) values (
    v_biz.id, 'PAYMENT_RECEIVED', 'DEBT_PAYMENT', p_amount_kobo, p_amount_kobo, p_payment_method,
    v_receipt.id, v_cs.id, v_cs.customer_name, v_cs.customer_phone,
    v_receipt.note, v_receipt.sold_by, 'manual', v_issued_date, v_uid
  );

  return jsonb_build_object('receipt', to_jsonb(v_receipt), 'creditSale', to_jsonb(v_cs));
end;
$$;

-- =============================================================================
-- 9. ALLOW ACCOUNT & BUSINESS CASCADE DELETION EVEN WHEN DAYS ARE CLOSED
-- =============================================================================
drop policy if exists "Owner deletes own business" on public.businesses;
create policy "Owner deletes own business"
  on public.businesses
  for delete
  to authenticated
  using (owner_id = auth.uid());

create or replace function public.is_day_closed(p_business_id uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.day_closures
    where business_id = p_business_id
      and close_date = p_date
  );
$$;

grant execute on function public.is_day_closed(uuid, date) to authenticated;

create or replace function public.enforce_closed_day_on_ledger()
returns trigger
language plpgsql
as $$
declare
  v_biz uuid;
  v_date date;
begin
  if tg_op = 'DELETE' then
    v_biz := old.business_id;
    v_date := old.entry_date;
    -- Allow ON DELETE CASCADE when the parent business itself is being deleted
    if not exists (select 1 from public.businesses where id = v_biz) then
      return old;
    end if;
    if public.is_day_closed(v_biz, v_date) then
      raise exception 'CLOSED_DAY_MUTATION_BLOCKED: Day % is closed. Cannot delete ledger entries from a closed day.', v_date;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if public.is_day_closed(old.business_id, old.entry_date) then
      if old.receipt_id is null
         and new.receipt_id is not null
         and new.amount_kobo = old.amount_kobo
         and new.cash_received_kobo = old.cash_received_kobo
         and new.entry_date = old.entry_date
         and new.entry_type = old.entry_type
         and new.business_id = old.business_id then
        return new;
      end if;
      raise exception 'CLOSED_DAY_MUTATION_BLOCKED: Day % is closed. Past ledger entries are immutable; create a correction entry instead.', old.entry_date;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if public.is_day_closed(new.business_id, new.entry_date) then
      if coalesce(new.is_correction, false) = true and new.entry_type = 'ADJUSTMENT' then
        return new;
      end if;
      raise exception 'CLOSED_DAY_MUTATION_BLOCKED: Day % is closed. Post a visible correction entry instead.', new.entry_date;
    end if;
    return new;
  end if;

  return new;
end;
$$;

create or replace function public.enforce_closed_day_on_expenses()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    -- Allow ON DELETE CASCADE when the parent business itself is being deleted
    if not exists (select 1 from public.businesses where id = old.business_id) then
      return old;
    end if;
    if public.is_day_closed(old.business_id, old.entry_date) then
      raise exception 'CLOSED_DAY_MUTATION_BLOCKED: Day % is closed. Cannot delete an expense from a closed day; record an adjustment instead.', old.entry_date;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if public.is_day_closed(new.business_id, new.entry_date) then
      raise exception 'CLOSED_DAY_MUTATION_BLOCKED: Day % is closed. Post a visible correction entry instead.', new.entry_date;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if public.is_day_closed(old.business_id, old.entry_date) then
      raise exception 'CLOSED_DAY_MUTATION_BLOCKED: Day % is closed. Expenses on a closed day cannot be edited; post a correction entry instead.', old.entry_date;
    end if;
    if new.entry_date is distinct from old.entry_date and public.is_day_closed(new.business_id, new.entry_date) then
      raise exception 'CLOSED_DAY_MUTATION_BLOCKED: Target day % is closed.', new.entry_date;
    end if;
  end if;

  return new;
end;
$$;

-- Force PostgREST to reload schema cache immediately after migration
notify pgrst, 'reload schema';


