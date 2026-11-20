-- ============================================================================
-- Tallymark V2 Slice 3 Migration (007): Quotations RPCs & Single-Convert Guard
--
-- Design rules:
--   - Additive only on top of 005_v2_quotations_invoices.sql & 006.
--   - Transactional and idempotent.
--   - All SECURITY DEFINER functions use fixed search_path = public,
--     schema-qualified objects, validated arguments, no dynamic SQL, and
--     explicitly REVOKE EXECUTE FROM PUBLIC.
--   - Sent quotes are immutable; revising voids the original and creates a
--     fresh draft copy linked via revised_from_id.
--   - Expiry is computed in Africa/Lagos (valid_until 23:59:59 WAT).
--   - Convert-to-invoice locks the quote row FOR UPDATE + unique partial index
--     on invoices(source_quote_id), guaranteeing exact single conversion under
--     parallel taps.
--   - Public quote fetcher returns snapshot + status only (never phone/email
--     or decision_ip_hash).
-- ============================================================================

begin;

-- 1. Enforce at most one converted invoice per quote at the database level
create unique index if not exists idx_invoices_source_quote_unique
  on public.invoices(source_quote_id)
  where source_quote_id is not null;

-- 2. Helper: exact integer round-half-up (numerator / denominator)
create or replace function public.v2_round_half_up(p_num bigint, p_den bigint)
returns bigint
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_den is null or p_den <= 0 then
    raise exception 'Denominator must be positive';
  end if;
  if p_num is null or p_num <= 0 then
    return 0;
  end if;
  return ((p_num * 2) + p_den) / (p_den * 2);
end;
$$;
revoke all on function public.v2_round_half_up(bigint, bigint) from public;

