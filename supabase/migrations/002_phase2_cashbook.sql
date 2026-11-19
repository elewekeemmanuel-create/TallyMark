-- Tallymark Phase 2 Schema (Supabase / PostgreSQL)
-- Digital Cash Book: Quick Sales, Credit Sales, Debtors/Creditors, Expenses (+ private proofs),
-- Day Closures (DB-enforced lock + visible correction entries), and Close-Day Reminder setting.

-- 1. Business reminder preference
alter table public.businesses
  add column if not exists close_day_reminder_time text not null default '19:00';

-- 2. Credit Sales ("borrowed" without an immediate receipt)
create table if not exists public.credit_sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_name text not null check (char_length(trim(customer_name)) >= 1),
  customer_phone text not null default '',
  item_note text not null default '',
  total_kobo bigint not null check (total_kobo > 0),
  amount_paid_kobo bigint not null default 0 check (amount_paid_kobo >= 0),
  balance_due_kobo bigint not null check (balance_due_kobo >= 0),
  due_date date,
  sold_by text not null default '',
  receipt_id uuid references public.receipts(id),
  status text not null default 'UNPAID' check (status in ('UNPAID', 'PART_PAID', 'PAID', 'VOID')),
  entry_date date not null default ((now() at time zone 'Africa/Lagos')::date),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id)
);
create index if not exists idx_credit_sales_business on public.credit_sales(business_id, entry_date desc);

-- 3. Creditors (what the business owes suppliers)
create table if not exists public.creditors (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  supplier_name text not null check (char_length(trim(supplier_name)) >= 1),
  phone text not null default '',
  description text not null default '',
  amount_kobo bigint not null check (amount_kobo > 0),
  due_date date,
  status text not null default 'UNPAID' check (status in ('UNPAID', 'PAID')),
  paid_at timestamptz,
  paid_method text,
  expense_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id)
);
create index if not exists idx_creditors_business on public.creditors(business_id, status, due_date);

-- 4. Expenses & Proof Photos
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  entry_date date not null default ((now() at time zone 'Africa/Lagos')::date),
  amount_kobo bigint not null check (amount_kobo > 0),
  category text not null check (char_length(trim(category)) >= 1),
  payee text not null default '',
  payment_method text not null check (payment_method in ('Cash', 'Transfer', 'POS', 'Card', 'Other')),
  note text not null default '',
  proof_path text,
  source text not null default 'manual' check (source in ('manual', 'voice')),
  ledger_entry_id uuid references public.ledger_entries(id),
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id)
);
create index if not exists idx_expenses_business_date on public.expenses(business_id, entry_date desc, created_at desc);

create table if not exists public.expense_revisions (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  action text not null check (action in ('EDIT', 'DELETE', 'CORRECTION')),
  previous_json jsonb not null,
  next_json jsonb,
  reason text not null default '',
  changed_at timestamptz not null default now(),
  changed_by uuid not null references auth.users(id)
);

-- 5. Day Closures (locks a date once closed)
create table if not exists public.day_closures (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  close_date date not null,
  opening_cash_kobo bigint not null,
  expected_cash_kobo bigint not null,
  counted_cash_kobo bigint not null,
  variance_kobo bigint not null,
  total_sales_kobo bigint not null default 0,
  quick_sales_kobo bigint not null default 0,
  receipt_sales_kobo bigint not null default 0,
  credit_sales_kobo bigint not null default 0,
  payments_received_kobo bigint not null default 0,
  expenses_kobo bigint not null default 0,
  net_kobo bigint not null default 0,
  note text not null default '',
  closed_at timestamptz not null default now(),
  closed_by uuid not null references auth.users(id),
  unique (business_id, close_date)
);
create index if not exists idx_day_closures_business on public.day_closures(business_id, close_date desc);

-- 6. Extend ledger_entries for Phase 2 unified cash book metadata
alter table public.ledger_entries
  add column if not exists entry_kind text not null default 'RECEIPT',
  add column if not exists customer_name text not null default '',
  add column if not exists customer_phone text not null default '',
  add column if not exists credit_sale_id uuid references public.credit_sales(id),
  add column if not exists expense_id uuid references public.expenses(id),
  add column if not exists is_correction boolean not null default false,
  add column if not exists correction_reason text not null default '';

-- 7. Enable RLS (owner-only, default-deny)
alter table public.credit_sales enable row level security;
alter table public.creditors enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_revisions enable row level security;
alter table public.day_closures enable row level security;

create policy "Owner manages credit sales" on public.credit_sales
  for all using (business_id in (select id from public.businesses where owner_id = auth.uid()))
  with check (business_id in (select id from public.businesses where owner_id = auth.uid()));

create policy "Owner manages creditors" on public.creditors
  for all using (business_id in (select id from public.businesses where owner_id = auth.uid()))
  with check (business_id in (select id from public.businesses where owner_id = auth.uid()));

create policy "Owner reads own expenses" on public.expenses
  for select using (business_id in (select id from public.businesses where owner_id = auth.uid()));
