-- Tallymark Migration 009: Issuer Signature on Receipts
-- Additive migration adding businesses.signature_data_url, public_receipts.business_signature_data_url,
-- an automatic snapshot trigger on public_receipts inserts, and updated get_public_receipt(text).

alter table public.businesses
  add column if not exists signature_data_url text;

alter table public.public_receipts
  add column if not exists business_signature_data_url text;

-- Automatically capture the business's current issuer signature whenever a public receipt snapshot is inserted
create or replace function public.trg_public_receipts_capture_signature()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.business_signature_data_url is null then
    select b.signature_data_url
      into new.business_signature_data_url
      from public.receipts r
      join public.businesses b on b.id = r.business_id
     where r.id = new.receipt_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_public_receipts_capture_signature on public.public_receipts;
create trigger trg_public_receipts_capture_signature
  before insert on public.public_receipts
  for each row
  execute function public.trg_public_receipts_capture_signature();

-- Update get_public_receipt so receipts issued prior to uploading a signature also display the issuer's signature if present
create or replace function public.get_public_receipt(p_public_id text)
returns setof public.public_receipts
language sql
security definer
set search_path = public
as $$
  select
    pr.public_id,
    pr.receipt_id,
    pr.receipt_number,
    pr.receipt_kind,
    pr.parent_receipt_number,
    pr.business_name,
    pr.business_logo_data_url,
    pr.business_address,
    pr.business_phone,
    pr.business_email,
    pr.brand_color,
    pr.currency,
    pr.customer_name,
    pr.customer_phone,
    pr.items_json,
    pr.subtotal_kobo,
    pr.discount_total_kobo,
    pr.vat_enabled,
    pr.vat_mode,
    pr.vat_rate_bps,
    pr.vat_kobo,
    pr.total_kobo,
    pr.amount_paid_kobo,
    pr.balance_due_kobo,
    pr.payment_method,
    pr.note,
    pr.sold_by,
    pr.template,
    pr.status,
    pr.void_reason,
    pr.voided_at,
    pr.issued_date_lagos,
    pr.issued_at,
    coalesce(pr.business_signature_data_url, b.signature_data_url) as business_signature_data_url
  from public.public_receipts pr
  left join public.receipts r on r.id = pr.receipt_id
  left join public.businesses b on b.id = r.business_id
  where pr.public_id = p_public_id
  limit 1;
$$;

grant execute on function public.get_public_receipt(text) to anon, authenticated;

select pg_notify('pgrst', 'reload schema');