-- 3. Save (create or update) a quote draft. Rejects editing any non-DRAFT quote.
create or replace function public.v2_save_quote_draft(
  p_quote_id uuid default null,
  p_customer_id uuid default null,
  p_customer_name text default '',
  p_customer_phone text default '',
  p_customer_email text default '',
  p_customer_address text default '',
  p_issue_date date default null,
  p_valid_until date default null,
  p_terms_kind text default 'net_7',
  p_lines jsonb default '[]'::jsonb,
  p_invoice_discount_kobo bigint default 0,
  p_deposit_type text default 'none',
  p_deposit_value bigint default 0,
  p_notes text default '',
  p_bank_account_ids jsonb default '[]'::jsonb,
  p_template text default null,
  p_idempotency_key text default null
)
returns public.quotes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz public.businesses%rowtype;
  v_existing public.quotes%rowtype;
  v_quote_id uuid;
  v_issue date;
  v_valid date;
  v_terms text;
  v_template text;
  v_cust_id uuid := p_customer_id;
  v_cust_name text := left(trim(coalesce(p_customer_name, '')), 120);
  v_cust_phone text := left(trim(coalesce(p_customer_phone, '')), 40);
  v_cust_email text := left(trim(coalesce(p_customer_email, '')), 120);
  v_cust_addr text := left(trim(coalesce(p_customer_address, '')), 240);
  v_subtotal bigint := 0;
  v_line_disc_total bigint := 0;
  v_lines_net bigint := 0;
  v_inv_disc bigint := greatest(0, coalesce(p_invoice_discount_kobo, 0));
  v_taxable bigint := 0;
  v_vat bigint := 0;
  v_total bigint := 0;
  v_dep_type text := coalesce(nullif(trim(coalesce(p_deposit_type, '')), ''), 'none');
  v_dep_val bigint := greatest(0, coalesce(p_deposit_value, 0));
  v_due_now bigint := 0;
  v_line jsonb;
  v_idx integer := 0;
  v_desc text;
  v_qty bigint;
  v_price bigint;
  v_gross bigint;
  v_disc bigint;
  v_net bigint;
  v_idem text := nullif(left(trim(coalesce(p_idempotency_key, '')), 120), '');
  v_out public.quotes%rowtype;
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid;
  if not found then
    raise exception 'Business not found';
  end if;

  if v_cust_name = '' then
    raise exception 'Customer name is required';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 then
    raise exception 'Add at least one line item';
  end if;
  if jsonb_array_length(p_lines) > 50 then
    raise exception 'A quote may have at most 50 line items';
  end if;

  -- Idempotent replay on create
  if p_quote_id is null and v_idem is not null then
    select * into v_existing
    from public.quotes
    where business_id = v_biz.id and idempotency_key = v_idem;
    if found then
      return v_existing;
    end if;
  end if;

  v_issue := coalesce(p_issue_date, (now() at time zone 'Africa/Lagos')::date);
  v_valid := coalesce(p_valid_until, v_issue + 14);
  if v_valid < v_issue then
    raise exception 'Valid until date cannot be earlier than the issue date';
  end if;

  v_terms := case
    when p_terms_kind in ('due_on_receipt', 'net_7', 'net_14', 'net_30', 'custom') then p_terms_kind
    else 'net_7'
  end;

  v_template := case
    when p_template in ('modern', 'classic', 'compact') then p_template
    else coalesce(v_biz.default_template, 'modern')
  end;

  if v_cust_id is not null then
    perform 1 from public.customers where id = v_cust_id and business_id = v_biz.id;
    if not found then
      v_cust_id := null;
    end if;
  end if;

  -- First pass: compute exact totals
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_desc := left(trim(coalesce(v_line ->> 'description', '')), 160);
    if v_desc = '' then
      raise exception 'Item description is required';
    end if;
    v_qty := greatest(1, coalesce((v_line ->> 'qtyThousandths')::bigint, 0));
    v_price := greatest(0, coalesce((v_line ->> 'unitPriceKobo')::bigint, 0));
    v_gross := public.v2_round_half_up(v_qty * v_price, 1000);
    v_disc := least(v_gross, greatest(0, coalesce((v_line ->> 'discountKobo')::bigint, 0)));
    v_net := v_gross - v_disc;

    v_subtotal := v_subtotal + v_gross;
    v_line_disc_total := v_line_disc_total + v_disc;
    v_lines_net := v_lines_net + v_net;
  end loop;

  v_inv_disc := least(v_lines_net, v_inv_disc);
  v_taxable := greatest(0, v_lines_net - v_inv_disc);

  if v_biz.vat_enabled and v_biz.vat_rate_bps > 0 and v_taxable > 0 then
    if v_biz.vat_mode = 'exclusive' then
      v_vat := public.v2_round_half_up(v_taxable * v_biz.vat_rate_bps, 10000);
      v_total := v_taxable + v_vat;
    else
      v_vat := public.v2_round_half_up(v_taxable * v_biz.vat_rate_bps, 10000 + v_biz.vat_rate_bps);
      v_total := v_taxable;
    end if;
  else
    v_vat := 0;
    v_total := v_taxable;
  end if;

  if v_dep_type = 'percent' then
    v_dep_val := least(10000, v_dep_val);
    v_due_now := public.v2_round_half_up(v_total * v_dep_val, 10000);
  elsif v_dep_type = 'fixed' then
    v_dep_val := least(v_total, v_dep_val);
    v_due_now := v_dep_val;
  else
    v_dep_type := 'none';
    v_dep_val := 0;
    v_due_now := v_total;
  end if;

  if p_quote_id is not null then
    select * into v_existing
    from public.quotes
    where id = p_quote_id and business_id = v_biz.id
    for update;
    if not found then
      raise exception 'Quote not found';
    end if;
    if v_existing.status <> 'DRAFT' then
      raise exception 'Sent quotes cannot be edited. Use Revise to void and create a new copy.';
    end if;

    v_quote_id := v_existing.id;
    update public.quotes
    set
      customer_id = v_cust_id,
      issue_date = v_issue,
      valid_until = v_valid,
      terms_kind = v_terms,
      customer_name = v_cust_name,
      customer_phone = v_cust_phone,
      customer_email = v_cust_email,
      customer_address = v_cust_addr,
      subtotal_kobo = v_subtotal,
      line_discount_total_kobo = v_line_disc_total,
      invoice_discount_kobo = v_inv_disc,
      vat_enabled = v_biz.vat_enabled,
      vat_mode = v_biz.vat_mode,
      vat_rate_bps = v_biz.vat_rate_bps,
      vat_kobo = v_vat,
      total_kobo = v_total,
      deposit_type = v_dep_type,
      deposit_value = v_dep_val,
      amount_due_now_kobo = v_due_now,
      notes = left(trim(coalesce(p_notes, '')), 600),
      bank_account_ids = coalesce(p_bank_account_ids, '[]'::jsonb),
      template = v_template,
      updated_at = now()
    where id = v_quote_id
    returning * into v_out;

    delete from public.quote_lines where quote_id = v_quote_id;
  else
    insert into public.quotes (
      business_id, customer_id, idempotency_key, status,
      issue_date, valid_until, terms_kind, currency,
      customer_name, customer_phone, customer_email, customer_address,
      subtotal_kobo, line_discount_total_kobo, invoice_discount_kobo,
      vat_enabled, vat_mode, vat_rate_bps, vat_kobo, total_kobo,
      deposit_type, deposit_value, amount_due_now_kobo,
      notes, bank_account_ids, template, created_by
    ) values (
      v_biz.id, v_cust_id, v_idem, 'DRAFT',
      v_issue, v_valid, v_terms, v_biz.currency,
      v_cust_name, v_cust_phone, v_cust_email, v_cust_addr,
      v_subtotal, v_line_disc_total, v_inv_disc,
      v_biz.vat_enabled, v_biz.vat_mode, v_biz.vat_rate_bps, v_vat, v_total,
      v_dep_type, v_dep_val, v_due_now,
      left(trim(coalesce(p_notes, '')), 600),
      coalesce(p_bank_account_ids, '[]'::jsonb),
      v_template,
      v_uid
    )
    returning * into v_out;
    v_quote_id := v_out.id;
  end if;

  -- Insert line items
  v_idx := 0;
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_desc := left(trim(coalesce(v_line ->> 'description', '')), 160);
    v_qty := greatest(1, coalesce((v_line ->> 'qtyThousandths')::bigint, 0));
    v_price := greatest(0, coalesce((v_line ->> 'unitPriceKobo')::bigint, 0));
    v_gross := public.v2_round_half_up(v_qty * v_price, 1000);
    v_disc := least(v_gross, greatest(0, coalesce((v_line ->> 'discountKobo')::bigint, 0)));
    v_net := v_gross - v_disc;

    insert into public.quote_lines (
      quote_id, business_id, position, description,
      qty_thousandths, unit_price_kobo, discount_kobo, gross_kobo, line_total_kobo
    ) values (
      v_quote_id, v_biz.id, v_idx, v_desc,
      v_qty, v_price, v_disc, v_gross, v_net
    );
    v_idx := v_idx + 1;
  end loop;

  return v_out;