create policy "Owner inserts own expenses" on public.expenses
  for insert with check (business_id in (select id from public.businesses where owner_id = auth.uid()));
create policy "Owner updates own expenses" on public.expenses
  for update using (business_id in (select id from public.businesses where owner_id = auth.uid()))
  with check (business_id in (select id from public.businesses where owner_id = auth.uid()));
create policy "Owner deletes own expenses" on public.expenses
  for delete using (business_id in (select id from public.businesses where owner_id = auth.uid()));

create policy "Owner reads own expense revisions" on public.expense_revisions
  for select using (business_id in (select id from public.businesses where owner_id = auth.uid()));
create policy "Owner inserts own expense revisions" on public.expense_revisions
  for insert with check (business_id in (select id from public.businesses where owner_id = auth.uid()));

create policy "Owner reads own day closures" on public.day_closures
  for select using (business_id in (select id from public.businesses where owner_id = auth.uid()));
create policy "Owner inserts own day closures" on public.day_closures
  for insert with check (business_id in (select id from public.businesses where owner_id = auth.uid()));

-- 8. Private Storage Bucket: 'expense-proofs' (owner folder isolation)
insert into storage.buckets (id, name, public)
values ('expense-proofs', 'expense-proofs', false)
on conflict (id) do nothing;

create policy "Owner uploads own expense proofs" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'expense-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Owner reads own expense proofs" on storage.objects
  for select to authenticated
  using (bucket_id = 'expense-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Owner deletes own expense proofs" on storage.objects
  for delete to authenticated
  using (bucket_id = 'expense-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

-- 9. Database-enforced Closed-Day Lock triggers
create or replace function public.enforce_closed_day_on_ledger()
returns trigger
language plpgsql
as $$
declare
  v_date date;
  v_biz uuid;
begin
  v_date := coalesce(new.entry_date, old.entry_date);
  v_biz := coalesce(new.business_id, old.business_id);

  if exists (select 1 from public.day_closures where business_id = v_biz and close_date = v_date) then
    if tg_op = 'INSERT' and coalesce(new.is_correction, false) = true and new.entry_type = 'ADJUSTMENT' then
      return new;
    end if;
    if tg_op = 'UPDATE' and old.receipt_id is null and new.receipt_id is not null
       and new.amount_kobo = old.amount_kobo and new.cash_received_kobo = old.cash_received_kobo then
      -- Linking an official receipt to an existing quick sale does not change amounts
      return new;
    end if;
    raise exception 'Day % is closed. Post a visible correction entry instead.', v_date;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_enforce_closed_day_ledger on public.ledger_entries;
create trigger trg_enforce_closed_day_ledger
  before insert or update or delete on public.ledger_entries
  for each row execute function public.enforce_closed_day_on_ledger();

create or replace function public.enforce_closed_day_on_expenses()
returns trigger
language plpgsql
as $$
declare
  v_date date;
  v_biz uuid;
begin
  v_date := coalesce(old.entry_date, new.entry_date);
  v_biz := coalesce(old.business_id, new.business_id);

  if exists (select 1 from public.day_closures where business_id = v_biz and close_date = v_date) then
    raise exception 'Day % is closed. Expenses on a closed day cannot be edited or deleted; post a correction entry instead.', v_date;
  end if;

  if tg_op = 'UPDATE' and new.entry_date <> old.entry_date then
    if exists (select 1 from public.day_closures where business_id = v_biz and close_date = new.entry_date) then
      raise exception 'Target day % is closed.', new.entry_date;
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_enforce_closed_day_expenses on public.expenses;
create trigger trg_enforce_closed_day_expenses
  before insert or update or delete on public.expenses
  for each row execute function public.enforce_closed_day_on_expenses();

-- 10. RPC: record_credit_payment (atomically issues linked receipt + PAYMENT_RECEIVED + updates credit_sales)
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
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid for update;
  if not found then
    raise exception 'Business not found';
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
  v_public_id := rtrim(replace(replace(encode(gen_random_bytes(16), 'base64'), '+', '-'), '/', '_'), '=');
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
    'manual', v_template, 'PAID', p_issued_date_lagos, v_uid
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
    p_issued_date_lagos, v_receipt.issued_at
  );

  insert into public.ledger_entries (
    business_id, entry_type, entry_kind, amount_kobo, cash_received_kobo, payment_method,
    receipt_id, credit_sale_id, customer_name, customer_phone, note, sold_by, source, entry_date, created_by
  ) values (
    v_biz.id, 'PAYMENT_RECEIVED', 'DEBT_PAYMENT', p_amount_kobo, p_amount_kobo, p_payment_method,
    v_receipt.id, v_cs.id, v_cs.customer_name, v_cs.customer_phone,
    v_receipt.note, v_receipt.sold_by, 'manual', p_issued_date_lagos, v_uid
  );

  return jsonb_build_object('receipt', to_jsonb(v_receipt), 'creditSale', to_jsonb(v_cs));
end;
$$;

grant execute on function public.record_credit_payment(uuid, bigint, text, text, text, date, text) to authenticated;
