-- ============================================================================
-- Tallymark V2 Slice 2 Rollback (006): Reverts 006_v2_slice2_claims_push.sql
-- Leaves 005 tables and all V1/V2 data intact.
-- ============================================================================

begin;

drop function if exists public.v2_purge_expired_claim_proofs(timestamptz);
drop function if exists public.v2_reject_claim(uuid, text);
drop function if exists public.v2_confirm_claim(uuid, bigint, text, date, text, text);

-- Restore Slice 1 version of get_public_invoice
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

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
end;
$$;

commit;