end;
$$;
revoke all on function public.v2_save_quote_draft(uuid, uuid, text, text, text, text, date, date, text, jsonb, bigint, text, bigint, text, jsonb, text, text) from public;
grant execute on function public.v2_save_quote_draft(uuid, uuid, text, text, text, text, date, date, text, jsonb, bigint, text, bigint, text, jsonb, text, text) to authenticated;

-- 4. Send (issue & lock) a quote draft: gap-free QUO- numbering, immutable snapshot, zero ledger entries
create or replace function public.v2_send_quote(p_quote_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz public.businesses%rowtype;
  v_quote public.quotes%rowtype;
  v_seq integer;
  v_qnum text;
  v_lines jsonb;
  v_banks jsonb := '[]'::jsonb;
  v_snap jsonb;
  v_show_brand boolean := true;
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid for update;
  if not found then
    raise exception 'Business not found';
  end if;

  select * into v_quote
  from public.quotes
  where id = p_quote_id and business_id = v_biz.id
  for update;
  if not found then
    raise exception 'Quote not found';
  end if;
  if v_quote.status <> 'DRAFT' then
    raise exception 'This quote has already been sent';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', ql.id,
      'position', ql.position,
      'description', ql.description,
      'qtyThousandths', ql.qty_thousandths,
      'unitPriceKobo', ql.unit_price_kobo,
      'discountKobo', ql.discount_kobo,
      'grossKobo', ql.gross_kobo,
      'lineTotalKobo', ql.line_total_kobo
    ) order by ql.position asc
  ), '[]'::jsonb)
  into v_lines
  from public.quote_lines ql
  where ql.quote_id = v_quote.id;

  if jsonb_array_length(v_lines) < 1 then
    raise exception 'Quote must have at least one line item';
  end if;

  -- Filter selected bank accounts from business profile
  if jsonb_typeof(v_biz.bank_accounts) = 'array' and jsonb_typeof(v_quote.bank_account_ids) = 'array' then
    select coalesce(jsonb_agg(b), '[]'::jsonb)
    into v_banks
    from jsonb_array_elements(v_biz.bank_accounts) b
    where (b ->> 'id') in (select jsonb_array_elements_text(v_quote.bank_account_ids));
  end if;

  v_seq := coalesce(v_biz.next_quote_sequence, 1);
  v_qnum := coalesce(v_biz.quote_prefix, 'QUO-') || lpad(v_seq::text, 4, '0');

  update public.businesses
  set next_quote_sequence = v_seq + 1, updated_at = now()
  where id = v_biz.id;

  v_snap := jsonb_build_object(
    'quoteNumber', v_qnum,
    'business', jsonb_build_object(
      'name', v_biz.name,
      'logoDataUrl', v_biz.logo_data_url,
      'address', coalesce(v_biz.address, ''),
      'phone', coalesce(v_biz.phone, ''),
      'email', coalesce(v_biz.email, ''),
      'tinRc', coalesce(v_biz.tin_rc, ''),
      'brandColor', coalesce(v_biz.brand_color, '#064E3B'),
      'currency', coalesce(v_biz.currency, 'NGN')
    ),
    'customer', jsonb_build_object(
      'name', v_quote.customer_name,
      'address', coalesce(v_quote.customer_address, '')
    ),
    'bankAccounts', v_banks,
    'issueDate', v_quote.issue_date::text,
    'validUntil', v_quote.valid_until::text,
    'termsKind', v_quote.terms_kind,
    'lines', v_lines,
    'subtotalKobo', v_quote.subtotal_kobo,
    'lineDiscountTotalKobo', v_quote.line_discount_total_kobo,
    'invoiceDiscountKobo', v_quote.invoice_discount_kobo,
    'vatEnabled', v_quote.vat_enabled,
    'vatMode', v_quote.vat_mode,
    'vatRateBps', v_quote.vat_rate_bps,
    'vatKobo', v_quote.vat_kobo,
    'totalKobo', v_quote.total_kobo,
    'depositType', v_quote.deposit_type,
    'depositValue', v_quote.deposit_value,
    'amountDueNowKobo', v_quote.amount_due_now_kobo,
    'notes', coalesce(v_quote.notes, ''),
    'template', v_quote.template,
    'showBranding', v_show_brand
  );

  update public.quotes
  set
    sequence_number = v_seq,
    quote_number = v_qnum,
    status = 'SENT',
    snapshot_json = v_snap,
    sent_at = now(),
    updated_at = now()
  where id = v_quote.id
  returning * into v_quote;

  perform public.v2_increment_usage(v_biz.id, 'quote');
  perform public.v2_log_audit(
    v_biz.id,
    v_uid,
    'quote_sent',
    'quote',
    v_quote.id,
    jsonb_build_object(
      'quote_number', v_qnum,
      'total_kobo', v_quote.total_kobo,
      'valid_until', v_quote.valid_until::text
    )
  );

  return v_quote;
