-- Tallymark Phase 1A Schema (Supabase / PostgreSQL)
-- Money stored as integer kobo. Timezone: Africa/Lagos.
-- Multi-tenant owner-only RLS + gap-free sequential numbering via issue_receipt RPC.

create extension if not exists pgcrypto;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  logo_data_url text,
  address text not null default '',
  phone text not null default '',
  email text not null default '',
  brand_color text not null default '#064E3B' check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  receipt_prefix text not null default 'RCT-' check (receipt_prefix ~ '^[A-Za-z0-9_-]{1,12}$'),
  next_sequence integer not null default 1 check (next_sequence >= 1),
  currency text not null default 'NGN' check (currency in ('NGN', 'USD', 'GBP', 'EUR')),
  vat_enabled boolean not null default false,
  vat_mode text not null default 'exclusive' check (vat_mode in ('inclusive', 'exclusive')),
  vat_rate_bps integer not null default 750,
  opening_cash_kobo bigint not null default 0 check (opening_cash_kobo >= 0),
  default_template text not null default 'modern' check (default_template in ('modern', 'classic', 'compact')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  phone text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_customers_business on public.customers(business_id, updated_at desc);

create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  description text not null,
  unit_price_kobo bigint not null check (unit_price_kobo >= 0),
  use_count integer not null default 1,
  updated_at timestamptz not null default now()
);
create index if not exists idx_catalog_business on public.catalog_items(business_id, use_count desc);

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  public_id text not null unique,
  sequence_number integer not null,
  receipt_number text not null,
  receipt_kind text not null default 'SALE' check (receipt_kind in ('SALE', 'BALANCE_PAYMENT')),
  parent_receipt_id uuid references public.receipts(id),
  parent_receipt_number text,
  customer_name text not null default '',
  customer_phone text not null default '',
  items_json jsonb not null,
  subtotal_kobo bigint not null check (subtotal_kobo >= 0),
  discount_total_kobo bigint not null default 0 check (discount_total_kobo >= 0),
  vat_enabled boolean not null default false,
  vat_mode text not null default 'exclusive' check (vat_mode in ('inclusive', 'exclusive')),
  vat_rate_bps integer not null default 750,
  vat_kobo bigint not null default 0 check (vat_kobo >= 0),
  total_kobo bigint not null check (total_kobo >= 0),
  initial_paid_kobo bigint not null check (initial_paid_kobo >= 0),
  amount_paid_kobo bigint not null check (amount_paid_kobo >= 0),
  balance_due_kobo bigint not null check (balance_due_kobo >= 0),
  payment_method text not null check (payment_method in ('Cash', 'Transfer', 'POS', 'Card', 'Other')),
  note text not null default '',
  sold_by text not null default '',
  source text not null default 'manual' check (source in ('manual', 'voice')),
  template text not null default 'modern' check (template in ('modern', 'classic', 'compact')),
  status text not null default 'PAID' check (status in ('PAID', 'PART_PAID', 'VOID')),
  void_reason text,
  voided_at timestamptz,
  voided_by uuid references auth.users(id),
  issued_date_lagos date not null default ((now() at time zone 'Africa/Lagos')::date),
  issued_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  unique (business_id, sequence_number)
);
create index if not exists idx_receipts_business_date on public.receipts(business_id, issued_date_lagos desc, sequence_number desc);

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  entry_type text not null check (entry_type in ('SALE', 'PAYMENT_RECEIVED', 'EXPENSE', 'ADJUSTMENT')),
  amount_kobo bigint not null,
  cash_received_kobo bigint not null default 0,
  payment_method text,
  receipt_id uuid references public.receipts(id),
  parent_entry_id uuid,
  note text not null default '',
  sold_by text not null default '',
  source text not null default 'manual' check (source in ('manual', 'voice')),
  entry_date date not null default ((now() at time zone 'Africa/Lagos')::date),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id)
);
create index if not exists idx_ledger_business_date on public.ledger_entries(business_id, entry_date desc, created_at desc);

create table if not exists public.public_receipts (
  public_id text primary key,
  receipt_id uuid not null unique references public.receipts(id) on delete cascade,
  receipt_number text not null,
  receipt_kind text not null,
  parent_receipt_number text,
  business_name text not null,
  business_logo_data_url text,
  business_address text not null default '',
  business_phone text not null default '',
  business_email text not null default '',
  brand_color text not null default '#064E3B',
  currency text not null default 'NGN',
  customer_name text not null default '',
  customer_phone text not null default '',
  items_json jsonb not null,
  subtotal_kobo bigint not null,
  discount_total_kobo bigint not null default 0,
  vat_enabled boolean not null default false,
  vat_mode text not null default 'exclusive',
  vat_rate_bps integer not null default 750,
  vat_kobo bigint not null default 0,
  total_kobo bigint not null,
  amount_paid_kobo bigint not null,
  balance_due_kobo bigint not null,
  payment_method text not null,
  note text not null default '',
  sold_by text not null default '',
  template text not null default 'modern',
  status text not null,
  void_reason text,
  voided_at timestamptz,
  issued_date_lagos date not null,
  issued_at timestamptz not null
);

