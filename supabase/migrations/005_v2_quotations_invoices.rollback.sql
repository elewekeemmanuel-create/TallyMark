-- ============================================================================
-- Tallymark V2 Rollback (005): Cleanly reverts 005_v2_quotations_invoices.sql
-- Leaves all V1 tables, rows, functions, and policies untouched.
-- ============================================================================

begin;

-- 1. Drop V2 SECURITY DEFINER functions
drop function if exists public.check_rate_limit(text, integer, integer);
drop function if exists public.get_public_invoice(text);
drop function if exists public.v2_void_payment_receipt(uuid, text);
drop function if exists public.record_payment(uuid, bigint, text, date, text, text);
drop function if exists public.v2_regenerate_invoice_link(uuid);
drop function if exists public.v2_write_off_invoice(uuid, text);
drop function if exists public.v2_reissue_invoice(uuid, text);
drop function if exists public.v2_void_invoice(uuid, text);
drop function if exists public.v2_send_invoice(uuid);
drop function if exists public.v2_save_invoice_draft(uuid, uuid, text, text, text, text, date, text, date, jsonb, bigint, text, bigint, text, jsonb, text, text);
drop function if exists public.v2_update_billing_settings(text, jsonb, text, text, integer, text);
drop function if exists public.v2_toggle_module(boolean, boolean);
drop function if exists public.v2_increment_usage(uuid, text);
drop function if exists public.v2_log_audit(uuid, uuid, text, text, uuid, jsonb);
drop function if exists public.can_use(uuid, text);
drop function if exists public.v2_round_half_up_div(bigint, bigint);

-- 2. Drop storage policy for claim-proofs (keep bucket if files exist, otherwise remove empty bucket)
do $$
begin
  drop policy if exists "Owner reads own claim proofs" on storage.objects;
exception
  when insufficient_privilege then
    raise notice 'Skipped dropping storage.objects policy.';
end;
$$;
delete from storage.buckets
where id = 'claim-proofs'
  and not exists (select 1 from storage.objects where bucket_id = 'claim-proofs');

-- 3. Drop additive columns on ledger_entries before dropping referenced tables
alter table public.ledger_entries
  drop column if exists payment_id,
  drop column if exists invoice_id;

-- 4. Drop V2 tables in reverse foreign-key order
drop table if exists public.rate_limits;
drop table if exists public.push_subscriptions;
drop table if exists public.usage_counters;
drop table if exists public.audit_log;
drop table if exists public.payment_reminders;
drop table if exists public.payment_claims;
drop table if exists public.payments;
drop table if exists public.debts;
drop table if exists public.quote_lines;
drop table if exists public.quotes;
drop table if exists public.invoice_lines;
drop table if exists public.invoices;

-- 5. Drop additive columns on V1 customers & businesses
alter table public.customers
  drop column if exists notes,
  drop column if exists email,
  drop column if exists address;

alter table public.businesses
  drop column if exists v2_promo_dismissed,
  drop column if exists default_invoice_notes,
  drop column if exists default_payment_terms_days,
  drop column if exists next_quote_sequence,
  drop column if exists quote_prefix,
  drop column if exists next_invoice_sequence,
  drop column if exists invoice_prefix,
  drop column if exists plan,
  drop column if exists modules_enabled,
  drop column if exists bank_accounts,
  drop column if exists tin_rc;

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
end;
$$;

commit;
