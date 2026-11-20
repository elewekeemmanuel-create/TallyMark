import React from 'react';
import { formatKobo, formatLagosDateOnly, koboToWords } from '../../shared/money';
import { formatQtyThousandths, formatTermsLabel } from '../../shared/v2/money';
import type { PublicQuoteRecord } from '../../shared/v2/types';

function getQuoteStamp(quote: PublicQuoteRecord): { label: string; className: string } {
  if (quote.status === 'VOID') {
    return { label: 'VOID', className: 'border-[#B91C1C] text-[#B91C1C]' };
  }
  if (quote.status === 'ACCEPTED') {
    return { label: 'ACCEPTED', className: 'border-[#064E3B] text-[#064E3B]' };
  }
  if (quote.status === 'CONVERTED') {
    return { label: 'CONVERTED', className: 'border-[#064E3B] text-[#064E3B]' };
  }
  if (quote.status === 'DECLINED') {
    return { label: 'DECLINED', className: 'border-[#B91C1C] text-[#B91C1C]' };
  }
  if (quote.isExpired) {
    return { label: 'EXPIRED', className: 'border-[#B45309] text-[#B45309]' };
  }
  if (quote.status === 'DRAFT') {
    return { label: 'DRAFT', className: 'border-[#5C635D] text-[#5C635D]' };
  }
  return { label: 'QUOTATION', className: 'border-[#5C635D] text-[#5C635D]' };
}

/**
 * Paper-ledger Quotation template matching Tallymark Invoices and Receipts.
 * Renders strictly from `quote.snapshot` so later business edits never alter sent quotes.
 */
export function QuoteDocument({ quote }: { quote: PublicQuoteRecord }) {
  const snap = quote.snapshot;
  const cur = snap.business.currency || 'NGN';
  const accent = snap.business.brandColor || '#064E3B';
  const stamp = getQuoteStamp(quote);
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
                Quotation
              </p>
              <p className="font-mono text-lg font-semibold text-[#121513]">{snap.quoteNumber}</p>
            </div>
            <span
              className={`rubber-stamp inline-block border-2 px-3 py-1 font-mono text-xs font-semibold uppercase tracking-widest ${stamp.className}`}
            >
              {stamp.label}
            </span>
          </div>
        </div>

        {/* Prepared For & Dates */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <p className="label-caps text-[#5C635D]">Prepared For</p>
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
              <span className="text-[#5C635D]">Valid until:</span>
              <span className="font-medium text-[#121513]">{formatLagosDateOnly(snap.validUntil)}</span>
            </div>
            <div className="flex sm:justify-end gap-3">
              <span className="text-[#5C635D]">Payment terms:</span>
              <span className="font-medium text-[#121513]">
                {formatTermsLabel(snap.termsKind)}
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
                <span>Quote discount</span>
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
            <div className="pt-2 border-t border-[#E5DEC9] flex justify-between text-sm font-bold">
              <span>Quote Total</span>
              <span className="font-mono tabular-nums" style={{ color: accent }}>
                {formatKobo(snap.totalKobo, cur)}
              </span>
            </div>
            {snap.depositType !== 'none' && snap.amountDueNowKobo < snap.totalKobo && (
              <div className="flex justify-between text-xs font-semibold text-[#5C635D]">
                <span>Deposit if accepted</span>
                <span className="font-mono tabular-nums text-[#121513]">
                  {formatKobo(snap.amountDueNowKobo, cur)}
                </span>
              </div>
            )}
          </div>
        </div>

        <p className="text-[11px] text-[#5C635D] border-t border-[#EFEAD9] pt-3">
          In words: {koboToWords(snap.totalKobo, cur)}
        </p>

        {/* Notes */}
        {snap.notes && (
          <div className="text-xs text-[#5C635D]">
            <p className="label-caps text-[#5C635D]">Notes &amp; Terms</p>
            <p className="mt-1 whitespace-pre-wrap text-[#121513]">{snap.notes}</p>
          </div>
        )}

        {/* Void notice */}
        {quote.status === 'VOID' && quote.voidReason && (
          <div className="rounded-xl border border-[#B91C1C]/30 bg-[#FEF2F2] p-3 text-xs text-[#991B1B]">
            <strong>Voided:</strong> {quote.voidReason}
          </div>
        )}
      </div>
    </article>
  );
}
