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
export function InvoiceDocument({ invoice }: { invoice: PublicInvoiceRecord }) {
  const snap = invoice.snapshot;
  const cur = snap.business.currency || 'NGN';
  const accent = snap.business.brandColor || '#064E3B';
  const stamp = getStamp(invoice);
  const isCompact = snap.template === 'compact';

  return (
    <article
      className={`rounded-2xl border border-[#E5DEC9] bg-[#FFFDF9] text-[#121513] overflow-hidden shadow-xs ${
        isCompact ? 'max-w-md mx-auto' : 'w-full'
      }`}
    >
      <div className="h-2 w-full" style={{ backgroundColor: accent }} />

      <div className={isCompact ? 'p-5 space-y-5' : 'p-6 sm:p-8 space-y-6'}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-[#E5DEC9] pb-5">
          <div className="flex items-start gap-3.5 min-w-0">
            {snap.business.logoDataUrl ? (
              <img
                src={snap.business.logoDataUrl}
                alt={snap.business.name}
                referrerPolicy="no-referrer"
                className="w-12 h-12 rounded-xl object-contain border border-[#E5DEC9] bg-white p-1 shrink-0"
              />
            ) : (
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-semibold text-sm shrink-0"
                style={{ backgroundColor: accent }}
              >
                {snap.business.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h2 className="font-display text-2xl sm:text-3xl leading-tight text-[#121513]">
                {snap.business.name}
              </h2>
              {snap.business.address && (
                <p className="mt-1 text-xs text-[#5C635D]">{snap.business.address}</p>
              )}
              {(snap.business.phone || snap.business.email) && (
                <p className="text-xs text-[#5C635D]">
                  {[snap.business.phone, snap.business.email].filter(Boolean).join(' · ')}
                </p>
              )}
              {snap.business.tinRc && (
                <p className="mt-1 font-mono text-[11px] text-[#121513]">
                  TIN / RC: {snap.business.tinRc}
                </p>
              )}
            </div>
          </div>

          <div className="flex sm:flex-col items-start sm:items-end justify-between gap-2 shrink-0">
            <div className="sm:text-right">
              <p className="label-caps" style={{ color: accent }}>
                Invoice
              </p>
              <p className="font-mono text-lg font-semibold text-[#121513]">{snap.invoiceNumber}</p>
            </div>
            <span
              className={`rubber-stamp inline-block border-2 px-3 py-1 font-mono text-xs font-semibold uppercase tracking-widest ${stamp.className}`}
            >
              {stamp.label}
            </span>
          </div>
        </div>

        {/* Bill To & Dates */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <p className="label-caps text-[#5C635D]">Bill To</p>
            <p className="mt-1 text-sm font-semibold text-[#121513]">{snap.customer.name}</p>
            {snap.customer.address && (
              <p className="mt-0.5 text-xs text-[#5C635D]">{snap.customer.address}</p>
            )}
          </div>
          <div className="sm:text-right space-y-1 font-mono">
            <div className="flex sm:justify-end gap-3">
              <span className="text-[#5C635D]">Issue date:</span>
              <span className="font-medium text-[#121513]">{formatLagosDateOnly(snap.issueDate)}</span>
            </div>
            <div className="flex sm:justify-end gap-3">
              <span className="text-[#5C635D]">Due date:</span>
              <span className="font-medium text-[#121513]">{formatLagosDateOnly(snap.dueDate)}</span>
            </div>
            <div className="flex sm:justify-end gap-3">
              <span className="text-[#5C635D]">Terms:</span>
              <span className="font-medium text-[#121513]">
                {formatTermsLabel(snap.termsKind, snap.dueDate)}
              </span>
            </div>
          </div>
        </div>

        {/* Line Items Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-y border-[#E5DEC9] bg-[#F5F1E7] text-[10px] font-mono uppercase tracking-wider text-[#5C635D]">
                <th className="py-2.5 px-2.5">Description</th>
                <th className="py-2.5 px-2 text-right">Qty</th>
                <th className="py-2.5 px-2 text-right">Unit Price</th>
                <th className="py-2.5 px-2.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EFEAD9] text-xs">
              {snap.lines.map((line, idx) => (
                <tr key={line.id || idx}>
                  <td className="py-3 px-2.5">
                    <p className="font-medium text-[#121513]">{line.description}</p>
                    {line.discountKobo > 0 && (
                      <p className="text-[11px] text-[#5C635D]">
                        Line discount: −{formatKobo(line.discountKobo, cur)}
                      </p>
                    )}
                  </td>
                  <td className="py-3 px-2 text-right font-mono tabular-nums text-[#121513]">
                    {formatQtyThousandths(line.qtyThousandths)}
                  </td>
                  <td className="py-3 px-2 text-right font-mono tabular-nums text-[#121513]">
                    {formatKobo(line.unitPriceKobo, cur)}
                  </td>
                  <td className="py-3 px-2.5 text-right font-mono font-semibold tabular-nums text-[#121513]">
                    {formatKobo(line.lineTotalKobo, cur)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="flex justify-end">
          <div className="w-full sm:w-72 space-y-1.5 text-xs">
            <div className="flex justify-between text-[#5C635D]">
              <span>Subtotal</span>
              <span className="font-mono tabular-nums text-[#121513]">
                {formatKobo(snap.subtotalKobo, cur)}
              </span>
            </div>
            {snap.lineDiscountTotalKobo > 0 && (
              <div className="flex justify-between text-[#5C635D]">
                <span>Line discounts</span>
                <span className="font-mono tabular-nums text-[#121513]">
                  −{formatKobo(snap.lineDiscountTotalKobo, cur)}
                </span>
              </div>
            )}
            {snap.invoiceDiscountKobo > 0 && (
              <div className="flex justify-between text-[#5C635D]">
                <span>Invoice discount</span>
                <span className="font-mono tabular-nums text-[#121513]">
                  −{formatKobo(snap.invoiceDiscountKobo, cur)}
                </span>
              </div>
            )}
            {snap.vatEnabled && snap.vatKobo > 0 && (
              <div className="flex justify-between text-[#5C635D]">
                <span>
                  VAT ({(snap.vatRateBps / 100).toFixed(1).replace(/\.0$/, '')}%
                  {snap.vatMode === 'inclusive' ? ' incl.' : ''})
                </span>
                <span className="font-mono tabular-nums text-[#121513]">
                  {formatKobo(snap.vatKobo, cur)}
                </span>
              </div>
            )}
            <div className="pt-2 border-t border-[#E5DEC9] flex justify-between text-sm font-semibold">
              <span>Invoice Total</span>
              <span className="font-mono tabular-nums">{formatKobo(snap.totalKobo, cur)}</span>
            </div>
            {snap.depositType !== 'none' &&
              snap.amountDueNowKobo < snap.totalKobo &&
              invoice.amountPaidKobo === 0 && (
                <div className="flex justify-between text-xs font-semibold" style={{ color: accent }}>
                  <span>Amount due now</span>
                  <span className="font-mono tabular-nums">
                    {formatKobo(snap.amountDueNowKobo, cur)}
                  </span>
                </div>
              )}
            {invoice.amountPaidKobo > 0 && (
              <div className="flex justify-between text-[#064E3B]">
                <span>Amount paid</span>
                <span className="font-mono tabular-nums">
                  {formatKobo(invoice.amountPaidKobo, cur)}
                </span>
              </div>
            )}
            {invoice.writtenOffKobo > 0 && (
              <div className="flex justify-between text-[#5C635D]">
                <span>Written off</span>
                <span className="font-mono tabular-nums">
                  {formatKobo(invoice.writtenOffKobo, cur)}
                </span>
              </div>
            )}
            <div className="pt-1.5 border-t border-[#E5DEC9] flex justify-between text-sm font-bold">
              <span>What&apos;s left</span>
              <span className="font-mono tabular-nums" style={{ color: accent }}>
                {formatKobo(invoice.balanceDueKobo, cur)}
              </span>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-[#5C635D] border-t border-[#EFEAD9] pt-3">
          In words: {koboToWords(snap.totalKobo, cur)}
        </p>

        {/* Bank Details (from snapshot) */}
        {snap.bankAccounts.length > 0 && (
          <div className="rounded-xl border border-[#E5DEC9] bg-[#FAF8F3] p-4 space-y-2">
            <p className="label-caps text-[#5C635D]">Bank Transfer Details</p>
            <div className="space-y-2">
              {snap.bankAccounts.map((bank) => (
                <div
                  key={bank.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-xs border-b last:border-b-0 border-[#EFEAD9] pb-1.5 last:pb-0"
                >
                  <div>
                    <p className="font-semibold text-[#121513]">{bank.bankName}</p>
                    <p className="text-[#5C635D]">{bank.accountName}</p>
                  </div>
                  <p className="font-mono text-sm font-semibold text-[#121513]">
                    {bank.accountNumber}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        {snap.notes && (
          <div className="text-xs text-[#5C635D]">
            <p className="label-caps text-[#5C635D]">Notes</p>
            <p className="mt-1 whitespace-pre-wrap text-[#121513]">{snap.notes}</p>
          </div>
        )}

        {/* Void notice */}
        {invoice.status === 'VOID' && invoice.voidReason && (
          <div className="rounded-xl border border-[#B91C1C]/30 bg-[#FEF2F2] p-3 text-xs text-[#991B1B]">
            <strong>Voided:</strong> {invoice.voidReason}
          </div>
        )}
      </div>
    </article>
  );
}
