import React from 'react';
import { formatKobo, formatLagosDateOnly, koboToWords } from '../../shared/money';
import { formatQtyThousandths, formatTermsLabel } from '../../shared/v2/money';
import type { PublicInvoiceRecord } from '../../shared/v2/types';

function getStamp(inv: PublicInvoiceRecord): { label: string; className: string } {
  if (inv.status === 'VOID') {
    return { label: 'VOID', className: 'border-[#B91C1C] text-[#B91C1C]' };
  }
  if (inv.status === 'PAID') {
    return { label: 'PAID', className: 'border-[#064E3B] text-[#064E3B]' };
  }
  if (inv.status === 'SETTLED') {
    return { label: 'SETTLED', className: 'border-[#064E3B] text-[#064E3B]' };
  }
  if (inv.isOverdue) {
    return { label: 'OVERDUE', className: 'border-[#B91C1C] text-[#B91C1C]' };
  }
  if (inv.status === 'PART_PAID') {
    return { label: 'PART PAID', className: 'border-[#B45309] text-[#B45309]' };
  }
  return { label: 'UNPAID', className: 'border-[#5C635D] text-[#5C635D]' };
}

/**
 * Paper-ledger Invoice template matching Tallymark receipts (modern / classic / compact).
 * Renders strictly from `invoice.snapshot` so later settings changes never alter sent documents.
 */
