-- ============================================================================
-- Tallymark V2 Migration (005): Quotations, Invoices, Unified Receivables,
-- Payments, Customer Claims, Audit Log, Entitlements & Postgres Rate Limits.
--
-- Design rules:
--   - Additive only: never drops, renames, or rewrites existing V1 objects.
--   - Idempotent and wrapped in a single transaction.
--   - RLS enabled on every new table in this migration (deny by default).
--   - All SECURITY DEFINER functions use fixed search_path = public,
--     schema-qualified objects, validated arguments, no dynamic SQL, and
--     explicitly REVOKE EXECUTE FROM PUBLIC.
--   - Includes idempotent backfill of existing V1 open balances owed into
--     public.debts.
-- ============================================================================

begin;

-- ============================================================================
-- 1. ADDITIVE COLUMNS ON EXISTING V1 TABLES
-- ============================================================================

alter table public.businesses
  add column if not exists tin_rc text not null default '',
  add column if not exists bank_accounts jsonb not null default '[]'::jsonb,
  add column if not exists modules_enabled jsonb not null default '{"invoices_quotes": false}'::jsonb,
  add column if not exists plan text not null default 'early_access',
  add column if not exists invoice_prefix text not null default 'INV-',
  add column if not exists next_invoice_sequence integer not null default 1,
  add column if not exists quote_prefix text not null default 'QUO-',
  add column if not exists next_quote_sequence integer not null default 1,
  add column if not exists default_payment_terms_days integer not null default 7,
  add column if not exists default_invoice_notes text not null default '',
  add column if not exists v2_promo_dismissed boolean not null default false;

alter table public.customers
  add column if not exists address text not null default '',
  add column if not exists email text not null default '',
  add column if not exists notes text not null default '';

-- ============================================================================
-- 2. CORE V2 TABLES (ALL SLICES 1–5)
-- ============================================================================

-- 2a. Invoices
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  public_id text not null unique default replace(gen_random_uuid()::text, '-', ''),
  sequence_number integer,
  invoice_number text,
  idempotency_key text,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SENT', 'PART_PAID', 'PAID', 'SETTLED', 'VOID')),
  issue_date date not null default ((now() at time zone 'Africa/Lagos')::date),
  terms_kind text not null default 'net_7' check (terms_kind in ('due_on_receipt', 'net_7', 'net_14', 'net_30', 'custom')),
  due_date date not null default ((now() at time zone 'Africa/Lagos')::date + 7),
  currency text not null default 'NGN',
  customer_name text not null default '',
  customer_phone text not null default '',
  customer_email text not null default '',
  customer_address text not null default '',
  subtotal_kobo bigint not null default 0 check (subtotal_kobo >= 0),
  line_discount_total_kobo bigint not null default 0 check (line_discount_total_kobo >= 0),
  invoice_discount_kobo bigint not null default 0 check (invoice_discount_kobo >= 0),
  vat_enabled boolean not null default false,
  vat_mode text not null default 'exclusive' check (vat_mode in ('inclusive', 'exclusive')),
  vat_rate_bps integer not null default 750 check (vat_rate_bps >= 0 and vat_rate_bps <= 5000),
  vat_kobo bigint not null default 0 check (vat_kobo >= 0),
  total_kobo bigint not null default 0 check (total_kobo >= 0),
  deposit_type text not null default 'none' check (deposit_type in ('none', 'percent', 'fixed')),
  deposit_value bigint not null default 0 check (deposit_value >= 0),
  amount_due_now_kobo bigint not null default 0 check (amount_due_now_kobo >= 0),
  amount_paid_kobo bigint not null default 0 check (amount_paid_kobo >= 0),
  written_off_kobo bigint not null default 0 check (written_off_kobo >= 0),
  balance_due_kobo bigint not null default 0 check (balance_due_kobo >= 0),
  notes text not null default '',
  bank_account_ids jsonb not null default '[]'::jsonb,
  template text not null default 'modern' check (template in ('modern', 'classic', 'compact')),
  snapshot_json jsonb,
  source_quote_id uuid,
  reissued_from_id uuid references public.invoices(id) on delete set null,
  sent_at timestamptz,
  void_reason text,
  voided_at timestamptz,
  write_off_reason text,
  written_off_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  unique (business_id, sequence_number),
  unique (business_id, idempotency_key)
);

create index if not exists idx_invoices_business_date on public.invoices(business_id, issue_date desc, created_at desc);
create index if not exists idx_invoices_business_status on public.invoices(business_id, status, due_date);
create index if not exists idx_invoices_customer on public.invoices(business_id, customer_id);

-- 2b. Invoice Line Items (qty stored as integer thousandths for up to 3 decimals)
create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  position integer not null default 0,
  description text not null check (char_length(trim(description)) >= 1),
  qty_thousandths bigint not null check (qty_thousandths > 0),
  unit_price_kobo bigint not null check (unit_price_kobo >= 0),
  discount_kobo bigint not null default 0 check (discount_kobo >= 0),
  gross_kobo bigint not null default 0 check (gross_kobo >= 0),
  line_total_kobo bigint not null default 0 check (line_total_kobo >= 0)
);

create index if not exists idx_invoice_lines_invoice on public.invoice_lines(invoice_id, position);

-- 2c. Quotations (Schema ready for Slice 3)
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  public_id text not null unique default replace(gen_random_uuid()::text, '-', ''),
  sequence_number integer,
  quote_number text,
  idempotency_key text,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'CONVERTED', 'VOID')),
  issue_date date not null default ((now() at time zone 'Africa/Lagos')::date),
  valid_until date not null default ((now() at time zone 'Africa/Lagos')::date + 14),
  terms_kind text not null default 'net_7' check (terms_kind in ('due_on_receipt', 'net_7', 'net_14', 'net_30', 'custom')),
  currency text not null default 'NGN',
  customer_name text not null default '',
  customer_phone text not null default '',
  customer_email text not null default '',
  customer_address text not null default '',
  subtotal_kobo bigint not null default 0 check (subtotal_kobo >= 0),
  line_discount_total_kobo bigint not null default 0 check (line_discount_total_kobo >= 0),
  invoice_discount_kobo bigint not null default 0 check (invoice_discount_kobo >= 0),
  vat_enabled boolean not null default false,
  vat_mode text not null default 'exclusive' check (vat_mode in ('inclusive', 'exclusive')),
  vat_rate_bps integer not null default 750 check (vat_rate_bps >= 0 and vat_rate_bps <= 5000),
  vat_kobo bigint not null default 0 check (vat_kobo >= 0),
  total_kobo bigint not null default 0 check (total_kobo >= 0),
  deposit_type text not null default 'none' check (deposit_type in ('none', 'percent', 'fixed')),
  deposit_value bigint not null default 0 check (deposit_value >= 0),
  amount_due_now_kobo bigint not null default 0 check (amount_due_now_kobo >= 0),
  notes text not null default '',
  bank_account_ids jsonb not null default '[]'::jsonb,
  template text not null default 'modern' check (template in ('modern', 'classic', 'compact')),
  snapshot_json jsonb,
  converted_invoice_id uuid unique references public.invoices(id) on delete set null,
  revised_from_id uuid references public.quotes(id) on delete set null,
  sent_at timestamptz,
  decision_name text,
  decision_note text,
  decision_at timestamptz,
  decision_ip_hash text,
  void_reason text,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  unique (business_id, sequence_number),
  unique (business_id, idempotency_key)
);

create index if not exists idx_quotes_business_date on public.quotes(business_id, issue_date desc, created_at desc);

create table if not exists public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  position integer not null default 0,
  description text not null check (char_length(trim(description)) >= 1),
  qty_thousandths bigint not null check (qty_thousandths > 0),
  unit_price_kobo bigint not null check (unit_price_kobo >= 0),
  discount_kobo bigint not null default 0 check (discount_kobo >= 0),
  gross_kobo bigint not null default 0 check (gross_kobo >= 0),
  line_total_kobo bigint not null default 0 check (line_total_kobo >= 0)
);

create index if not exists idx_quote_lines_quote on public.quote_lines(quote_id, position);

