import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  formatKobo,
  formatLagosDateOnly,
  formatLagosDateTime,
  koboToWords,
} from '../shared/money';
import type { ReceiptTemplate } from '../shared/schemas';
import type { BusinessProfile, PublicReceiptRecord, ReceiptRecord } from '../shared/types';
import { RubberStamp, TallymarkEmblem } from './TallymarkLogo';

export function receiptToPublicPreview(
  receipt: ReceiptRecord,
  business: BusinessProfile
): PublicReceiptRecord {
  return {
    publicId: receipt.publicId,
    receiptNumber: receipt.receiptNumber,
    receiptKind: receipt.receiptKind,
    parentReceiptNumber: receipt.parentReceiptNumber,
    businessName: business.name,
    businessLogoDataUrl: business.logoDataUrl,
    businessAddress: business.address,
    businessPhone: business.phone,
    businessEmail: business.email,
    brandColor: business.brandColor,
    currency: business.currency,
    customerName: receipt.customerName,
    customerPhone: receipt.customerPhone,
    items: receipt.items,
    subtotalKobo: receipt.subtotalKobo,
    discountTotalKobo: receipt.discountTotalKobo,
    vatEnabled: receipt.vatEnabled,
    vatMode: receipt.vatMode,
    vatRateBps: receipt.vatRateBps,
    vatKobo: receipt.vatKobo,
    totalKobo: receipt.totalKobo,
    amountPaidKobo: receipt.amountPaidKobo,
    balanceDueKobo: receipt.balanceDueKobo,
    paymentMethod: receipt.paymentMethod,
    note: receipt.note,
    soldBy: receipt.soldBy,
    template: receipt.template,
    status: receipt.status,
    voidReason: receipt.voidReason,
    voidedAt: receipt.voidedAt,
    issuedDateLagos: receipt.issuedDateLagos,
    issuedAt: receipt.issuedAt,
  };
}

