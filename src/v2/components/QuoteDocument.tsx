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

  const isDense = snap.lines.length >= 10;

  return (
    <article
      className={`invoice-print-sheet print-only-container rounded-2xl border border-[#E5DEC9] bg-[#FFFDF9] text-[#121513] overflow-hidden shadow-xs print:rounded-none print:border-0 print:shadow-none print:max-w-none ${
        isCompact ? 'max-w-md mx-auto' : 'w-full'
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
        <div className="flex flex-col sm:flex-row print:flex-row sm:items-start print:items-start justify-between gap-3 border-b border-[#E5DEC9] pb-4 print:pb-2.5">
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
                className="w-11 h-11 print:w-9 print:h-9 rounded-xl flex items-center justify-center text-white font-semibold text-sm shrink-0"
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
                <p className="mt-0.5 text-xs print:text-[10px] text-[#5C635D]">
                  {snap.business.address}
                </p>
              )}
              {(snap.business.phone || snap.business.email) && (
                <p className="text-xs print:text-[10px] text-[#5C635D]">
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
              <p className="label-caps" style={{ color: accent }}>
                Quotation
              </p>
              <p className="font-mono text-base sm:text-lg print:text-sm font-semibold text-[#121513]">
                {snap.quoteNumber}
              </p>
            </div>
            <span
              className={`rubber-stamp inline-block border-2 px-2.5 py-0.5 font-mono text-[11px] print:text-[10px] font-semibold uppercase tracking-widest ${stamp.className}`}
            >
              {stamp.label}
            </span>
          </div>
        </div>

        {/* Prepared For & Dates */}
        <div className="grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-3 text-xs print:text-[10.5px]">
          <div>
            <p className="label-caps text-[#5C635D]">Prepared For</p>
            <p className="mt-0.5 text-sm print:text-xs font-semibold text-[#121513]">
              {snap.customer.name}
            </p>
            {snap.customer.address && (
              <p className="mt-0.5 text-xs print:text-[10px] text-[#5C635D]">
                {snap.customer.address}
              </p>
            )}
          </div>
          <div className="sm:text-right print:text-right space-y-0.5 font-mono">
            <div className="flex sm:justify-end print:justify-end gap-3">
              <span className="text-[#5C635D]">Issue date:</span>
              <span className="font-medium text-[#121513]">
                {formatLagosDateOnly(snap.issueDate)}
              </span>
            </div>
            <div className="flex sm:justify-end print:justify-end gap-3">
              <span className="text-[#5C635D]">Valid until:</span>
              <span className="font-medium text-[#121513]">
                {formatLagosDateOnly(snap.validUntil)}
              </span>
            </div>
            <div className="flex sm:justify-end print:justify-end gap-3">
              <span className="text-[#5C635D]">Payment terms:</span>
              <span className="font-medium text-[#121513]">
                {formatTermsLabel(snap.termsKind)}
              </span>
            </div>
          </div>
        </div>

        {/* Line Items Table */}
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-y border-[#E5DEC9] bg-[#F5F1E7] text-[10px] print:text-[9px] font-mono uppercase tracking-wider text-[#5C635D]">
                <th className="py-2 px-2.5 print:py-1 print:px-1.5">Description</th>
                <th className="py-2 px-2 print:py-1 print:px-1.5 text-right">Qty</th>
                <th className="py-2 px-2 print:py-1 print:px-1.5 text-right">Unit Price</th>
                <th className="py-2 px-2.5 print:py-1 print:px-1.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody
              className={`divide-y divide-[#EFEAD9] ${
                isDense ? 'text-[11px] print:text-[9.5px]' : 'text-xs print:text-[10.5px]'
              }`}
            >
              {snap.lines.map((line, idx) => (
                <tr key={line.id || idx}>
                  <td
                    className={
                      isDense
                        ? 'py-1.5 px-2.5 print:py-0.5 print:px-1.5'
                        : 'py-2 px-2.5 print:py-1 print:px-1.5'
                    }
                  >
                    <p className="font-medium text-[#121513] leading-snug">{line.description}</p>
                    {line.discountKobo > 0 && (
                      <p className="text-[10.5px] print:text-[9px] text-[#5C635D]">
                        Line discount: −{formatKobo(line.discountKobo, cur)}
                      </p>
                    )}
                  </td>
                  <td
                    className={
                      isDense
                        ? 'py-1.5 px-2 print:py-0.5 print:px-1.5 text-right font-mono tabular-nums text-[#121513]'
                        : 'py-2 px-2 print:py-1 print:px-1.5 text-right font-mono tabular-nums text-[#121513]'
                    }
                  >
                    {formatQtyThousandths(line.qtyThousandths)}
                  </td>
                  <td
                    className={
                      isDense
                        ? 'py-1.5 px-2 print:py-0.5 print:px-1.5 text-right font-mono tabular-nums text-[#121513]'
                        : 'py-2 px-2 print:py-1 print:px-1.5 text-right font-mono tabular-nums text-[#121513]'
                    }
                  >
                    {formatKobo(line.unitPriceKobo, cur)}
                  </td>
                  <td
                    className={
                      isDense
                        ? 'py-1.5 px-2.5 print:py-0.5 print:px-1.5 text-right font-mono font-semibold tabular-nums text-[#121513]'
                        : 'py-2 px-2.5 print:py-1 print:px-1.5 text-right font-mono font-semibold tabular-nums text-[#121513]'
                    }
                  >
                    {formatKobo(line.lineTotalKobo, cur)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Bottom 2-column summary zone: Words & Notes on left, Totals on right */}
        <div className="grid grid-cols-1 sm:grid-cols-12 print:grid-cols-12 gap-4 print:gap-3 pt-1 print:break-inside-avoid">
          <div className="sm:col-span-7 print:col-span-7 space-y-2.5 print:space-y-1.5 order-2 sm:order-1 print:order-1">
            <p className="text-[11px] print:text-[9.5px] text-[#5C635D] leading-snug">
              In words: {koboToWords(snap.totalKobo, cur)}
            </p>

            {snap.notes && (
              <div className="text-xs print:text-[9.5px] text-[#5C635D]">
                <p className="label-caps text-[#5C635D]">Notes &amp; Terms</p>
                <p className="mt-0.5 whitespace-pre-wrap text-[#121513] leading-snug">
                  {snap.notes}
                </p>
              </div>
            )}

            {quote.status === 'VOID' && quote.voidReason && (
              <div className="rounded-xl border border-[#B91C1C]/30 bg-[#FEF2F2] p-2.5 text-xs print:text-[9.5px] text-[#991B1B]">
                <strong>Voided:</strong> {quote.voidReason}
              </div>
            )}
          </div>

          <div className="sm:col-span-5 print:col-span-5 order-1 sm:order-2 print:order-2">
            <div className="space-y-1 text-xs print:text-[10px]">
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
              <div className="pt-1.5 border-t border-[#E5DEC9] flex justify-between text-sm print:text-xs font-bold">
                <span>Quote Total</span>
                <span className="font-mono tabular-nums" style={{ color: accent }}>
                  {formatKobo(snap.totalKobo, cur)}
                </span>
              </div>
              {snap.depositType !== 'none' && snap.amountDueNowKobo < snap.totalKobo && (
                <div className="flex justify-between text-xs print:text-[10px] font-semibold text-[#5C635D]">
                  <span>Deposit if accepted</span>
                  <span className="font-mono tabular-nums text-[#121513]">
                    {formatKobo(snap.amountDueNowKobo, cur)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