-- 2d. Unified Receivables / Debts Table (Invoices, Part-Paid Receipts, Credit Sales)
create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  source_type text not null check (source_type in ('INVOICE', 'RECEIPT', 'CREDIT_SALE')),
  source_id uuid not null,
  reference_number text not null default '',
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null default '',
  customer_phone text not null default '',
  issue_date date not null,
  due_date date,
  total_kobo bigint not null check (total_kobo >= 0),
  amount_paid_kobo bigint not null default 0 check (amount_paid_kobo >= 0),
  written_off_kobo bigint not null default 0 check (written_off_kobo >= 0),
  balance_due_kobo bigint not null check (balance_due_kobo >= 0),
  status text not null default 'OPEN' check (status in ('OPEN', 'PART_PAID', 'PAID', 'SETTLED', 'VOID')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, source_id)
);

create index if not exists idx_debts_business_status on public.debts(business_id, status, due_date);
create index if not exists idx_debts_customer on public.debts(business_id, customer_id);

-- 2e. Payments (created ONLY via record_payment)
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  debt_id uuid not null references public.debts(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  receipt_id uuid references public.receipts(id) on delete set null,
  ledger_entry_id uuid references public.ledger_entries(id) on delete set null,
  amount_kobo bigint not null check (amount_kobo > 0),
  payment_method text not null check (payment_method in ('Cash', 'Transfer', 'POS', 'Card', 'Other')),
  payment_date date not null,
  reference text not null default '',
  idempotency_key text not null,
  is_voided boolean not null default false,
  void_reason text,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  unique (business_id, idempotency_key)
);

create index if not exists idx_payments_debt on public.payments(debt_id, created_at desc);
create index if not exists idx_payments_business_date on public.payments(business_id, payment_date desc);

-- Additive FK links on ledger_entries
alter table public.ledger_entries
  add column if not exists invoice_id uuid references public.invoices(id) on delete set null,
  add column if not exists payment_id uuid references public.payments(id) on delete set null;

-- 2f. Customer "I've Paid" Claims (Schema ready for Slice 2)
create table if not exists public.payment_claims (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  claim_ref text not null unique,
  payer_name text not null check (char_length(trim(payer_name)) between 1 and 80),
  amount_kobo bigint not null check (amount_kobo > 0),
  reference text not null default '' check (char_length(reference) <= 40),
  proof_path text,
  proof_mime text,
  proof_size_bytes integer,
  proof_deleted_at timestamptz,
  upload_token_hash text,
  upload_token_expires_at timestamptz,
  upload_token_used_at timestamptz,
  status text not null default 'PENDING' check (status in ('PENDING', 'CONFIRMED', 'REJECTED')),
  decision_reason text,
  decided_at timestamptz,
  decided_by uuid references auth.users(id),
  payment_id uuid references public.payments(id) on delete set null,
  ip_hash text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_payment_claims_invoice on public.payment_claims(invoice_id, status, created_at desc);
create index if not exists idx_payment_claims_business on public.payment_claims(business_id, status, created_at desc);

-- 2g. Payment Reminders Log (Schema ready for Slice 4)
create table if not exists public.payment_reminders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  debt_id uuid not null references public.debts(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  tone text not null default 'gentle' check (tone in ('gentle', 'firm')),
  channel text not null default 'whatsapp',
  sent_at timestamptz not null default now(),
  sent_by uuid not null references auth.users(id)
);

create index if not exists idx_payment_reminders_debt on public.payment_reminders(business_id, debt_id, sent_at desc);

-- 2h. Append-Only Audit Log
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(trim(action)) >= 2),
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_business_created on public.audit_log(business_id, created_at desc);

-- 2i. Monthly Usage Counters (for future plan gating without refactor)
create table if not exists public.usage_counters (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  month_key text not null check (month_key ~ '^\d{4}-\d{2}$'),
  receipts_issued integer not null default 0,
  invoices_issued integer not null default 0,
  quotes_issued integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (business_id, month_key)
);

-- 2j. Web Push Subscriptions (Schema ready for Slice 2)
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists idx_push_subs_business on public.push_subscriptions(business_id);

-- 2k. Postgres-Backed Rate Limits (never stored in server memory)
create table if not exists public.rate_limits (
  bucket_key text not null,
  window_start timestamptz not null,
  hit_count integer not null default 1,
  expires_at timestamptz not null,
  primary key (bucket_key, window_start)
);

create index if not exists idx_rate_limits_expires on public.rate_limits(expires_at);

-- 2l. Private Storage Bucket for Customer Claim Proofs
insert into storage.buckets (id, name, public)
values ('claim-proofs', 'claim-proofs', false)
on conflict (id) do nothing;

-- ============================================================================
-- 3. ENABLE ROW LEVEL SECURITY (DENY BY DEFAULT ON EVERY NEW TABLE)
-- ============================================================================

alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_lines enable row level security;
alter table public.debts enable row level security;
alter table public.payments enable row level security;
alter table public.payment_claims enable row level security;
alter table public.payment_reminders enable row level security;
alter table public.audit_log enable row level security;
alter table public.usage_counters enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.rate_limits enable row level security;

-- Revoke direct anonymous access on all V2 tables explicitly
revoke all on public.invoices, public.invoice_lines, public.quotes, public.quote_lines,
  public.debts, public.payments, public.payment_claims, public.payment_reminders,
  public.audit_log, public.usage_counters, public.push_subscriptions, public.rate_limits
from anon;

revoke all on public.rate_limits from authenticated;

-- Invoices: owner reads only (all mutations via SECURITY DEFINER RPCs)
drop policy if exists "Owner reads own invoices" on public.invoices;
create policy "Owner reads own invoices" on public.invoices
  for select to authenticated
  using (business_id in (select id from public.businesses where owner_id = auth.uid()));

drop policy if exists "Owner reads own invoice lines" on public.invoice_lines;
create policy "Owner reads own invoice lines" on public.invoice_lines
  for select to authenticated
  using (business_id in (select id from public.businesses where owner_id = auth.uid()));

-- Quotes: owner reads only (all mutations via SECURITY DEFINER RPCs)
drop policy if exists "Owner reads own quotes" on public.quotes;
create policy "Owner reads own quotes" on public.quotes
  for select to authenticated
  using (business_id in (select id from public.businesses where owner_id = auth.uid()));

drop policy if exists "Owner reads own quote lines" on public.quote_lines;
create policy "Owner reads own quote lines" on public.quote_lines
  for select to authenticated
  using (business_id in (select id from public.businesses where owner_id = auth.uid()));

-- Debts & Payments: owner reads only (mutated strictly via RPCs)
drop policy if exists "Owner reads own debts" on public.debts;
create policy "Owner reads own debts" on public.debts
  for select to authenticated
  using (business_id in (select id from public.businesses where owner_id = auth.uid()));

drop policy if exists "Owner reads own payments" on public.payments;
create policy "Owner reads own payments" on public.payments
  for select to authenticated
  using (business_id in (select id from public.businesses where owner_id = auth.uid()));

-- Payment claims: owner reads own claims (decided via RPC; created via server)
drop policy if exists "Owner reads own payment claims" on public.payment_claims;
create policy "Owner reads own payment claims" on public.payment_claims
  for select to authenticated
  using (business_id in (select id from public.businesses where owner_id = auth.uid()));

-- Payment reminders: owner reads & inserts own reminders
drop policy if exists "Owner reads own payment reminders" on public.payment_reminders;
create policy "Owner reads own payment reminders" on public.payment_reminders
  for select to authenticated
  using (business_id in (select id from public.businesses where owner_id = auth.uid()));

drop policy if exists "Owner inserts own payment reminders" on public.payment_reminders;
create policy "Owner inserts own payment reminders" on public.payment_reminders
  for insert to authenticated
  with check (business_id in (select id from public.businesses where owner_id = auth.uid()));

-- Audit log: strictly append-only (owner SELECT only; no INSERT/UPDATE/DELETE policies)
drop policy if exists "Owner reads own audit log" on public.audit_log;
create policy "Owner reads own audit log" on public.audit_log
  for select to authenticated
  using (business_id in (select id from public.businesses where owner_id = auth.uid()));

-- Usage counters: owner SELECT only
drop policy if exists "Owner reads own usage counters" on public.usage_counters;
create policy "Owner reads own usage counters" on public.usage_counters
  for select to authenticated
  using (business_id in (select id from public.businesses where owner_id = auth.uid()));

-- Push subscriptions: owner manages own subscriptions
drop policy if exists "Owner manages own push subscriptions" on public.push_subscriptions;
create policy "Owner manages own push subscriptions" on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid() and business_id in (select id from public.businesses where owner_id = auth.uid()))
  with check (user_id = auth.uid() and business_id in (select id from public.businesses where owner_id = auth.uid()));