function useQrDataUrl(publicId: string) {
  const [qrUrl, setQrUrl] = useState<string>('');
  useEffect(() => {
    let active = true;
    const targetUrl =
      typeof window !== 'undefined'
        ? `${window.location.origin}/r/${publicId || 'preview'}`
        : `https://tallymark.app/r/${publicId || 'preview'}`;
    QRCode.toDataURL(targetUrl, {
      width: 160,
      margin: 1,
      color: { dark: '#121513', light: '#FFFDF9' },
    })
      .then((url) => {
        if (active) setQrUrl(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [publicId]);
  return qrUrl;
}

export function ReceiptTemplateView({
  receipt,
  templateOverride,
}: {
  receipt: PublicReceiptRecord;
  templateOverride?: ReceiptTemplate;
}) {
  const template = templateOverride || receipt.template || 'modern';
  const qrUrl = useQrDataUrl(receipt.publicId);
  const brandColor = receipt.brandColor || '#064E3B';
  const words = koboToWords(receipt.totalKobo, receipt.currency);

  if (template === 'compact') {
    return (
      <div
        className="print-only-container print-compact-80mm receipt-paper-grain receipt-serrated-bottom mx-auto w-full max-w-[328px] border border-[#E5DEC9] text-[#121513] px-5 pt-6 pb-7 shadow-sm"
        style={{ fontSize: '13px' }}
      >
        <div className="text-center space-y-1">
          {receipt.businessLogoDataUrl && (
            <img
              src={receipt.businessLogoDataUrl}
              alt={`${receipt.businessName} logo`}
              referrerPolicy="no-referrer"
              className="mx-auto mb-2 h-11 w-11 rounded-lg object-contain border border-[#E5DEC9] bg-white p-1"
            />
          )}
          <h2 className="text-base font-bold tracking-tight text-[#121513]">
            {receipt.businessName}
          </h2>
          {receipt.businessAddress && (
            <p className="text-[11px] leading-snug text-[#5C635D]">{receipt.businessAddress}</p>
          )}
          {(receipt.businessPhone || receipt.businessEmail) && (
            <p className="font-mono-num text-[11px] text-[#5C635D]">
              {[receipt.businessPhone, receipt.businessEmail].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        <div className="my-3 border-t border-dashed border-[#C9B99A]" />

        <div className="space-y-1 font-mono-num text-[12px]">
          <div className="flex justify-between gap-2">
            <span className="text-[#5C635D]">Receipt</span>
            <span className="font-semibold text-[#121513]">{receipt.receiptNumber}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-[#5C635D]">Date</span>
            <span>{formatLagosDateOnly(receipt.issuedDateLagos)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-[#5C635D]">Customer</span>
            <span className="text-right font-sans-ui font-medium truncate max-w-[175px]">
              {receipt.customerName || 'Walk-in'}
            </span>
          </div>
          {receipt.soldBy && (
            <div className="flex justify-between gap-2">
              <span className="text-[#5C635D]">Sold by</span>
              <span className="font-sans-ui">{receipt.soldBy}</span>
            </div>
          )}
          {receipt.parentReceiptNumber && (
            <div className="flex justify-between gap-2">
              <span className="text-[#5C635D]">Ref</span>
              <span>{receipt.parentReceiptNumber}</span>
            </div>
          )}
        </div>

        <div className="my-3 border-t border-dashed border-[#C9B99A]" />

        <div className="space-y-2.5">
          {receipt.items.map((item, idx) => (
            <div key={`${item.description}-${idx}`} className="text-[12.5px]">
              <div className="font-medium text-[#121513]">{item.description}</div>
              <div className="flex justify-between font-mono-num text-[12px] text-[#5C635D]">
                <span>
                  {item.qty} × {formatKobo(item.unitPriceKobo, receipt.currency)}
                  {item.discountKobo > 0
                    ? ` (−${formatKobo(item.discountKobo, receipt.currency)})`
                    : ''}
                </span>
                <span className="font-semibold text-[#121513]">
                  {formatKobo(item.lineTotalKobo, receipt.currency)}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="my-3 border-t border-dashed border-[#C9B99A]" />

        <div className="space-y-1 font-mono-num text-[12px]">
          <div className="flex justify-between">
            <span className="text-[#5C635D]">Subtotal</span>
            <span>{formatKobo(receipt.subtotalKobo, receipt.currency)}</span>
          </div>
          {receipt.discountTotalKobo > 0 && (
            <div className="flex justify-between text-[#B45309]">
              <span>Discount</span>
              <span>−{formatKobo(receipt.discountTotalKobo, receipt.currency)}</span>
            </div>
          )}
          {receipt.vatEnabled && receipt.vatKobo > 0 && (
            <div className="flex justify-between text-[#5C635D]">
              <span>VAT 7.5% ({receipt.vatMode})</span>
              <span>{formatKobo(receipt.vatKobo, receipt.currency)}</span>
            </div>
          )}
          <div className="flex justify-between pt-1.5 border-t border-[#E5DEC9] text-[14px] font-semibold text-[#121513]">
            <span>TOTAL</span>
            <span>{formatKobo(receipt.totalKobo, receipt.currency)}</span>
          </div>
          <div className="flex justify-between text-[#5C635D]">
            <span>Paid ({receipt.paymentMethod})</span>
            <span className="text-[#121513]">
              {formatKobo(receipt.amountPaidKobo, receipt.currency)}
            </span>
          </div>
          {receipt.balanceDueKobo > 0 && (
            <div className="flex justify-between font-semibold text-[#B45309]">
              <span>Balance Due</span>
              <span>{formatKobo(receipt.balanceDueKobo, receipt.currency)}</span>
            </div>
          )}
        </div>

        <p className="mt-2.5 pt-2 border-t border-dashed border-[#C9B99A] text-[11px] leading-snug text-[#5C635D]">
          <span className="font-semibold text-[#121513]">In words:</span> {words}
        </p>

        {receipt.note && (
          <p className="mt-3 pt-2 border-t border-dashed border-[#C9B99A] text-[11px] text-[#5C635D]">
            Note: {receipt.note}
          </p>
        )}

        {receipt.status === 'VOID' && receipt.voidReason && (
          <div className="mt-3 rounded border border-[#B91C1C]/30 bg-[#FEF2F2] p-2 text-[11px] font-medium text-[#B91C1C]">
            VOID REASON: {receipt.voidReason}
          </div>
        )}

        <div className="mt-4 flex flex-col items-center gap-3">
          <RubberStamp status={receipt.status} compact />
          {qrUrl && (
            <img
              src={qrUrl}
              alt="Receipt verification QR code"
              className="h-20 w-20 rounded border border-[#E5DEC9] bg-white p-1"
            />
          )}
          <div className="flex items-center gap-1.5 text-[11px] text-[#5C635D]">
            <TallymarkEmblem className="w-3.5 h-3.5" strokeColor={brandColor} />
            <span>Issued with Tallymark</span>
          </div>
        </div>
      </div>
    );
  }

  if (template === 'classic') {
    return (
      <div className="print-only-container receipt-paper-grain mx-auto w-full max-w-[680px] border-2 p-2 shadow-sm text-[#121513]" style={{ borderColor: brandColor }}>
        <div className="border border-[#C9B99A] p-6 sm:p-8">
          {/* Centered Classic Header */}
          <div className="text-center pb-5 border-b border-[#D8CEB8]">
            {receipt.businessLogoDataUrl && (
              <img
                src={receipt.businessLogoDataUrl}
                alt={`${receipt.businessName} logo`}
                referrerPolicy="no-referrer"
                className="mx-auto mb-3 h-14 w-14 rounded-xl object-contain border border-[#E5DEC9] bg-white p-1"
              />
            )}
            <h2 className="font-display text-3xl sm:text-4xl text-[#121513] tracking-[-0.02em]">
              {receipt.businessName}
            </h2>
            {receipt.businessAddress && (
              <p className="mt-1 text-xs text-[#5C635D]">{receipt.businessAddress}</p>
            )}
            {(receipt.businessPhone || receipt.businessEmail) && (
              <p className="mt-0.5 font-mono-num text-xs text-[#5C635D]">
                {[receipt.businessPhone, receipt.businessEmail].filter(Boolean).join(' · ')}
              </p>
            )}
            <div className="mt-4 inline-block border-y border-[#C9B99A] px-5 py-1">
              <span className="label-caps" style={{ color: brandColor }}>
                {receipt.receiptKind === 'BALANCE_PAYMENT' ? 'Balance Payment Voucher' : 'Official Payment Receipt'}
              </span>
            </div>
          </div>

          {/* Meta Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 border-b border-[#E5DEC9] text-xs">
            <div>
              <p className="label-caps text-[#5C635D]">Receipt No.</p>
              <p className="mt-1 font-mono-num font-semibold text-sm">{receipt.receiptNumber}</p>
            </div>
            <div>
              <p className="label-caps text-[#5C635D]">Date</p>
              <p className="mt-1 font-mono-num">{formatLagosDateOnly(receipt.issuedDateLagos)}</p>
            </div>
            <div>
              <p className="label-caps text-[#5C635D]">Received From</p>
              <p className="mt-1 font-semibold">{receipt.customerName || 'Walk-in Customer'}</p>
              {receipt.customerPhone && (
                <p className="font-mono-num text-[11px] text-[#5C635D]">{receipt.customerPhone}</p>
              )}
            </div>
            <div>
              <p className="label-caps text-[#5C635D]">Method</p>
              <p className="mt-1 font-medium">{receipt.paymentMethod}</p>
              {receipt.soldBy && (
                <p className="text-[11px] text-[#5C635D]">Sold by {receipt.soldBy}</p>
              )}
            </div>
          </div>

          {receipt.parentReceiptNumber && (
            <div className="mt-3 text-xs font-mono-num" style={{ color: brandColor }}>
              Linked to original receipt {receipt.parentReceiptNumber}
            </div>
          )}

          {/* Bordered Ledger Table */}
          <div className="mt-5 overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-y border-[#C9B99A] bg-[#F3EFE6]/70">
                  <th className="py-2 px-3 text-left label-caps text-[#5C635D]">Item Description</th>
                  <th className="py-2 px-2 text-right label-caps text-[#5C635D]">Qty</th>
                  <th className="py-2 px-2 text-right label-caps text-[#5C635D]">Rate</th>
                  <th className="py-2 px-3 text-right label-caps text-[#5C635D]">Amount</th>
                </tr>
              </thead>
              <tbody>
                {receipt.items.map((item, idx) => (
                  <tr key={`${item.description}-${idx}`} className="border-b border-[#E5DEC9]">
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-[#121513]">{item.description}</div>
                      {item.discountKobo > 0 && (
                        <div className="font-mono-num text-[11px] text-[#B45309]">
                          Discount: −{formatKobo(item.discountKobo, receipt.currency)}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono-num">{item.qty}</td>
                    <td className="py-2.5 px-2 text-right font-mono-num">
                      {formatKobo(item.unitPriceKobo, receipt.currency)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-num font-semibold">
                      {formatKobo(item.lineTotalKobo, receipt.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals & Stamp */}
          <div className="mt-6 flex flex-col sm:flex-row sm:items-start justify-between gap-6">
            <div className="space-y-3 max-w-xs">
              <RubberStamp status={receipt.status} />
              <div className="rounded-lg border border-[#E5DEC9] bg-[#FAF8F3] p-3">
                <p className="label-caps text-[#5C635D]">Amount in words</p>
                <p className="mt-1 text-xs font-medium text-[#121513] leading-relaxed">{words}</p>
              </div>
            </div>

            <div className="w-full sm:w-64 space-y-1.5 font-mono-num text-[13px]">
              <div className="flex justify-between text-[#5C635D]">
                <span>Subtotal</span>
                <span>{formatKobo(receipt.subtotalKobo, receipt.currency)}</span>
              </div>
              {receipt.discountTotalKobo > 0 && (
                <div className="flex justify-between text-[#B45309]">
                  <span>Discount</span>
                  <span>−{formatKobo(receipt.discountTotalKobo, receipt.currency)}</span>
                </div>
              )}
              {receipt.vatEnabled && receipt.vatKobo > 0 && (
                <div className="flex justify-between text-[#5C635D]">
                  <span>VAT 7.5% ({receipt.vatMode})</span>
                  <span>{formatKobo(receipt.vatKobo, receipt.currency)}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-[#C9B99A] text-base font-semibold text-[#121513]">
                <span>Total</span>
                <span>{formatKobo(receipt.totalKobo, receipt.currency)}</span>
              </div>
              <div className="flex justify-between text-[#5C635D]">
                <span>Paid</span>
                <span className="font-semibold text-[#121513]">
                  {formatKobo(receipt.amountPaidKobo, receipt.currency)}
                </span>
              </div>
              {receipt.balanceDueKobo > 0 && (
                <div className="flex justify-between font-semibold text-[#B45309]">
                  <span>Balance Due</span>
                  <span>{formatKobo(receipt.balanceDueKobo, receipt.currency)}</span>
                </div>
              )}
            </div>
          </div>

          {receipt.note && (
            <p className="mt-4 text-xs text-[#5C635D]">
              <strong className="text-[#121513]">Note:</strong> {receipt.note}
            </p>
          )}

          {receipt.status === 'VOID' && receipt.voidReason && (
            <div className="mt-4 rounded-lg border border-[#B91C1C]/30 bg-[#FEF2F2] p-3 text-xs font-medium text-[#B91C1C]">
              VOID REASON: {receipt.voidReason}
              {receipt.voidedAt && (
                <span className="block mt-0.5 font-mono-num text-[11px] opacity-80">
                  Voided {formatLagosDateTime(receipt.voidedAt)}
                </span>
              )}
            </div>
          )}

          {/* Footer with QR + Tallymark signature */}
          <div className="mt-6 pt-4 border-t border-[#D8CEB8] flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs text-[#5C635D]">
              <TallymarkEmblem className="w-4 h-4" strokeColor={brandColor} />
              <span>
                Issued with <strong className="text-[#121513]">Tallymark</strong> ·{' '}
                {formatLagosDateTime(receipt.issuedAt)}
              </span>
            </div>
            {qrUrl && (
              <img
                src={qrUrl}
                alt="Receipt QR code"
                className="h-14 w-14 rounded border border-[#E5DEC9] bg-white p-0.5 shrink-0"
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  // Modern Template (Default)
  return (
    <div className="print-only-container mx-auto w-full max-w-[680px] rounded-2xl border border-[#E5DEC9] bg-white text-[#121513] overflow-hidden shadow-sm">
      <div className="h-2.5 w-full" style={{ backgroundColor: brandColor }} />

      <div className="p-6 sm:p-8">
        {/* Top Row */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-5 pb-6 border-b border-[#ECE6D8]">
          <div className="flex items-start gap-3.5">
            {receipt.businessLogoDataUrl && (
              <img
                src={receipt.businessLogoDataUrl}
                alt={`${receipt.businessName} logo`}
                referrerPolicy="no-referrer"
                className="h-13 w-13 rounded-xl object-contain border border-[#ECE6D8] bg-[#FAF8F3] p-1 shrink-0"
              />
            )}
            <div>
              <h2 className="font-display text-3xl text-[#121513] leading-tight">
                {receipt.businessName}
              </h2>
              {receipt.businessAddress && (
                <p className="mt-1 text-xs text-[#5C635D] max-w-xs">{receipt.businessAddress}</p>
              )}
              {(receipt.businessPhone || receipt.businessEmail) && (
                <p className="mt-0.5 font-mono-num text-xs text-[#5C635D]">
                  {[receipt.businessPhone, receipt.businessEmail].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </div>

          <div className="sm:text-right shrink-0">
            <p className="label-caps" style={{ color: brandColor }}>
              {receipt.receiptKind === 'BALANCE_PAYMENT' ? 'Balance Payment' : 'Receipt'}
            </p>
            <p className="mt-1 font-mono-num text-xl font-semibold text-[#121513]">
              {receipt.receiptNumber}
            </p>
            <p className="mt-0.5 font-mono-num text-xs text-[#5C635D]">
              {formatLagosDateOnly(receipt.issuedDateLagos)}
            </p>
          </div>
        </div>

        {/* Customer + Payment Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 py-5 border-b border-[#ECE6D8]">
          <div>
            <p className="label-caps text-[#5C635D]">Customer</p>
            <p className="mt-1 text-sm font-semibold text-[#121513]">
              {receipt.customerName || 'Walk-in Customer'}
            </p>
            {receipt.customerPhone && (
              <p className="font-mono-num text-xs text-[#5C635D]">{receipt.customerPhone}</p>
            )}
          </div>
          <div>
            <p className="label-caps text-[#5C635D]">Payment</p>
            <p className="mt-1 text-sm font-semibold text-[#121513]">{receipt.paymentMethod}</p>
            {receipt.parentReceiptNumber && (
              <p className="font-mono-num text-xs" style={{ color: brandColor }}>
                For {receipt.parentReceiptNumber}
              </p>
            )}
          </div>
          {receipt.soldBy && (
            <div>
              <p className="label-caps text-[#5C635D]">Sold By</p>
              <p className="mt-1 text-sm font-medium text-[#121513]">{receipt.soldBy}</p>
            </div>
          )}
        </div>

        {/* Line Items */}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#ECE6D8] text-[#5C635D]">
                <th className="pb-2.5 text-left label-caps">Description</th>
                <th className="pb-2.5 text-right label-caps">Qty</th>
                <th className="pb-2.5 text-right label-caps">Unit Price</th>
                <th className="pb-2.5 text-right label-caps">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3EFE6]">
              {receipt.items.map((item, idx) => (
                <tr key={`${item.description}-${idx}`}>
                  <td className="py-3 pr-3">
                    <div className="font-medium text-[#121513]">{item.description}</div>
                    {item.discountKobo > 0 && (
                      <div className="font-mono-num text-[11px] text-[#B45309]">
                        Discount: −{formatKobo(item.discountKobo, receipt.currency)}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-2 text-right font-mono-num text-[#5C635D]">{item.qty}</td>
                  <td className="py-3 px-2 text-right font-mono-num text-[#5C635D]">
                    {formatKobo(item.unitPriceKobo, receipt.currency)}
                  </td>
                  <td className="py-3 pl-2 text-right font-mono-num font-semibold text-[#121513]">
                    {formatKobo(item.lineTotalKobo, receipt.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Stamp + Totals */}
        <div className="mt-6 pt-5 border-t border-[#ECE6D8] flex flex-col sm:flex-row sm:items-start justify-between gap-6">
          <div className="space-y-3">
            <RubberStamp status={receipt.status} />
            <div className="max-w-xs">
              <p className="label-caps text-[#5C635D]">Amount in words</p>
              <p className="mt-1 text-xs text-[#121513] leading-relaxed">{words}</p>
            </div>
            {receipt.note && (
              <div className="max-w-xs">
                <p className="label-caps text-[#5C635D]">Note</p>
                <p className="mt-1 text-xs text-[#5C635D]">{receipt.note}</p>
              </div>
            )}
          </div>

          <div className="w-full sm:w-64 rounded-xl bg-[#FAF8F3] border border-[#ECE6D8] p-4 space-y-2 font-mono-num text-[13px]">
            <div className="flex justify-between text-[#5C635D]">
              <span>Subtotal</span>
              <span>{formatKobo(receipt.subtotalKobo, receipt.currency)}</span>
            </div>
            {receipt.discountTotalKobo > 0 && (
              <div className="flex justify-between text-[#B45309]">
                <span>Discounts</span>
                <span>−{formatKobo(receipt.discountTotalKobo, receipt.currency)}</span>
              </div>
            )}
            {receipt.vatEnabled && receipt.vatKobo > 0 && (
              <div className="flex justify-between text-[#5C635D]">
                <span>VAT 7.5% ({receipt.vatMode})</span>
                <span>{formatKobo(receipt.vatKobo, receipt.currency)}</span>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t border-[#E5DEC9] text-base font-semibold text-[#121513]">
              <span>Total</span>
              <span>{formatKobo(receipt.totalKobo, receipt.currency)}</span>
            </div>
            <div className="flex justify-between text-[#5C635D]">
              <span>Paid</span>
              <span className="font-semibold text-[#121513]">
                {formatKobo(receipt.amountPaidKobo, receipt.currency)}
              </span>
            </div>
            {receipt.balanceDueKobo > 0 && (
              <div className="flex justify-between font-semibold text-[#B45309]">
                <span>Balance Due</span>
                <span>{formatKobo(receipt.balanceDueKobo, receipt.currency)}</span>
              </div>
            )}
          </div>
        </div>

        {receipt.status === 'VOID' && receipt.voidReason && (
          <div className="mt-5 rounded-xl border border-[#B91C1C]/30 bg-[#FEF2F2] p-3.5 text-xs font-medium text-[#B91C1C]">
            VOID REASON: {receipt.voidReason}
            {receipt.voidedAt && (
              <span className="block mt-0.5 font-mono-num text-[11px] opacity-80">
                Voided on {formatLagosDateTime(receipt.voidedAt)}
              </span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-[#ECE6D8] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-[#5C635D]">
            <TallymarkEmblem className="w-4 h-4" strokeColor={brandColor} />
            <span>
              Issued via <strong className="text-[#121513]">Tallymark</strong> ·{' '}
              {formatLagosDateTime(receipt.issuedAt)}
            </span>
          </div>
          {qrUrl && (
            <img
              src={qrUrl}
              alt="Verify receipt QR code"
              className="h-14 w-14 rounded-lg border border-[#ECE6D8] bg-white p-0.5 shrink-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}