export function InvoiceDocument({
  invoice,
  thermalPrint = false,
}: {
  invoice: PublicInvoiceRecord;
  thermalPrint?: boolean;
}) {
  const snap = invoice.snapshot;
  const cur = snap.business.currency || 'NGN';
  const accent = snap.business.brandColor || '#064E3B';
  const stamp = getStamp(invoice);
  const isCompact = snap.template === 'compact';

  const isDense = snap.lines.length >= 10;

  return (
    <article
      className={`invoice-print-sheet print-only-container rounded-2xl border border-[#E5DEC9] bg-[#FFFDF9] text-[#121513] overflow-hidden shadow-xs print:rounded-none print:border-0 print:shadow-none ${
        isCompact ? 'max-w-md mx-auto' : 'w-full'
      } ${isDense ? 'invoice-print-dense' : ''} ${
        thermalPrint || isCompact ? 'print-compact-80mm' : ''
      }`}
    >
      <div className="h-2 print:h-1.5 w-full" style={{ backgroundColor: accent }} />

      <div
        className={
          isCompact
            ? 'p-5 space-y-4 print:p-3 print:space-y-2.5'
            : 'p-5 sm:p-7 space-y-5 print:p-3 print:space-y-2.5'
        }
      >
        {/* Header */}
        <div className="invoice-print-header flex flex-col sm:flex-row print:flex-row sm:items-start print:items-start justify-between gap-3 border-b border-[#E5DEC9] pb-4 print:pb-2.5">
          <div className="flex items-start gap-3 min-w-0">
            {snap.business.logoDataUrl ? (
              <img
                src={snap.business.logoDataUrl}
                alt={snap.business.name}
                referrerPolicy="no-referrer"
                className="w-11 h-11 print:w-9 print:h-9 rounded-xl object-contain border border-[#E5DEC9] bg-white p-1 shrink-0"
              />
            ) : (
              <div
                className="w-11 h-11 print:w-9 print:h-9 rounded-xl flex items-center justify-center text-white font-semibold text-sm print:text-xs shrink-0"
                style={{ backgroundColor: accent }}
              >
                {snap.business.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h2 className="font-display text-2xl sm:text-3xl print:text-xl leading-tight text-[#121513]">
                {snap.business.name}
              </h2>
              {snap.business.address && (
                <p className="mt-0.5 text-xs print:text-[10.5px] print:leading-snug text-[#5C635D]">
                  {snap.business.address}
                </p>
              )}
              {(snap.business.phone || snap.business.email) && (
                <p className="text-xs print:text-[10.5px] print:leading-snug text-[#5C635D]">
                  {[snap.business.phone, snap.business.email].filter(Boolean).join(' · ')}
                </p>
              )}
              {snap.business.tinRc && (
                <p className="mt-0.5 font-mono text-[11px] print:text-[10px] text-[#121513]">
                  TIN / RC: {snap.business.tinRc}
                </p>
              )}
            </div>
          </div>

          <div className="flex sm:flex-col print:flex-col items-start sm:items-end print:items-end justify-between gap-1.5 shrink-0">
            <div className="sm:text-right print:text-right">
              <p className="label-caps print:text-[9px]" style={{ color: accent }}>
                Invoice
              </p>
              <p className="font-mono text-lg print:text-base font-semibold text-[#121513]">
                {snap.invoiceNumber}
              </p>
            </div>
            <span
              className={`rubber-stamp inline-block border-2 px-2.5 py-0.5 print:px-2 print:py-0.5 font-mono text-xs print:text-[10px] font-semibold uppercase tracking-widest ${stamp.className}`}
            >
              {stamp.label}
            </span>
          </div>
        </div>

        {/* Bill To & Dates */}
        <div className="invoice-print-meta grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-3 print:gap-2 text-xs print:text-[10.5px]">
          <div>
            <p className="label-caps print:text-[9px] text-[#5C635D]">Bill To</p>
            <p className="mt-0.5 text-sm print:text-xs font-semibold text-[#121513]">
              {snap.customer.name}
            </p>
            {snap.customer.address && (
              <p className="mt-0.5 text-xs print:text-[10.5px] print:leading-snug text-[#5C635D]">
                {snap.customer.address}
              </p>
            )}
          </div>
          <div className="sm:text-right print:text-right space-y-0.5 font-mono">
            <div className="flex sm:justify-end print:justify-end gap-2.5">
              <span className="text-[#5C635D]">Issue date:</span>
              <span className="font-medium text-[#121513]">{formatLagosDateOnly(snap.issueDate)}</span>
            </div>
            <div className="flex sm:justify-end print:justify-end gap-2.5">
              <span className="text-[#5C635D]">Due date:</span>
              <span className="font-medium text-[#121513]">{formatLagosDateOnly(snap.dueDate)}</span>
            </div>
            <div className="flex sm:justify-end print:justify-end gap-2.5">
              <span className="text-[#5C635D]">Terms:</span>
              <span className="font-medium text-[#121513]">
                {formatTermsLabel(snap.termsKind, snap.dueDate)}
              </span>
            </div>
          </div>
        </div>

        {/* Line Items Table */}
        <div className="overflow-x-auto print:overflow-visible">
          <table className="invoice-print-table w-full text-left border-collapse">
            <thead>
              <tr className="border-y border-[#E5DEC9] bg-[#F5F1E7] text-[10px] print:text-[9px] font-mono uppercase tracking-wider text-[#5C635D]">
                <th className="py-2 px-2.5 print:py-1 print:px-2">Description</th>
                <th className="py-2 px-2 print:py-1 print:px-1.5 text-right">Qty</th>
                <th className="py-2 px-2 print:py-1 print:px-1.5 text-right">Unit Price</th>
                <th className="py-2 px-2.5 print:py-1 print:px-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EFEAD9] text-xs print:text-[10.5px]">
              {snap.lines.map((line, idx) => (
                <tr key={line.id || idx} className="print:break-inside-avoid">
                  <td className="py-2 px-2.5 print:py-1 print:px-2">
                    <p className="font-medium text-[#121513] print:leading-tight">{line.description}</p>
                    {line.discountKobo > 0 && (
                      <p className="text-[11px] print:text-[9.5px] text-[#5C635D]">
                        Line discount: −{formatKobo(line.discountKobo, cur)}
                      </p>
                    )}
                  </td>
                  <td className="py-2 px-2 print:py-1 print:px-1.5 text-right font-mono tabular-nums text-[#121513] whitespace-nowrap">
                    {formatQtyThousandths(line.qtyThousandths)}
                  </td>
                  <td className="py-2 px-2 print:py-1 print:px-1.5 text-right font-mono tabular-nums text-[#121513] whitespace-nowrap">
                    {formatKobo(line.unitPriceKobo, cur)}
                  </td>
                  <td className="py-2 px-2.5 print:py-1 print:px-2 text-right font-mono font-semibold tabular-nums text-[#121513] whitespace-nowrap">
                    {formatKobo(line.lineTotalKobo, cur)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Bottom 2-column Summary: Left = Words, Bank Details, Payments & Notes | Right = Totals */}
        <div className="invoice-print-bottom grid grid-cols-1 sm:grid-cols-12 print:grid-cols-12 gap-4 print:gap-3 pt-1 print:break-inside-avoid items-start">
          {/* Totals first on mobile, right column on sm+ and print */}
          <div className="sm:order-2 print:order-2 sm:col-span-5 print:col-span-5 space-y-1 text-xs print:text-[10.5px]">
            <div className="flex justify-between gap-2 text-[#5C635D]">
              <span>Subtotal</span>
              <span className="font-mono tabular-nums text-[#121513]">
                {formatKobo(snap.subtotalKobo, cur)}
              </span>
            </div>
            {snap.lineDiscountTotalKobo > 0 && (
              <div className="flex justify-between gap-2 text-[#5C635D]">
                <span>Line discounts</span>
                <span className="font-mono tabular-nums text-[#121513]">
                  −{formatKobo(snap.lineDiscountTotalKobo, cur)}
                </span>
              </div>
            )}
            {snap.invoiceDiscountKobo > 0 && (
              <div className="flex justify-between gap-2 text-[#5C635D]">
                <span>Invoice discount</span>
                <span className="font-mono tabular-nums text-[#121513]">
                  −{formatKobo(snap.invoiceDiscountKobo, cur)}
                </span>
              </div>
            )}
            {snap.vatEnabled && snap.vatKobo > 0 && (
              <div className="flex justify-between gap-2 text-[#5C635D]">
                <span>
                  VAT ({(snap.vatRateBps / 100).toFixed(1).replace(/\.0$/, '')}%
                  {snap.vatMode === 'inclusive' ? ' incl.' : ''})
                </span>
                <span className="font-mono tabular-nums text-[#121513]">
                  {formatKobo(snap.vatKobo, cur)}
                </span>
              </div>
            )}
            <div className="pt-1.5 border-t border-[#E5DEC9] flex justify-between gap-2 text-sm print:text-xs font-semibold">
              <span>Invoice Total</span>
              <span className="font-mono tabular-nums">{formatKobo(snap.totalKobo, cur)}</span>
            </div>
            {snap.depositType !== 'none' &&
              snap.amountDueNowKobo < snap.totalKobo &&
              invoice.amountPaidKobo === 0 && (
                <div className="flex justify-between gap-2 text-xs print:text-[10.5px] font-semibold" style={{ color: accent }}>
                  <span>Amount due now</span>
                  <span className="font-mono tabular-nums">
                    {formatKobo(snap.amountDueNowKobo, cur)}
                  </span>
                </div>
              )}
            {invoice.amountPaidKobo > 0 && (
              <div className="flex justify-between gap-2 text-[#064E3B]">
                <span>Amount paid</span>
                <span className="font-mono tabular-nums">
                  {formatKobo(invoice.amountPaidKobo, cur)}
                </span>
              </div>
            )}
            {invoice.writtenOffKobo > 0 && (
              <div className="flex justify-between gap-2 text-[#5C635D]">
                <span>Written off</span>
                <span className="font-mono tabular-nums">
                  {formatKobo(invoice.writtenOffKobo, cur)}
                </span>
              </div>
            )}
            <div className="pt-1.5 border-t border-[#E5DEC9] flex justify-between gap-2 text-sm print:text-xs font-bold">
              <span>What&apos;s left</span>
              <span className="font-mono tabular-nums" style={{ color: accent }}>
                {formatKobo(invoice.balanceDueKobo, cur)}
              </span>
            </div>
          </div>

          {/* Left column on sm+ and print: Words, Bank Details, Payments Received, Notes */}
          <div className="sm:order-1 print:order-1 sm:col-span-7 print:col-span-7 space-y-2.5 print:space-y-1.5">
            <p className="text-[11px] print:text-[9.5px] print:leading-snug text-[#5C635D]">
              In words: {koboToWords(snap.totalKobo, cur)}
            </p>

            {/* Bank Details (from snapshot) */}
            {snap.bankAccounts.length > 0 && invoice.status !== 'VOID' && (
              <div className="rounded-xl print:rounded-lg border border-[#E5DEC9] bg-[#FAF8F3] p-3 print:p-2 space-y-1.5 print:space-y-1">
                <p className="label-caps print:text-[8.5px] text-[#5C635D]">Bank Transfer Details</p>
                <div className="space-y-1">
                  {snap.bankAccounts.map((bank) => (
                    <div
                      key={bank.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs print:text-[10px] border-b last:border-b-0 border-[#EFEAD9] pb-1 last:pb-0"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold text-[#121513]">{bank.bankName}</span>
                        <span className="text-[#5C635D]"> · {bank.accountName}</span>
                      </div>
                      <p className="font-mono text-xs print:text-[10.5px] font-semibold text-[#121513] whitespace-nowrap">
                        {bank.accountNumber}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Compact Payments Received (shown on printed sheet when payments exist) */}
            {invoice.payments.length > 0 && (
              <div className="text-[11px] print:text-[9.5px] space-y-0.5">
                <p className="label-caps print:text-[8.5px] text-[#5C635D]">Payments Received</p>
                {invoice.payments.slice(0, 5).map((p, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-2 text-[#121513]">
                    <span className="truncate">
                      {formatLagosDateOnly(p.paymentDate)} · {p.paymentMethod}
                      {p.receiptNumber ? ` · ${p.receiptNumber}` : ''}
                    </span>
                    <span className="font-mono tabular-nums whitespace-nowrap">
                      {formatKobo(p.amountKobo, cur)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Notes */}
            {snap.notes && (
              <div className="text-xs print:text-[9.5px] text-[#5C635D]">
                <p className="label-caps print:text-[8.5px] text-[#5C635D]">Notes</p>
                <p className="mt-0.5 whitespace-pre-wrap print:leading-snug text-[#121513]">
                  {snap.notes}
                </p>
              </div>
            )}

            {/* Void notice */}
            {invoice.status === 'VOID' && invoice.voidReason && (
              <div className="rounded-xl border border-[#B91C1C]/30 bg-[#FEF2F2] p-2.5 print:p-2 text-xs print:text-[10px] text-[#991B1B]">
                <strong>Voided:</strong> {invoice.voidReason}
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