-- Claim proofs storage policy: owner reads only their own business folder
-- Wrapped safely so Supabase SQL Editor never rolls back the whole migration if storage.objects is owned by supabase_storage_admin.
do $$
begin
  drop policy if exists "Owner reads own claim proofs" on storage.objects;
  create policy "Owner reads own claim proofs" on storage.objects
    for select to authenticated
    using (
      bucket_id = 'claim-proofs'
      and (storage.foldername(name))[1] in (
        select id::text from public.businesses where owner_id = auth.uid()
      )
    );
exception
  when insufficient_privilege then
    raise notice 'Skipped storage.objects policy (bucket claim-proofs remains private by default).';
end;
$$;

-- ============================================================================
-- 4. IDEMPOTENT BACKFILL OF EXISTING V1 BALANCES OWED INTO PUBLIC.DEBTS
-- ============================================================================

insert into public.debts (
  business_id,
  source_type,
  source_id,
  reference_number,
  customer_name,
  customer_phone,
  issue_date,
  due_date,
  total_kobo,
  amount_paid_kobo,
  written_off_kobo,
  balance_due_kobo,
  status,
  created_at,
  updated_at
)
select
  r.business_id,
  'RECEIPT',
  r.id,
  r.receipt_number,
  r.customer_name,
  r.customer_phone,
  r.issued_date_lagos,
  null,
  r.total_kobo,
  r.amount_paid_kobo,
  0,
  r.balance_due_kobo,
  'PART_PAID',
  r.issued_at,
  now()
from public.receipts r
where r.receipt_kind = 'SALE'
  and r.status = 'PART_PAID'
  and r.balance_due_kobo > 0
on conflict (source_type, source_id) do nothing;

insert into public.debts (
  business_id,
  source_type,
  source_id,
  reference_number,
  customer_name,
  customer_phone,
  issue_date,
  due_date,
  total_kobo,
  amount_paid_kobo,
  written_off_kobo,
  balance_due_kobo,
  status,
  created_at,
  updated_at
)
select
  cs.business_id,
  'CREDIT_SALE',
  cs.id,
  'Credit · ' || cs.entry_date::text,
  cs.customer_name,
  cs.customer_phone,
  cs.entry_date,
  cs.due_date,
  cs.total_kobo,
  cs.amount_paid_kobo,
  0,
  cs.balance_due_kobo,
  case when cs.amount_paid_kobo > 0 then 'PART_PAID' else 'OPEN' end,
  cs.created_at,
  now()
from public.credit_sales cs
where cs.status in ('UNPAID', 'PART_PAID')
  and cs.balance_due_kobo > 0
on conflict (source_type, source_id) do nothing;

-- ============================================================================
-- 5. SECURITY DEFINER FUNCTIONS (FIXED search_path, REVOKED FROM PUBLIC)
-- ============================================================================

-- 5a. Exact integer round-half-up division for non-negative numerators & positive denominators
create or replace function public.v2_round_half_up_div(p_num bigint, p_den bigint)
returns bigint
language plpgsql
immutable
set search_path = public
as $$
declare
  v_q bigint;
  v_r bigint;
begin
  if p_den is null or p_den <= 0 then
    raise exception 'Invalid denominator';
  end if;
  if p_num is null or p_num <= 0 then
    return 0;
  end if;
  v_q := p_num / p_den;
  v_r := p_num % p_den;
  if v_r * 2 >= p_den then
    return v_q + 1;
  end if;
  return v_q;
end;
$$;
revoke all on function public.v2_round_half_up_div(bigint, bigint) from public;
grant execute on function public.v2_round_half_up_div(bigint, bigint) to authenticated;

