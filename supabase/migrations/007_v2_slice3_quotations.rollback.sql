-- ============================================================================
-- Rollback for Tallymark V2 Slice 3 Migration (007): Quotations RPCs
-- Preserves all quote data; removes only Slice 3 functions and unique index.
-- ============================================================================

begin;

drop function if exists public.v2_record_public_quote_decision(text, text, text, text, text);
drop function if exists public.get_public_quote(text);
drop function if exists public.v2_convert_quote_to_invoice(uuid, boolean);
drop function if exists public.v2_regenerate_quote_link(uuid);
drop function if exists public.v2_revise_quote(uuid, text);
drop function if exists public.v2_void_quote(uuid, text);
drop function if exists public.v2_send_quote(uuid);
drop function if exists public.v2_save_quote_draft(uuid, uuid, text, text, text, text, date, date, text, jsonb, bigint, text, bigint, text, jsonb, text, text);
drop function if exists public.v2_round_half_up(bigint, bigint);
drop index if exists public.idx_invoices_source_quote_unique;

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
end;
$$;

commit;
