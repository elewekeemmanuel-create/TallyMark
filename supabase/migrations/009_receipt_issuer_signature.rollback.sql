-- Rollback for 009_receipt_issuer_signature.sql

drop trigger if exists trg_public_receipts_capture_signature on public.public_receipts;
drop function if exists public.trg_public_receipts_capture_signature();

alter table public.public_receipts
  drop column if exists business_signature_data_url;

alter table public.businesses
  drop column if exists signature_data_url;

create or replace function public.get_public_receipt(p_public_id text)
returns setof public.public_receipts
language sql
security definer
set search_path = public
as $$
  select * from public.public_receipts where public_id = p_public_id limit 1;
$$;

grant execute on function public.get_public_receipt(text) to anon, authenticated;

select pg_notify('pgrst', 'reload schema');