-- 5b. Entitlements helper (early access returns true for everything)
create or replace function public.can_use(p_business_id uuid, p_feature text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
begin
  if p_business_id is null or p_feature is null or char_length(trim(p_feature)) = 0 then
    return false;
  end if;

  select b.plan into v_plan
  from public.businesses b
  where b.id = p_business_id
    and b.owner_id = auth.uid();

  if v_plan is null then
    return false;
  end if;

  if v_plan = 'early_access' then
    return true;
  end if;

  return true;
end;
$$;
revoke all on function public.can_use(uuid, text) from public;
grant execute on function public.can_use(uuid, text) to authenticated;

-- 5c. Internal append-only audit logger (not directly callable by clients)
create or replace function public.v2_log_audit(
  p_business_id uuid,
  p_actor_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (business_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_business_id, p_actor_id, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;
revoke all on function public.v2_log_audit(uuid, uuid, text, text, uuid, jsonb) from public;

-- 5d. Internal usage counter incrementer
create or replace function public.v2_increment_usage(p_business_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month text;
begin
  v_month := to_char((now() at time zone 'Africa/Lagos')::date, 'YYYY-MM');
  insert into public.usage_counters (business_id, month_key, receipts_issued, invoices_issued, quotes_issued, updated_at)
  values (
    p_business_id,
    v_month,
    case when p_kind = 'receipt' then 1 else 0 end,
    case when p_kind = 'invoice' then 1 else 0 end,
    case when p_kind = 'quote' then 1 else 0 end,
    now()
  )
  on conflict (business_id, month_key) do update
  set
    receipts_issued = public.usage_counters.receipts_issued + case when p_kind = 'receipt' then 1 else 0 end,
    invoices_issued = public.usage_counters.invoices_issued + case when p_kind = 'invoice' then 1 else 0 end,
    quotes_issued = public.usage_counters.quotes_issued + case when p_kind = 'quote' then 1 else 0 end,
    updated_at = now();
end;
$$;
revoke all on function public.v2_increment_usage(uuid, text) from public;

-- 5e. Toggle V2 module or dismiss Home card (audit-logged)
create or replace function public.v2_toggle_module(
  p_enabled boolean,
  p_dismiss_promo boolean default null
)
returns public.businesses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz public.businesses%rowtype;
  v_prev boolean;
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid for update;
  if not found then
    raise exception 'Business not found';
  end if;

  v_prev := coalesce((v_biz.modules_enabled ->> 'invoices_quotes')::boolean, false);

  update public.businesses
  set
    modules_enabled = jsonb_set(coalesce(modules_enabled, '{}'::jsonb), '{invoices_quotes}', to_jsonb(coalesce(p_enabled, v_prev)), true),
    v2_promo_dismissed = coalesce(p_dismiss_promo, v2_promo_dismissed),
    updated_at = now()
  where id = v_biz.id
  returning * into v_biz;

  if p_enabled is not null and p_enabled <> v_prev then
    perform public.v2_log_audit(
      v_biz.id,
      v_uid,
      'module_toggled',
      'business',
      v_biz.id,
      jsonb_build_object('module', 'invoices_quotes', 'enabled', p_enabled)
    );
  end if;

  return v_biz;
end;
$$;
revoke all on function public.v2_toggle_module(boolean, boolean) from public;
grant execute on function public.v2_toggle_module(boolean, boolean) to authenticated;

-- 5f. Update billing details (TIN/RC, bank accounts, prefixes, default terms) with audit log
create or replace function public.v2_update_billing_settings(
  p_tin_rc text default null,
  p_bank_accounts jsonb default null,
  p_invoice_prefix text default null,
  p_quote_prefix text default null,
  p_default_payment_terms_days integer default null,
  p_default_invoice_notes text default null
)
returns public.businesses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz public.businesses%rowtype;
  v_old_banks jsonb;
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid for update;
  if not found then
    raise exception 'Business not found';
  end if;

  if p_invoice_prefix is not null and (char_length(trim(p_invoice_prefix)) < 1 or char_length(trim(p_invoice_prefix)) > 12 or p_invoice_prefix !~ '^[A-Za-z0-9_-]+$') then
    raise exception 'Invoice prefix must be 1–12 letters, numbers, hyphens, or underscores';
  end if;
  if p_quote_prefix is not null and (char_length(trim(p_quote_prefix)) < 1 or char_length(trim(p_quote_prefix)) > 12 or p_quote_prefix !~ '^[A-Za-z0-9_-]+$') then
    raise exception 'Quote prefix must be 1–12 letters, numbers, hyphens, or underscores';
  end if;
  if p_bank_accounts is not null and jsonb_typeof(p_bank_accounts) <> 'array' then
    raise exception 'Bank accounts must be an array';
  end if;
  if p_default_payment_terms_days is not null and (p_default_payment_terms_days < 0 or p_default_payment_terms_days > 365) then
    raise exception 'Default terms must be between 0 and 365 days';
  end if;

  v_old_banks := coalesce(v_biz.bank_accounts, '[]'::jsonb);

  update public.businesses
  set
    tin_rc = coalesce(left(trim(p_tin_rc), 60), tin_rc),
    bank_accounts = coalesce(p_bank_accounts, bank_accounts),
    invoice_prefix = coalesce(trim(p_invoice_prefix), invoice_prefix),
    quote_prefix = coalesce(trim(p_quote_prefix), quote_prefix),
    default_payment_terms_days = coalesce(p_default_payment_terms_days, default_payment_terms_days),
    default_invoice_notes = coalesce(left(trim(p_default_invoice_notes), 600), default_invoice_notes),
    updated_at = now()
  where id = v_biz.id
  returning * into v_biz;

  if p_bank_accounts is not null and p_bank_accounts is distinct from v_old_banks then
    perform public.v2_log_audit(
      v_biz.id,
      v_uid,
      'bank_details_updated',
      'business',
      v_biz.id,
      jsonb_build_object('bank_count', jsonb_array_length(p_bank_accounts))
    );
  end if;

  return v_biz;
end;
$$;
revoke all on function public.v2_update_billing_settings(text, jsonb, text, text, integer, text) from public;
grant execute on function public.v2_update_billing_settings(text, jsonb, text, text, integer, text) to authenticated;

-- 5g. Save (create or update) a DRAFT invoice with exact round-half-up accounting
create or replace function public.v2_save_invoice_draft(
  p_invoice_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_customer_address text,
  p_issue_date date,
  p_terms_kind text,
  p_due_date date,
  p_lines jsonb,
  p_invoice_discount_kobo bigint,
  p_deposit_type text,
  p_deposit_value bigint,
  p_notes text,
  p_bank_account_ids jsonb,
  p_template text,
  p_idempotency_key text
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz public.businesses%rowtype;
  v_existing public.invoices%rowtype;
  v_inv public.invoices%rowtype;
  v_line jsonb;
  v_pos integer := 0;
  v_desc text;
  v_qty_th bigint;
  v_unit_price bigint;
  v_line_disc bigint;
  v_gross bigint;
  v_line_total bigint;
  v_subtotal bigint := 0;
  v_line_disc_total bigint := 0;
  v_lines_net bigint := 0;
  v_inv_disc bigint := greatest(0, coalesce(p_invoice_discount_kobo, 0));
  v_taxable bigint := 0;
  v_vat bigint := 0;
  v_total bigint := 0;
  v_dep_type text := coalesce(p_deposit_type, 'none');
  v_dep_val bigint := greatest(0, coalesce(p_deposit_value, 0));
  v_due_now bigint := 0;
  v_issue date := coalesce(p_issue_date, (now() at time zone 'Africa/Lagos')::date);
  v_due date;
  v_cust_id uuid := p_customer_id;
  v_cust_name text := left(trim(coalesce(p_customer_name, '')), 120);
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid;
  if not found then
    raise exception 'Business not found';
  end if;

  if not public.can_use(v_biz.id, 'invoices_quotes') then
    raise exception 'Feature unavailable on current plan';
  end if;

  if p_invoice_id is null and p_idempotency_key is not null and char_length(trim(p_idempotency_key)) > 0 then
    select * into v_existing
    from public.invoices
    where business_id = v_biz.id and idempotency_key = trim(p_idempotency_key);
    if found then
      return v_existing;
    end if;
  end if;

  if char_length(v_cust_name) < 1 then
    raise exception 'Customer name is required';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 50 then
    raise exception 'Add between 1 and 50 line items';
  end if;

  if p_terms_kind not in ('due_on_receipt', 'net_7', 'net_14', 'net_30', 'custom') then
    raise exception 'Invalid payment terms';
  end if;

  v_due := case p_terms_kind
    when 'due_on_receipt' then v_issue
    when 'net_7' then v_issue + 7
    when 'net_14' then v_issue + 14
    when 'net_30' then v_issue + 30
    else coalesce(p_due_date, v_issue)
  end;

  if v_due < v_issue then
    raise exception 'Due date cannot be earlier than issue date';
  end if;

  if v_cust_id is not null then
    if not exists (select 1 from public.customers where id = v_cust_id and business_id = v_biz.id) then
      raise exception 'Customer not found';
    end if;
  else
    -- Upsert saved customer record
    select id into v_cust_id
    from public.customers
    where business_id = v_biz.id and lower(name) = lower(v_cust_name)
    order by updated_at desc
    limit 1;

    if v_cust_id is null then
      insert into public.customers (business_id, name, phone, email, address)
      values (
        v_biz.id,
        v_cust_name,
        left(trim(coalesce(p_customer_phone, '')), 40),
        left(trim(coalesce(p_customer_email, '')), 120),
        left(trim(coalesce(p_customer_address, '')), 240)
      )
      returning id into v_cust_id;
    else
      update public.customers
      set
        phone = coalesce(nullif(left(trim(coalesce(p_customer_phone, '')), 40), ''), phone),
        email = coalesce(nullif(left(trim(coalesce(p_customer_email, '')), 120), ''), email),
        address = coalesce(nullif(left(trim(coalesce(p_customer_address, '')), 240), ''), address),
        updated_at = now()
      where id = v_cust_id;
    end if;
  end if;

  -- First pass: compute exact totals using round-half-up
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_desc := left(trim(coalesce(v_line ->> 'description', '')), 160);
    if char_length(v_desc) < 1 then
      raise exception 'Each line item requires a description';
    end if;
    v_qty_th := coalesce((v_line ->> 'qtyThousandths')::bigint, 0);
    if v_qty_th <= 0 or v_qty_th > 1000000000 then
      raise exception 'Quantity must be greater than zero';
    end if;
    v_unit_price := coalesce((v_line ->> 'unitPriceKobo')::bigint, -1);
    if v_unit_price < 0 then
      raise exception 'Unit price cannot be negative';
    end if;
    v_gross := public.v2_round_half_up_div(v_qty_th * v_unit_price, 1000);
    v_line_disc := least(v_gross, greatest(0, coalesce((v_line ->> 'discountKobo')::bigint, 0)));
    v_line_total := v_gross - v_line_disc;

    v_subtotal := v_subtotal + v_gross;
    v_line_disc_total := v_line_disc_total + v_line_disc;
    v_lines_net := v_lines_net + v_line_total;
  end loop;

  v_inv_disc := least(v_lines_net, v_inv_disc);
  v_taxable := greatest(0, v_lines_net - v_inv_disc);

  if v_biz.vat_enabled and v_biz.vat_rate_bps > 0 and v_taxable > 0 then
    if v_biz.vat_mode = 'exclusive' then
      v_vat := public.v2_round_half_up_div(v_taxable * v_biz.vat_rate_bps, 10000);
      v_total := v_taxable + v_vat;
    else
      v_vat := public.v2_round_half_up_div(v_taxable * v_biz.vat_rate_bps, 10000 + v_biz.vat_rate_bps);
      v_total := v_taxable;
    end if;
  else
    v_vat := 0;
    v_total := v_taxable;
  end if;

  if v_dep_type = 'percent' then
    v_dep_val := least(10000, v_dep_val); -- stored in basis points (e.g., 5000 = 50%)
    v_due_now := public.v2_round_half_up_div(v_total * v_dep_val, 10000);
  elsif v_dep_type = 'fixed' then
    v_due_now := least(v_total, v_dep_val);
  else
    v_dep_type := 'none';
    v_dep_val := 0;
    v_due_now := v_total;
  end if;

  if p_invoice_id is not null then
    select * into v_existing from public.invoices where id = p_invoice_id and business_id = v_biz.id for update;
    if not found then
      raise exception 'Invoice not found';
    end if;
    if v_existing.status <> 'DRAFT' then
      raise exception 'Sent invoices are locked and cannot be edited. Reissue instead.';
    end if;

    update public.invoices
    set
      customer_id = v_cust_id,
      customer_name = v_cust_name,
      customer_phone = left(trim(coalesce(p_customer_phone, '')), 40),
      customer_email = left(trim(coalesce(p_customer_email, '')), 120),
      customer_address = left(trim(coalesce(p_customer_address, '')), 240),
      issue_date = v_issue,
      terms_kind = p_terms_kind,
      due_date = v_due,
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
      balance_due_kobo = v_total,
      notes = left(trim(coalesce(p_notes, '')), 600),
      bank_account_ids = coalesce(p_bank_account_ids, '[]'::jsonb),
      template = coalesce(nullif(p_template, ''), v_biz.default_template),
      updated_at = now()
    where id = v_existing.id
    returning * into v_inv;

    delete from public.invoice_lines where invoice_id = v_inv.id;
  else
    insert into public.invoices (
      business_id, customer_id, idempotency_key, status,
      issue_date, terms_kind, due_date, currency,
      customer_name, customer_phone, customer_email, customer_address,
      subtotal_kobo, line_discount_total_kobo, invoice_discount_kobo,
      vat_enabled, vat_mode, vat_rate_bps, vat_kobo, total_kobo,
      deposit_type, deposit_value, amount_due_now_kobo,
      amount_paid_kobo, written_off_kobo, balance_due_kobo,
      notes, bank_account_ids, template, created_by
    ) values (
      v_biz.id, v_cust_id, nullif(trim(coalesce(p_idempotency_key, '')), ''), 'DRAFT',
      v_issue, p_terms_kind, v_due, v_biz.currency,
      v_cust_name,
      left(trim(coalesce(p_customer_phone, '')), 40),
      left(trim(coalesce(p_customer_email, '')), 120),
      left(trim(coalesce(p_customer_address, '')), 240),
      v_subtotal, v_line_disc_total, v_inv_disc,
      v_biz.vat_enabled, v_biz.vat_mode, v_biz.vat_rate_bps, v_vat, v_total,
      v_dep_type, v_dep_val, v_due_now,
      0, 0, v_total,
      left(trim(coalesce(p_notes, '')), 600),
      coalesce(p_bank_account_ids, '[]'::jsonb),
      coalesce(nullif(p_template, ''), v_biz.default_template),
      v_uid
    )
    returning * into v_inv;
  end if;

  -- Insert normalized lines
  v_pos := 0;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_desc := left(trim(coalesce(v_line ->> 'description', '')), 160);
    v_qty_th := (v_line ->> 'qtyThousandths')::bigint;
    v_unit_price := (v_line ->> 'unitPriceKobo')::bigint;
    v_gross := public.v2_round_half_up_div(v_qty_th * v_unit_price, 1000);
    v_line_disc := least(v_gross, greatest(0, coalesce((v_line ->> 'discountKobo')::bigint, 0)));
    v_line_total := v_gross - v_line_disc;

    insert into public.invoice_lines (
      invoice_id, business_id, position, description,
      qty_thousandths, unit_price_kobo, discount_kobo, gross_kobo, line_total_kobo
    ) values (
      v_inv.id, v_biz.id, v_pos, v_desc,
      v_qty_th, v_unit_price, v_line_disc, v_gross, v_line_total
    );
    v_pos := v_pos + 1;
  end loop;

  return v_inv;
end;
$$;
revoke all on function public.v2_save_invoice_draft(uuid, uuid, text, text, text, text, date, text, date, jsonb, bigint, text, bigint, text, jsonb, text, text) from public;
grant execute on function public.v2_save_invoice_draft(uuid, uuid, text, text, text, text, date, text, date, jsonb, bigint, text, bigint, text, jsonb, text, text) to authenticated;

-- 5h. Send (issue & lock) a DRAFT invoice: allocates gap-free number, stores immutable snapshot, creates debt (NO ledger money entry)
create or replace function public.v2_send_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz public.businesses%rowtype;
  v_inv public.invoices%rowtype;
  v_seq integer;
  v_number text;
  v_lines_json jsonb;
  v_banks_json jsonb;
  v_snapshot jsonb;
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid for update;
  if not found then
    raise exception 'Business not found';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id and business_id = v_biz.id for update;
  if not found then
    raise exception 'Invoice not found';
  end if;

  if v_inv.status <> 'DRAFT' then
    -- Idempotent if already sent
    if v_inv.status in ('SENT', 'PART_PAID', 'PAID', 'SETTLED') then
      return v_inv;
    end if;
    raise exception 'Cannot send a voided invoice';
  end if;

  if v_inv.total_kobo <= 0 then
    raise exception 'Invoice total must be greater than zero';
  end if;

  v_seq := v_biz.next_invoice_sequence;
  v_number := v_biz.invoice_prefix || lpad(v_seq::text, 4, '0');

  update public.businesses
  set next_invoice_sequence = next_invoice_sequence + 1, updated_at = now()
  where id = v_biz.id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'description', il.description,
      'qtyThousandths', il.qty_thousandths,
      'unitPriceKobo', il.unit_price_kobo,
      'discountKobo', il.discount_kobo,
      'grossKobo', il.gross_kobo,
      'lineTotalKobo', il.line_total_kobo
    ) order by il.position asc
  ), '[]'::jsonb)
  into v_lines_json
  from public.invoice_lines il
  where il.invoice_id = v_inv.id;

  -- Filter business bank accounts to the ones selected on the invoice (or all if none selected)
  if jsonb_typeof(v_inv.bank_account_ids) = 'array' and jsonb_array_length(v_inv.bank_account_ids) > 0 then
    select coalesce(jsonb_agg(elem), '[]'::jsonb)
    into v_banks_json
    from jsonb_array_elements(coalesce(v_biz.bank_accounts, '[]'::jsonb)) elem
    where (elem ->> 'id') in (select jsonb_array_elements_text(v_inv.bank_account_ids));
  else
    v_banks_json := coalesce(v_biz.bank_accounts, '[]'::jsonb);
  end if;

  v_snapshot := jsonb_build_object(
    'invoiceNumber', v_number,
    'business', jsonb_build_object(
      'name', v_biz.name,
      'logoDataUrl', v_biz.logo_data_url,
      'address', v_biz.address,
      'phone', v_biz.phone,
      'email', v_biz.email,
      'tinRc', v_biz.tin_rc,
      'brandColor', v_biz.brand_color,
      'currency', v_biz.currency
    ),
    'customer', jsonb_build_object(
      'name', v_inv.customer_name,
      'address', v_inv.customer_address
    ),
    'bankAccounts', v_banks_json,
    'issueDate', v_inv.issue_date,
    'dueDate', v_inv.due_date,
    'termsKind', v_inv.terms_kind,
    'lines', v_lines_json,
    'subtotalKobo', v_inv.subtotal_kobo,
    'lineDiscountTotalKobo', v_inv.line_discount_total_kobo,
    'invoiceDiscountKobo', v_inv.invoice_discount_kobo,
    'vatEnabled', v_inv.vat_enabled,
    'vatMode', v_inv.vat_mode,
    'vatRateBps', v_inv.vat_rate_bps,
    'vatKobo', v_inv.vat_kobo,
    'totalKobo', v_inv.total_kobo,
    'depositType', v_inv.deposit_type,
    'depositValue', v_inv.deposit_value,
    'amountDueNowKobo', v_inv.amount_due_now_kobo,
    'notes', v_inv.notes,
    'template', v_inv.template,
    'showBranding', true
  );

  update public.invoices
  set
    sequence_number = v_seq,
    invoice_number = v_number,
    status = 'SENT',
    snapshot_json = v_snapshot,
    sent_at = now(),
    updated_at = now()
  where id = v_inv.id
  returning * into v_inv;

  -- Create receivable in unified debts table (NO cash book / money ledger entry!)
  insert into public.debts (
    business_id, source_type, source_id, reference_number,
    customer_id, customer_name, customer_phone,
    issue_date, due_date, total_kobo, amount_paid_kobo, written_off_kobo, balance_due_kobo, status
  ) values (
    v_biz.id, 'INVOICE', v_inv.id, v_number,
    v_inv.customer_id, v_inv.customer_name, v_inv.customer_phone,
    v_inv.issue_date, v_inv.due_date, v_inv.total_kobo, 0, 0, v_inv.total_kobo, 'OPEN'
  )
  on conflict (source_type, source_id) do nothing;

  perform public.v2_increment_usage(v_biz.id, 'invoice');
  perform public.v2_log_audit(
    v_biz.id, v_uid, 'invoice_issued', 'invoice', v_inv.id,
    jsonb_build_object('invoice_number', v_number, 'total_kobo', v_inv.total_kobo)
  );

  return v_inv;
end;
$$;
revoke all on function public.v2_send_invoice(uuid) from public;
grant execute on function public.v2_send_invoice(uuid) to authenticated;

-- 5i. Void an unpaid invoice (REJECTED if any payment exists)
create or replace function public.v2_void_invoice(p_invoice_id uuid, p_reason text)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz public.businesses%rowtype;
  v_inv public.invoices%rowtype;
  v_paid_count integer;
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception 'Please provide a reason for voiding (at least 3 characters)';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid;
  if not found then
    raise exception 'Business not found';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id and business_id = v_biz.id for update;
  if not found then
    raise exception 'Invoice not found';
  end if;

  if v_inv.status = 'VOID' then
    raise exception 'Invoice is already voided';
  end if;

  select count(*) into v_paid_count
  from public.payments
  where invoice_id = v_inv.id and is_voided = false;

  if v_paid_count > 0 or v_inv.amount_paid_kobo > 0 then
    raise exception 'An invoice with a recorded payment cannot be voided. Void the payment receipt first or write off the remaining balance.';
  end if;

  update public.invoices
  set
    status = 'VOID',
    balance_due_kobo = 0,
    void_reason = left(trim(p_reason), 240),
    voided_at = now(),
    updated_at = now()
  where id = v_inv.id
  returning * into v_inv;

  update public.debts
  set status = 'VOID', balance_due_kobo = 0, updated_at = now()
  where source_type = 'INVOICE' and source_id = v_inv.id;

  perform public.v2_log_audit(
    v_biz.id, v_uid, 'invoice_voided', 'invoice', v_inv.id,
    jsonb_build_object('invoice_number', v_inv.invoice_number, 'reason', left(trim(p_reason), 240))
  );

  return v_inv;
end;
$$;
revoke all on function public.v2_void_invoice(uuid, text) from public;
grant execute on function public.v2_void_invoice(uuid, text) to authenticated;

-- 5j. Reissue an unpaid sent invoice (voids old + creates new DRAFT copy linked to original)
create or replace function public.v2_reissue_invoice(p_invoice_id uuid, p_reason text)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz public.businesses%rowtype;
  v_old public.invoices%rowtype;
  v_new public.invoices%rowtype;
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid;
  if not found then
    raise exception 'Business not found';
  end if;

  select * into v_old from public.invoices where id = p_invoice_id and business_id = v_biz.id for update;
  if not found then
    raise exception 'Invoice not found';
  end if;

  if v_old.status <> 'SENT' then
    raise exception 'Only an unpaid sent invoice can be reissued';
  end if;

  -- Void the original invoice first (enforces zero-payment check & audit log)
  perform public.v2_void_invoice(v_old.id, coalesce(nullif(trim(p_reason), ''), 'Reissued with corrections'));

  -- Create a fresh editable draft copy
  insert into public.invoices (
    business_id, customer_id, status,
    issue_date, terms_kind, due_date, currency,
    customer_name, customer_phone, customer_email, customer_address,
    subtotal_kobo, line_discount_total_kobo, invoice_discount_kobo,
    vat_enabled, vat_mode, vat_rate_bps, vat_kobo, total_kobo,
    deposit_type, deposit_value, amount_due_now_kobo,
    amount_paid_kobo, written_off_kobo, balance_due_kobo,
    notes, bank_account_ids, template, reissued_from_id, created_by
  ) values (
    v_old.business_id, v_old.customer_id, 'DRAFT',
    (now() at time zone 'Africa/Lagos')::date, v_old.terms_kind,
    case v_old.terms_kind
      when 'due_on_receipt' then (now() at time zone 'Africa/Lagos')::date
      when 'net_7' then (now() at time zone 'Africa/Lagos')::date + 7
      when 'net_14' then (now() at time zone 'Africa/Lagos')::date + 14
      when 'net_30' then (now() at time zone 'Africa/Lagos')::date + 30
      else greatest((now() at time zone 'Africa/Lagos')::date, v_old.due_date)
    end,
    v_old.currency,
    v_old.customer_name, v_old.customer_phone, v_old.customer_email, v_old.customer_address,
    v_old.subtotal_kobo, v_old.line_discount_total_kobo, v_old.invoice_discount_kobo,
    v_old.vat_enabled, v_old.vat_mode, v_old.vat_rate_bps, v_old.vat_kobo, v_old.total_kobo,
    v_old.deposit_type, v_old.deposit_value, v_old.amount_due_now_kobo,
    0, 0, v_old.total_kobo,
    v_old.notes, v_old.bank_account_ids, v_old.template, v_old.id, v_uid
  )
  returning * into v_new;

  insert into public.invoice_lines (
    invoice_id, business_id, position, description,
    qty_thousandths, unit_price_kobo, discount_kobo, gross_kobo, line_total_kobo
  )
  select
    v_new.id, v_old.business_id, position, description,
    qty_thousandths, unit_price_kobo, discount_kobo, gross_kobo, line_total_kobo
  from public.invoice_lines
  where invoice_id = v_old.id;

  return v_new;
end;
$$;
revoke all on function public.v2_reissue_invoice(uuid, text) from public;
grant execute on function public.v2_reissue_invoice(uuid, text) to authenticated;

-- 5k. Write off remaining invoice balance (closes as SETTLED, audit-logged, NO cash-in ledger entry)
create or replace function public.v2_write_off_invoice(p_invoice_id uuid, p_reason text)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz public.businesses%rowtype;
  v_inv public.invoices%rowtype;
  v_writeoff bigint;
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception 'Provide a reason for writing off this balance (at least 3 characters)';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid;
  if not found then
    raise exception 'Business not found';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id and business_id = v_biz.id for update;
  if not found then
    raise exception 'Invoice not found';
  end if;

  if v_inv.status not in ('SENT', 'PART_PAID') or v_inv.balance_due_kobo <= 0 then
    raise exception 'Only an open or part-paid invoice with a remaining balance can be written off';
  end if;

  v_writeoff := v_inv.balance_due_kobo;

  update public.invoices
  set
    written_off_kobo = written_off_kobo + v_writeoff,
    balance_due_kobo = 0,
    status = 'SETTLED',
    write_off_reason = left(trim(p_reason), 240),
    written_off_at = now(),
    updated_at = now()
  where id = v_inv.id
  returning * into v_inv;

  update public.debts
  set
    written_off_kobo = written_off_kobo + v_writeoff,
    balance_due_kobo = 0,
    status = 'SETTLED',
    updated_at = now()
  where source_type = 'INVOICE' and source_id = v_inv.id;

  perform public.v2_log_audit(
    v_biz.id, v_uid, 'invoice_written_off', 'invoice', v_inv.id,
    jsonb_build_object(
      'invoice_number', v_inv.invoice_number,
      'written_off_kobo', v_writeoff,
      'reason', left(trim(p_reason), 240)
    )
  );

  return v_inv;
end;
$$;
revoke all on function public.v2_write_off_invoice(uuid, text) from public;
grant execute on function public.v2_write_off_invoice(uuid, text) to authenticated;

-- 5l. Regenerate invoice public link (immediately invalidates old 128-bit link)
create or replace function public.v2_regenerate_invoice_link(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz public.businesses%rowtype;
  v_inv public.invoices%rowtype;
  v_new_public_id text := replace(gen_random_uuid()::text, '-', '');
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid;
  if not found then
    raise exception 'Business not found';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id and business_id = v_biz.id for update;
  if not found then
    raise exception 'Invoice not found';
  end if;

  update public.invoices
  set public_id = v_new_public_id, updated_at = now()
  where id = v_inv.id
  returning * into v_inv;

  perform public.v2_log_audit(
    v_biz.id, v_uid, 'link_regenerated', 'invoice', v_inv.id,
    jsonb_build_object('invoice_number', v_inv.invoice_number)
  );

  return v_inv;
end;
$$;
revoke all on function public.v2_regenerate_invoice_link(uuid) from public;
grant execute on function public.v2_regenerate_invoice_link(uuid) to authenticated;

-- 5m. Single transactional payment creation path: record_payment
create or replace function public.record_payment(
  p_debt_id uuid,
  p_amount_kobo bigint,
  p_method text,
  p_payment_date date,
  p_reference text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz public.businesses%rowtype;
  v_debt public.debts%rowtype;
  v_existing_payment public.payments%rowtype;
  v_existing_receipt public.receipts%rowtype;
  v_today_lagos date := (now() at time zone 'Africa/Lagos')::date;
  v_pay_date date := coalesce(p_payment_date, v_today_lagos);
  v_seq integer;
  v_receipt_number text;
  v_public_id text := replace(gen_random_uuid()::text, '-', '');
  v_new_paid bigint;
  v_new_balance bigint;
  v_new_status text;
  v_receipt_title text;
  v_items_json jsonb;
  v_receipt_id uuid;
  v_ledger_id uuid;
  v_payment_id uuid;
  v_payment_row public.payments%rowtype;
  v_receipt_row public.receipts%rowtype;
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;

  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) < 6 then
    raise exception 'Idempotency key is required';
  end if;
  if p_amount_kobo is null or p_amount_kobo <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;
  if p_method not in ('Cash', 'Transfer', 'POS', 'Card', 'Other') then
    raise exception 'Invalid payment method';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid for update;
  if not found then
    raise exception 'Business not found';
  end if;

  -- Idempotency check BEFORE locking/mutating balances
  select * into v_existing_payment
  from public.payments
  where business_id = v_biz.id and idempotency_key = trim(p_idempotency_key);

  if found then
    select * into v_existing_receipt from public.receipts where id = v_existing_payment.receipt_id;
    select * into v_debt from public.debts where id = v_existing_payment.debt_id;
    return jsonb_build_object(
      'payment', to_jsonb(v_existing_payment),
      'receipt', to_jsonb(v_existing_receipt),
      'debt', to_jsonb(v_debt),
      'idempotentReplay', true
    );
  end if;

  -- Lock the debt row exclusively so parallel payment calls serialize cleanly
  select * into v_debt
  from public.debts
  where id = p_debt_id and business_id = v_biz.id
  for update;

  if not found then
    raise exception 'Receivable record not found';
  end if;

  if v_debt.status in ('PAID', 'SETTLED', 'VOID') or v_debt.balance_due_kobo <= 0 then
    raise exception 'This balance is already settled';
  end if;

  if p_amount_kobo > v_debt.balance_due_kobo then
    raise exception 'Payment exceeds remaining balance of % kobo', v_debt.balance_due_kobo;
  end if;

  if v_pay_date > v_today_lagos then
    raise exception 'Payment date cannot be in the future (Africa/Lagos)';
  end if;

  if v_pay_date < v_debt.issue_date then
    raise exception 'Payment date cannot be earlier than the invoice date (%)', v_debt.issue_date;
  end if;

  if public.is_day_closed(v_biz.id, v_pay_date) then
    raise exception 'CLOSED_DAY: Day % is closed. Post a visible correction entry instead.', v_pay_date;
  end if;

  v_new_paid := v_debt.amount_paid_kobo + p_amount_kobo;
  v_new_balance := v_debt.balance_due_kobo - p_amount_kobo;
  v_new_status := case when v_new_balance = 0 then 'PAID' else 'PART_PAID' end;

  -- Allocate gap-free receipt sequence
  v_seq := v_biz.next_sequence;
  v_receipt_number := v_biz.receipt_prefix || lpad(v_seq::text, 4, '0');
  update public.businesses set next_sequence = next_sequence + 1, updated_at = now() where id = v_biz.id;

  v_receipt_title := 'Payment for ' || coalesce(nullif(v_debt.reference_number, ''), 'Balance');
  v_items_json := jsonb_build_array(
    jsonb_build_object(
      'description', v_receipt_title,
      'qty', 1,
      'unitPriceKobo', p_amount_kobo,
      'discountKobo', 0,
      'grossKobo', p_amount_kobo,
      'lineTotalKobo', p_amount_kobo
    )
  );

  insert into public.receipts (
    business_id, public_id, sequence_number, receipt_number, receipt_kind,
    parent_receipt_id, parent_receipt_number,
    customer_name, customer_phone, items_json,
    subtotal_kobo, discount_total_kobo, vat_enabled, vat_mode, vat_rate_bps, vat_kobo,
    total_kobo, initial_paid_kobo, amount_paid_kobo, balance_due_kobo,
    payment_method, note, sold_by, source, template, status, issued_date_lagos, created_by
  ) values (
    v_biz.id, v_public_id, v_seq, v_receipt_number, 'BALANCE_PAYMENT',
    case when v_debt.source_type = 'RECEIPT' then v_debt.source_id else null end,
    v_debt.reference_number,
    v_debt.customer_name, v_debt.customer_phone, v_items_json,
    p_amount_kobo, 0, false, 'exclusive', 0, 0,
    p_amount_kobo, p_amount_kobo, p_amount_kobo, v_new_balance,
    p_method,
    case
      when nullif(trim(coalesce(p_reference, '')), '') is not null
        then v_receipt_title || ' (Ref: ' || left(trim(p_reference), 60) || ')'
      else v_receipt_title
    end,
    '', 'manual', v_biz.default_template, 'PAID', v_pay_date, v_uid
  )
  returning * into v_receipt_row;
  v_receipt_id := v_receipt_row.id;

  insert into public.public_receipts (
    public_id, receipt_id, receipt_number, receipt_kind, parent_receipt_number,
    business_name, business_logo_data_url, business_address, business_phone, business_email,
    brand_color, currency, customer_name, customer_phone, items_json,
    subtotal_kobo, discount_total_kobo, vat_enabled, vat_mode, vat_rate_bps, vat_kobo,
    total_kobo, amount_paid_kobo, balance_due_kobo, payment_method, note, sold_by,
    template, status, issued_date_lagos, issued_at
  ) values (
    v_public_id, v_receipt_id, v_receipt_number, 'BALANCE_PAYMENT', v_debt.reference_number,
    v_biz.name, v_biz.logo_data_url, v_biz.address, v_biz.phone, v_biz.email,
    v_biz.brand_color, v_biz.currency, v_debt.customer_name, '', v_items_json,
    p_amount_kobo, 0, false, 'exclusive', 0, 0,
    p_amount_kobo, p_amount_kobo, v_new_balance, p_method,
    v_receipt_row.note, '',
    v_biz.default_template, 'PAID', v_pay_date, v_receipt_row.issued_at
  );

  insert into public.ledger_entries (
    business_id, entry_type, entry_kind, amount_kobo, cash_received_kobo,
    payment_method, receipt_id,
    credit_sale_id, invoice_id,
    customer_name, customer_phone, note, sold_by, source, entry_date, created_by
  ) values (
    v_biz.id, 'PAYMENT_RECEIVED', 'DEBT_PAYMENT', p_amount_kobo, p_amount_kobo,
    p_method, v_receipt_id,
    case when v_debt.source_type = 'CREDIT_SALE' then v_debt.source_id else null end,
    case when v_debt.source_type = 'INVOICE' then v_debt.source_id else null end,
    v_debt.customer_name, v_debt.customer_phone, v_receipt_row.note, '', 'manual', v_pay_date, v_uid
  )
  returning id into v_ledger_id;

  insert into public.payments (
    business_id, debt_id, invoice_id, receipt_id, ledger_entry_id,
    amount_kobo, payment_method, payment_date, reference, idempotency_key, created_by
  ) values (
    v_biz.id, v_debt.id,
    case when v_debt.source_type = 'INVOICE' then v_debt.source_id else null end,
    v_receipt_id, v_ledger_id,
    p_amount_kobo, p_method, v_pay_date, left(trim(coalesce(p_reference, '')), 80), trim(p_idempotency_key), v_uid
  )
  returning * into v_payment_row;
  v_payment_id := v_payment_row.id;

  update public.ledger_entries set payment_id = v_payment_id where id = v_ledger_id;

  -- Update unified debt row
  update public.debts
  set
    amount_paid_kobo = v_new_paid,
    balance_due_kobo = v_new_balance,
    status = v_new_status,
    updated_at = now()
  where id = v_debt.id
  returning * into v_debt;

  -- Sync source document
  if v_debt.source_type = 'INVOICE' then
    update public.invoices
    set
      amount_paid_kobo = v_new_paid,
      balance_due_kobo = v_new_balance,
      status = v_new_status,
      updated_at = now()
    where id = v_debt.source_id;
  elsif v_debt.source_type = 'CREDIT_SALE' then
    update public.credit_sales
    set amount_paid_kobo = v_new_paid, balance_due_kobo = v_new_balance, status = v_new_status
    where id = v_debt.source_id;
  elsif v_debt.source_type = 'RECEIPT' then
    update public.receipts
    set amount_paid_kobo = v_new_paid, balance_due_kobo = v_new_balance, status = v_new_status
    where id = v_debt.source_id;
    update public.public_receipts
    set amount_paid_kobo = v_new_paid, balance_due_kobo = v_new_balance, status = v_new_status
    where receipt_id = v_debt.source_id;
  end if;

  perform public.v2_increment_usage(v_biz.id, 'receipt');
  perform public.v2_log_audit(
    v_biz.id, v_uid, 'payment_recorded', 'payment', v_payment_id,
    jsonb_build_object(
      'debt_id', v_debt.id,
      'reference_number', v_debt.reference_number,
      'amount_kobo', p_amount_kobo,
      'method', p_method,
      'receipt_number', v_receipt_number,
      'remaining_kobo', v_new_balance
    )
  );

  return jsonb_build_object(
    'payment', to_jsonb(v_payment_row),
    'receipt', to_jsonb(v_receipt_row),
    'debt', to_jsonb(v_debt),
    'idempotentReplay', false
  );
end;
$$;
revoke all on function public.record_payment(uuid, bigint, text, date, text, text) from public;
grant execute on function public.record_payment(uuid, bigint, text, date, text, text) to authenticated;

-- 5n. Void a payment receipt: reversing entry, reopens balance, marks receipt VOID
create or replace function public.v2_void_payment_receipt(p_receipt_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_biz public.businesses%rowtype;
  v_pay public.payments%rowtype;
  v_rcpt public.receipts%rowtype;
  v_debt public.debts%rowtype;
  v_today_lagos date := (now() at time zone 'Africa/Lagos')::date;
  v_today_closed boolean;
  v_restored_paid bigint;
  v_restored_bal bigint;
  v_restored_status text;
begin
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception 'Provide a reason for voiding this payment receipt';
  end if;

  select * into v_biz from public.businesses where owner_id = v_uid;
  if not found then
    raise exception 'Business not found';
  end if;

  select * into v_pay from public.payments where receipt_id = p_receipt_id and business_id = v_biz.id for update;
  if not found then
    raise exception 'Payment record for this receipt was not found';
  end if;
  if v_pay.is_voided then
    raise exception 'Payment receipt is already voided';
  end if;

  select * into v_rcpt from public.receipts where id = p_receipt_id and business_id = v_biz.id for update;
  select * into v_debt from public.debts where id = v_pay.debt_id for update;

  update public.payments
  set is_voided = true, void_reason = left(trim(p_reason), 240), voided_at = now()
  where id = v_pay.id
  returning * into v_pay;

  update public.receipts
  set status = 'VOID', void_reason = left(trim(p_reason), 240), voided_at = now(), voided_by = v_uid
  where id = v_rcpt.id
  returning * into v_rcpt;

  update public.public_receipts
  set status = 'VOID', void_reason = left(trim(p_reason), 240), voided_at = now()
  where receipt_id = v_rcpt.id;

  v_restored_paid := greatest(0, v_debt.amount_paid_kobo - v_pay.amount_kobo);
  v_restored_bal := greatest(0, v_debt.total_kobo - v_restored_paid - v_debt.written_off_kobo);
  v_restored_status := case
    when v_restored_bal = 0 and v_debt.written_off_kobo > 0 then 'SETTLED'
    when v_restored_bal = 0 then 'PAID'
    when v_restored_paid > 0 then 'PART_PAID'
    else 'OPEN'
  end;

  update public.debts
  set amount_paid_kobo = v_restored_paid, balance_due_kobo = v_restored_bal, status = v_restored_status, updated_at = now()
  where id = v_debt.id
  returning * into v_debt;

  if v_debt.source_type = 'INVOICE' then
    update public.invoices
    set
      amount_paid_kobo = v_restored_paid,
      balance_due_kobo = v_restored_bal,
      status = case when v_restored_status = 'OPEN' then 'SENT' else v_restored_status end,
      updated_at = now()
    where id = v_debt.source_id;
  elsif v_debt.source_type = 'CREDIT_SALE' then
    update public.credit_sales
    set
      amount_paid_kobo = v_restored_paid,
      balance_due_kobo = v_restored_bal,
      status = case when v_restored_status = 'OPEN' then 'UNPAID' else v_restored_status end
    where id = v_debt.source_id;
  elsif v_debt.source_type = 'RECEIPT' then
    update public.receipts
    set
      amount_paid_kobo = v_restored_paid,
      balance_due_kobo = v_restored_bal,
      status = case when v_restored_bal = 0 then 'PAID' else 'PART_PAID' end
    where id = v_debt.source_id;
    update public.public_receipts
    set
      amount_paid_kobo = v_restored_paid,
      balance_due_kobo = v_restored_bal,
      status = case when v_restored_bal = 0 then 'PAID' else 'PART_PAID' end
    where receipt_id = v_debt.source_id;
  end if;

  v_today_closed := public.is_day_closed(v_biz.id, v_today_lagos);
  insert into public.ledger_entries (
    business_id, entry_type, entry_kind, amount_kobo, cash_received_kobo,
    payment_method, receipt_id, invoice_id, payment_id,
    customer_name, customer_phone, note, sold_by, source,
    is_correction, correction_reason, entry_date, created_by
  ) values (
    v_biz.id, 'ADJUSTMENT', 'VOID_REVERSAL', -v_pay.amount_kobo, -v_pay.amount_kobo,
    v_pay.payment_method, v_rcpt.id, v_pay.invoice_id, v_pay.id,
    v_debt.customer_name, v_debt.customer_phone,
    'VOID ' || v_rcpt.receipt_number || ': ' || left(trim(p_reason), 240),
    '', 'manual',
    v_today_closed,
    case when v_today_closed then 'Voided payment ' || v_rcpt.receipt_number else '' end,
    v_today_lagos, v_uid
  );

  perform public.v2_log_audit(
    v_biz.id, v_uid, 'payment_reversed', 'payment', v_pay.id,
    jsonb_build_object(
      'receipt_number', v_rcpt.receipt_number,
      'amount_kobo', v_pay.amount_kobo,
      'reason', left(trim(p_reason), 240),
      'reopened_balance_kobo', v_restored_bal
    )
  );

  return jsonb_build_object('payment', to_jsonb(v_pay), 'receipt', to_jsonb(v_rcpt), 'debt', to_jsonb(v_debt));
end;
$$;
revoke all on function public.v2_void_payment_receipt(uuid, text) from public;
grant execute on function public.v2_void_payment_receipt(uuid, text) to authenticated;

-- 5o. Public Invoice Snapshot Fetcher (renders ONLY snapshot + derived status + payment summary; NEVER phone/email)
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
    'snapshot', v_inv.snapshot_json,
    'payments', v_payments
  );
end;
$$;
revoke all on function public.get_public_invoice(text) from public;
grant execute on function public.get_public_invoice(text) to anon, authenticated;

-- 5p. Postgres-backed Rate Limiter (atomic window counter; never in server memory)
create or replace function public.check_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_window_start timestamptz;
  v_expires timestamptz;
  v_count integer;
begin
  if p_bucket_key is null or char_length(trim(p_bucket_key)) < 1 or p_limit <= 0 or p_window_seconds <= 0 then
    raise exception 'Invalid rate limit arguments';
  end if;

  v_window_start := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);
  v_expires := v_window_start + make_interval(secs => p_window_seconds);

  -- Opportunistic cleanup of expired buckets
  delete from public.rate_limits where expires_at < v_now - interval '1 hour';

  insert into public.rate_limits (bucket_key, window_start, hit_count, expires_at)
  values (trim(p_bucket_key), v_window_start, 1, v_expires)
  on conflict (bucket_key, window_start) do update
  set hit_count = public.rate_limits.hit_count + 1
  returning hit_count into v_count;

  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'count', v_count,
    'remaining', greatest(0, p_limit - v_count),
    'resetAt', v_expires
  );
end;
$$;
revoke all on function public.check_rate_limit(text, integer, integer) from public;

-- Notify Supabase PostgREST to reload its RPC schema cache immediately
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
end;
$$;

commit;