end;
$$;
revoke all on function public.v2_send_quote(uuid) from public;
grant execute on function public.v2_send_quote(uuid) to authenticated;

-- 5. Void a quote (blocked if already CONVERTED or VOID)
create or replace function public.v2_void_quote(p_quote_id uuid, p_reason text)
returns public.quotes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz public.businesses%rowtype;
  v_quote public.quotes%rowtype;
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception 'Provide a reason (at least 3 characters)';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid;
  if not found then
    raise exception 'Business not found';
  end if;

  select * into v_quote from public.quotes where id = p_quote_id and business_id = v_biz.id for update;
  if not found then
    raise exception 'Quote not found';
  end if;
  if v_quote.status = 'VOID' then
    raise exception 'Quote is already voided';
  end if;
  if v_quote.status = 'CONVERTED' then
    raise exception 'A converted quote cannot be voided';
  end if;

  update public.quotes
  set
    status = 'VOID',
    void_reason = left(trim(p_reason), 240),
    voided_at = now(),
    updated_at = now()
  where id = v_quote.id
  returning * into v_quote;

  perform public.v2_log_audit(
    v_biz.id,
    v_uid,
    'quote_voided',
    'quote',
    v_quote.id,
    jsonb_build_object('quote_number', v_quote.quote_number, 'reason', v_quote.void_reason)
  );

  return v_quote;