-- Enable Row Level Security (default-deny, strictly owner-only)
alter table public.businesses enable row level security;
alter table public.customers enable row level security;
alter table public.catalog_items enable row level security;
alter table public.receipts enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.public_receipts enable row level security;

create policy "Owner reads own business" on public.businesses
  for select using (owner_id = auth.uid());
create policy "Owner inserts own business" on public.businesses
  for insert with check (owner_id = auth.uid());
create policy "Owner updates own business" on public.businesses
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Owner deletes own business" on public.businesses
  for delete using (owner_id = auth.uid());

create policy "Owner manages customers" on public.customers
  for all using (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  ) with check (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  );

create policy "Owner manages catalog items" on public.catalog_items
  for all using (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  ) with check (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  );

-- Receipts can only be read by owner and mutated through SECURITY DEFINER RPC functions
create policy "Owner reads own receipts" on public.receipts
  for select using (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  );

create policy "Owner reads own ledger" on public.ledger_entries
  for select using (
    business_id in (select id from public.businesses where owner_id = auth.uid())
  );

-- Direct selects on public_receipts are blocked to prevent enumeration; use get_public_receipt(id)
create policy "No direct select on public_receipts" on public.public_receipts
  for select using (false);

-- RPC: issue_receipt (gap-free sequential numbering + SALE ledger entry + public receipt snapshot)
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
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid for update;
  if not found then
    raise exception 'Business onboarding required';
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
  v_public_id := replace(replace(encode(gen_random_bytes(16), 'base64'), '+', '-'), '/', '_');
  v_public_id := rtrim(v_public_id, '=');
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
    v_template, v_status, p_issued_date_lagos, v_uid
  ) returning * into v_receipt;

  insert into public.ledger_entries (
    business_id, entry_type, amount_kobo, cash_received_kobo, payment_method,
    receipt_id, note, sold_by, source, entry_date, created_by
  ) values (
    v_biz.id, 'SALE', v_total, p_amount_paid_kobo, p_payment_method,
    v_receipt.id, coalesce(nullif(p_note, ''), 'Sale ' || v_receipt_number),
    coalesce(p_sold_by, ''), coalesce(p_source, 'manual'), p_issued_date_lagos, v_uid
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
    v_status, p_issued_date_lagos, v_receipt.issued_at
  );

  if nullif(trim(coalesce(p_customer_name, '')), '') is not null then
    insert into public.customers (business_id, name, phone)
    values (v_biz.id, trim(p_customer_name), trim(coalesce(p_customer_phone, '')));
  end if;

  return v_receipt;
end;
$$;

-- RPC: get_public_receipt (callable logged out by unguessable public_id)
create or replace function public.get_public_receipt(p_public_id text)
returns setof public.public_receipts
language sql
security definer
set search_path = public
as $$
  select * from public.public_receipts where public_id = p_public_id limit 1;
$$;

-- RPC: receive_balance (issues linked BALANCE_PAYMENT receipt + PAYMENT_RECEIVED ledger entry)
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
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid for update;
  if not found then
    raise exception 'Business not found';
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
  v_public_id := rtrim(replace(replace(encode(gen_random_bytes(16), 'base64'), '+', '-'), '/', '_'), '=');
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
    'manual', v_template, 'PAID', p_issued_date_lagos, v_uid
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
    v_child.note, v_child.sold_by, v_template, 'PAID', p_issued_date_lagos, v_child.issued_at
  );

  insert into public.ledger_entries (
    business_id, entry_type, amount_kobo, cash_received_kobo, payment_method,
    receipt_id, parent_entry_id, note, sold_by, source, entry_date, created_by
  ) values (
    v_biz.id, 'PAYMENT_RECEIVED', p_amount_kobo, p_amount_kobo, p_payment_method,
    v_child.id, v_parent.id, coalesce(nullif(p_note, ''), 'Balance received for ' || v_parent.receipt_number),
    v_child.sold_by, 'manual', p_issued_date_lagos, v_uid
  );

  return jsonb_build_object('receipt', to_jsonb(v_child), 'parentReceipt', to_jsonb(v_parent));
end;
$$;

-- RPC: void_receipt (marks VOID with reason, never hard-deletes, records ADJUSTMENT ledger entry)
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

  insert into public.ledger_entries (
    business_id, entry_type, amount_kobo, cash_received_kobo, payment_method,
    receipt_id, note, sold_by, source, entry_date, created_by
  ) values (
    v_biz.id, 'ADJUSTMENT', -v_row.total_kobo, -v_row.initial_paid_kobo, v_row.payment_method,
    v_row.id, 'VOID ' || v_row.receipt_number || ': ' || trim(p_reason), v_row.sold_by,
    'manual', ((now() at time zone 'Africa/Lagos')::date), v_uid
  );

  return v_row;
end;
$$;

grant execute on function public.issue_receipt(text, text, jsonb, text, bigint, text, text, date, text, text) to authenticated;
grant execute on function public.get_public_receipt(text) to anon, authenticated;
grant execute on function public.receive_balance(uuid, bigint, text, text, text, date, text) to authenticated;
grant execute on function public.void_receipt(uuid, text) to authenticated;
