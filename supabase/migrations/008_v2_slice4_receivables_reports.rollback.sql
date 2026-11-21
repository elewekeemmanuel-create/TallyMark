-- ============================================================================
-- Rollback for Tallymark V2 Slice 4 Migration (008)
-- Drops Slice 4 RPC functions and helper indexes cleanly without touching data.
-- ============================================================================

begin;

drop function if exists public.v2_log_reminder(uuid, text, text);
drop function if exists public.v2_sync_legacy_debts();
drop index if exists public.idx_debts_business_source_status;
drop index if exists public.idx_payment_reminders_debt_sent;

select pg_notify('pgrst', 'reload schema');

commit;