end;
$$;
revoke all on function public.v2_void_quote(uuid, text) from public;
grant execute on function public.v2_void_quote(uuid, text) to authenticated;

-- 6. Revise a sent/declined/expired quote: voids original and returns a fresh editable DRAFT copy
create or replace function public.v2_revise_quote(
  p_quote_id uuid,
  p_reason text default 'Revised with updated pricing'
)
returns public.quotes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz public.businesses%rowtype;
  v_old public.quotes%rowtype;
  v_new public.quotes%rowtype;
  v_today_lagos date := (now() at time zone 'Africa/Lagos')::date;
  v_clean_reason text := left(coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Revised with updated pricing'), 240);
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid;
  if not found then
    raise exception 'Business not found';
  end if;

  select * into v_old from public.quotes where id = p_quote_id and business_id = v_biz.id for update;
  if not found then
    raise exception 'Quote not found';
  end if;
  if v_old.status not in ('SENT', 'DECLINED') then
    raise exception 'Only a sent or declined quote can be revised';
  end if;

  -- Void original
  update public.quotes
  set
    status = 'VOID',
    void_reason = v_clean_reason,
    voided_at = now(),
    updated_at = now()
  where id = v_old.id;

  perform public.v2_log_audit(
    v_biz.id,
    v_uid,
    'quote_voided',
    'quote',
    v_old.id,
    jsonb_build_object('quote_number', v_old.quote_number, 'reason', v_clean_reason, 'revised', true)
  );

  -- Create new DRAFT copy
  insert into public.quotes (
    business_id, customer_id, status,
    issue_date, valid_until, terms_kind, currency,
    customer_name, customer_phone, customer_email, customer_address,
    subtotal_kobo, line_discount_total_kobo, invoice_discount_kobo,
    vat_enabled, vat_mode, vat_rate_bps, vat_kobo, total_kobo,
    deposit_type, deposit_value, amount_due_now_kobo,
    notes, bank_account_ids, template, revised_from_id, created_by
  ) values (
    v_old.business_id, v_old.customer_id, 'DRAFT',
    v_today_lagos, v_today_lagos + 14, v_old.terms_kind, v_old.currency,
    v_old.customer_name, v_old.customer_phone, v_old.customer_email, v_old.customer_address,
    v_old.subtotal_kobo, v_old.line_discount_total_kobo, v_old.invoice_discount_kobo,
    v_old.vat_enabled, v_old.vat_mode, v_old.vat_rate_bps, v_old.vat_kobo, v_old.total_kobo,
    v_old.deposit_type, v_old.deposit_value, v_old.amount_due_now_kobo,
    v_old.notes, v_old.bank_account_ids, v_old.template, v_old.id, v_uid
  )
  returning * into v_new;

  insert into public.quote_lines (
    quote_id, business_id, position, description,
    qty_thousandths, unit_price_kobo, discount_kobo, gross_kobo, line_total_kobo
  )
  select
    v_new.id, business_id, position, description,
    qty_thousandths, unit_price_kobo, discount_kobo, gross_kobo, line_total_kobo
  from public.quote_lines
  where quote_id = v_old.id
  order by position asc;

  perform public.v2_log_audit(
    v_biz.id,
    v_uid,
    'quote_revised',
    'quote',
    v_new.id,
    jsonb_build_object('revised_from_id', v_old.id, 'revised_from_number', v_old.quote_number)
  );

  return v_new;
end;
$$;
revoke all on function public.v2_revise_quote(uuid, text) from public;
grant execute on function public.v2_revise_quote(uuid, text) to authenticated;

-- 7. Regenerate quote public link (128-bit random public_id; invalidates old link immediately)
create or replace function public.v2_regenerate_quote_link(p_quote_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz public.businesses%rowtype;
  v_quote public.quotes%rowtype;
  v_new_public_id text;
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid;
  if not found then
    raise exception 'Business not found';
  end if;

  v_new_public_id := replace(gen_random_uuid()::text, '-', '');

  update public.quotes
  set public_id = v_new_public_id, updated_at = now()
  where id = p_quote_id and business_id = v_biz.id
  returning * into v_quote;

  if not found then
    raise exception 'Quote not found';
  end if;

  perform public.v2_log_audit(
    v_biz.id,
    v_uid,
    'quote_link_regenerated',
    'quote',
    v_quote.id,
    jsonb_build_object('quote_number', v_quote.quote_number)
  );

  return v_quote;
end;
$$;
revoke all on function public.v2_regenerate_quote_link(uuid) from public;
grant execute on function public.v2_regenerate_quote_link(uuid) to authenticated;

-- 8. Convert quote to invoice: copies customer, lines & terms, links both docs, works strictly once
create or replace function public.v2_convert_quote_to_invoice(
  p_quote_id uuid,
  p_send_now boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz public.businesses%rowtype;
  v_quote public.quotes%rowtype;
  v_inv public.invoices%rowtype;
  v_today_lagos date := (now() at time zone 'Africa/Lagos')::date;
  v_due_date date;
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid;
  if not found then
    raise exception 'Business not found';
  end if;

  -- Lock quote row exclusively to prevent double conversion under parallel taps
  select * into v_quote
  from public.quotes
  where id = p_quote_id and business_id = v_biz.id
  for update;

  if not found then
    raise exception 'Quote not found';
  end if;

  if v_quote.status = 'CONVERTED' or v_quote.converted_invoice_id is not null then
    raise exception 'This quote has already been converted to an invoice';
  end if;

  if v_quote.status not in ('SENT', 'ACCEPTED') then
    raise exception 'Only a sent or accepted quote can be converted to an invoice';
  end if;

  if v_quote.status = 'SENT' and v_today_lagos > v_quote.valid_until then
    raise exception 'This quote has expired. Revise it first to send a fresh quote.';
  end if;

  v_due_date := case v_quote.terms_kind
    when 'due_on_receipt' then v_today_lagos
    when 'net_7' then v_today_lagos + 7
    when 'net_14' then v_today_lagos + 14
    when 'net_30' then v_today_lagos + 30
    else v_today_lagos + coalesce(v_biz.default_payment_terms_days, 7)
  end;

  insert into public.invoices (
    business_id, customer_id, status,
    issue_date, terms_kind, due_date, currency,
    customer_name, customer_phone, customer_email, customer_address,
    subtotal_kobo, line_discount_total_kobo, invoice_discount_kobo,
    vat_enabled, vat_mode, vat_rate_bps, vat_kobo, total_kobo,
    deposit_type, deposit_value, amount_due_now_kobo,
    amount_paid_kobo, written_off_kobo, balance_due_kobo,
    notes, bank_account_ids, template, source_quote_id, created_by
  ) values (
    v_quote.business_id, v_quote.customer_id, 'DRAFT',
    v_today_lagos, v_quote.terms_kind, v_due_date, v_quote.currency,
    v_quote.customer_name, v_quote.customer_phone, v_quote.customer_email, v_quote.customer_address,
    v_quote.subtotal_kobo, v_quote.line_discount_total_kobo, v_quote.invoice_discount_kobo,
    v_quote.vat_enabled, v_quote.vat_mode, v_quote.vat_rate_bps, v_quote.vat_kobo, v_quote.total_kobo,
    v_quote.deposit_type, v_quote.deposit_value, v_quote.amount_due_now_kobo,
    0, 0, v_quote.total_kobo,
    v_quote.notes, v_quote.bank_account_ids, v_quote.template, v_quote.id, v_uid
  )
  returning * into v_inv;

  insert into public.invoice_lines (
    invoice_id, business_id, position, description,
    qty_thousandths, unit_price_kobo, discount_kobo, gross_kobo, line_total_kobo
  )
  select
    v_inv.id, business_id, position, description,
    qty_thousandths, unit_price_kobo, discount_kobo, gross_kobo, line_total_kobo
  from public.quote_lines
  where quote_id = v_quote.id
  order by position asc;

  update public.quotes
  set
    status = 'CONVERTED',
    converted_invoice_id = v_inv.id,
    updated_at = now()
  where id = v_quote.id
  returning * into v_quote;

  if coalesce(p_send_now, false) then
    select * into v_inv from public.v2_send_invoice(v_inv.id);
  end if;

  perform public.v2_log_audit(
    v_biz.id,
    v_uid,
    'quote_converted',
    'quote',
    v_quote.id,
    jsonb_build_object(
      'quote_number', v_quote.quote_number,
      'invoice_id', v_inv.id,
      'invoice_number', v_inv.invoice_number
    )
  );

  return jsonb_build_object(
    'quote', to_jsonb(v_quote),
    'invoice', to_jsonb(v_inv)
  );
end;
$$;
revoke all on function public.v2_convert_quote_to_invoice(uuid, boolean) from public;
grant execute on function public.v2_convert_quote_to_invoice(uuid, boolean) to authenticated;

-- 9. Public Quote Snapshot Fetcher (NEVER exposes customer phone/email or decision_ip_hash)
create or replace function public.get_public_quote(p_public_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q public.quotes%rowtype;
  v_today_lagos date := (now() at time zone 'Africa/Lagos')::date;
  v_is_expired boolean;
begin
  if p_public_id is null or char_length(trim(p_public_id)) < 16 or char_length(trim(p_public_id)) > 64 then
    return null;
  end if;

  select * into v_q
  from public.quotes
  where public_id = trim(p_public_id)
    and status <> 'DRAFT'
    and snapshot_json is not null;

  if not found then
    return null;
  end if;

  v_is_expired := (v_q.status = 'SENT' and v_today_lagos > v_q.valid_until);

  return jsonb_build_object(
    'publicId', v_q.public_id,
    'status', v_q.status,
    'isExpired', v_is_expired,
    'sentAt', v_q.sent_at,
    'decisionName', v_q.decision_name,
    'decisionNote', v_q.decision_note,
    'decisionAt', v_q.decision_at,
    'voidReason', v_q.void_reason,
    'voidedAt', v_q.voided_at,
    'snapshot', v_q.snapshot_json
  );
end;
$$;
revoke all on function public.get_public_quote(text) from public;
grant execute on function public.get_public_quote(text) to anon, authenticated;

-- 10. Server-only public quote decision recorder (invoked after bot-check, kill-switch & 10/hr IP rate limit)
create or replace function public.v2_record_public_quote_decision(
  p_public_id text,
  p_decision text,
  p_name text,
  p_note text,
  p_ip_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q public.quotes%rowtype;
  v_today_lagos date := (now() at time zone 'Africa/Lagos')::date;
  v_clean_name text := left(trim(coalesce(p_name, '')), 80);
  v_clean_note text := left(trim(coalesce(p_note, '')), 240);
begin
  if p_decision not in ('ACCEPTED', 'DECLINED') then
    raise exception 'Invalid quote decision';
  end if;
  if v_clean_name = '' then
    raise exception 'Enter your name';
  end if;

  select * into v_q
  from public.quotes
  where public_id = trim(coalesce(p_public_id, ''))
    and status <> 'DRAFT'
    and snapshot_json is not null
  for update;

  if not found then
    raise exception 'Quote not found';
  end if;

  if v_q.status <> 'SENT' then
    raise exception 'This quote can no longer be responded to';
  end if;

  if v_today_lagos > v_q.valid_until then
    raise exception 'This quote has expired. Ask the business for an updated quote.';
  end if;

  update public.quotes
  set
    status = p_decision,
    decision_name = v_clean_name,
    decision_note = nullif(v_clean_note, ''),
    decision_at = now(),
    decision_ip_hash = left(coalesce(p_ip_hash, ''), 128),
    updated_at = now()
  where id = v_q.id
  returning * into v_q;

  perform public.v2_log_audit(
    v_q.business_id,
    null,
    case when p_decision = 'ACCEPTED' then 'quote_accepted' else 'quote_declined' end,
    'quote',
    v_q.id,
    jsonb_build_object(
      'quote_number', v_q.quote_number,
      'decision', p_decision
    )
  );

  return jsonb_build_object(
    'businessId', v_q.business_id,
    'quoteNumber', v_q.quote_number,
    'publicQuote', public.get_public_quote(v_q.public_id)
  );
end;
$$;
revoke all on function public.v2_record_public_quote_decision(text, text, text, text, text) from public;
revoke all on function public.v2_record_public_quote_decision(text, text, text, text, text) from anon, authenticated;

-- Notify PostgREST to reload schema cache
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
end;
$$;

commit;
