import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  MessageCircle,
  Printer,
  Share2,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { downloadReceiptPdf } from '../lib/pdf';
import {
  formatKobo,
  formatKoboPlainInput,
  parseAmountToKobo,
} from '../shared/money';
import type { PaymentMethod, ReceiptTemplate } from '../shared/schemas';
import type { BusinessProfile, PublicReceiptRecord, ReceiptRecord } from '../shared/types';
import { NumericKeypad } from './NumericKeypad';
import { SpeechInput } from './SpeechInput';

export function buildPublicReceiptUrl(publicId: string): string {
  return `${window.location.origin}/r/${publicId}`;
}

export function buildWhatsAppMessage(receipt: PublicReceiptRecord): string {
  const url = buildPublicReceiptUrl(receipt.publicId);
  const amount = formatKobo(receipt.totalKobo, receipt.currency);
  const paid = formatKobo(receipt.amountPaidKobo, receipt.currency);
  const lines = [
    `Hello${receipt.customerName ? ` ${receipt.customerName}` : ''},`,
    `Here is your receipt *${receipt.receiptNumber}* from *${receipt.businessName}*.`,
    `Total: ${amount}`,
  ];
  if (receipt.balanceDueKobo > 0) {
    lines.push(`Paid: ${paid} · Balance due: ${formatKobo(receipt.balanceDueKobo, receipt.currency)}`);
  } else if (receipt.status === 'VOID') {
    lines.push(`Status: VOID`);
  } else {
    lines.push(`Status: Paid in full (${receipt.paymentMethod})`);
  }
  lines.push(`View or download your receipt: ${url}`);
  return lines.join('\n');
}

export function buildWhatsAppShareUrl(receipt: PublicReceiptRecord): string {
  const text = encodeURIComponent(buildWhatsAppMessage(receipt));
  const rawPhone = (receipt.customerPhone || '').replace(/[^\d+]/g, '');
  if (rawPhone) {
    let digits = rawPhone.replace(/\+/g, '');
    if (digits.startsWith('0') && digits.length === 11) {
      digits = `234${digits.slice(1)}`;
    }
    return `https://wa.me/${digits}?text=${text}`;
  }
  return `https://wa.me/?text=${text}`;
}

export function ReceiptShareBar({
  receipt,
  activeTemplate,
}: {
  receipt: PublicReceiptRecord;
  activeTemplate?: ReceiptTemplate;
}) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const publicUrl = buildPublicReceiptUrl(receipt.publicId);
  const canWebShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const handleDownloadPdf = async () => {
    setPdfBusy(true);
    setShareError(null);
    try {
      await downloadReceiptPdf(receipt, activeTemplate);
    } catch {
      setShareError('Could not generate PDF. Please try again.');
    } finally {
      setPdfBusy(false);
    }
  };

  const handleWebShare = async () => {
    if (!canWebShare) return;
    try {
      await navigator.share({
        title: `${receipt.receiptNumber} · ${receipt.businessName}`,
        text: buildWhatsAppMessage(receipt),
        url: publicUrl,
      });
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setShareError('Share cancelled or unavailable');
      }
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShareError('Copy failed — copy link from the address bar');
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={buildWhatsAppShareUrl(receipt)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl bg-[#064E3B] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#04392B] transition-colors min-h-[44px] whitespace-nowrap shrink-0"
        >
          <MessageCircle className="w-4 h-4" />
          <span>Share on WhatsApp</span>
        </a>

        {canWebShare && (
          <button
            type="button"
            onClick={handleWebShare}
            className="inline-flex items-center gap-2 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] px-3.5 py-2.5 text-xs font-medium text-[#121513] dark:text-[#F4F1EA] hover:bg-[#F3EFE6] dark:hover:bg-[#1D2621] transition-colors min-h-[44px] whitespace-nowrap shrink-0"
          >
            <Share2 className="w-4 h-4" />
            <span>Share</span>
          </button>
        )}

        <button
          type="button"
          onClick={handleDownloadPdf}
          disabled={pdfBusy}
          className="inline-flex items-center gap-2 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] px-3.5 py-2.5 text-xs font-medium text-[#121513] dark:text-[#F4F1EA] hover:bg-[#F3EFE6] dark:hover:bg-[#1D2621] transition-colors min-h-[44px] whitespace-nowrap shrink-0 disabled:opacity-60"
        >
          <Download className="w-4 h-4" />
          <span>{pdfBusy ? 'Preparing PDF…' : 'Download PDF'}</span>
        </button>

        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] px-3.5 py-2.5 text-xs font-medium text-[#121513] dark:text-[#F4F1EA] hover:bg-[#F3EFE6] dark:hover:bg-[#1D2621] transition-colors min-h-[44px] whitespace-nowrap shrink-0"
        >
          <Printer className="w-4 h-4" />
          <span>Print</span>
        </button>

        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-2 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] px-3.5 py-2.5 text-xs font-medium text-[#121513] dark:text-[#F4F1EA] hover:bg-[#F3EFE6] dark:hover:bg-[#1D2621] transition-colors min-h-[44px] whitespace-nowrap shrink-0"
        >
          {copied ? <Check className="w-4 h-4 text-[#064E3B] dark:text-[#10B981]" /> : <Copy className="w-4 h-4" />}
          <span>{copied ? 'Link copied' : 'Copy link'}</span>
        </button>
      </div>
      {shareError && <p className="text-xs text-[#B91C1C] dark:text-red-400">{shareError}</p>}
    </div>
  );
}

export function VoidReceiptModal({
  receipt,
  onClose,
  onVoided,
}: {
  receipt: ReceiptRecord;
  onClose: () => void;
  onVoided: (updated: ReceiptRecord) => void;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setError('Please enter a reason (at least 3 characters).');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.voidReceipt(receipt.id, reason.trim());
      onVoided(res.receipt);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Unable to void receipt');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4" role="dialog" aria-modal="true">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-[#E5DEC9] dark:border-[#26302B] bg-[#FAF8F3] dark:bg-[#151B18] p-6 shadow-2xl space-y-4"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="label-caps text-[#B91C1C]">Void Receipt</p>
            <h3 className="mt-1 font-display text-2xl text-[#121513] dark:text-[#F4F1EA]">
              Mark {receipt.receiptNumber} as VOID
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-xl border border-[#DED6C2] dark:border-[#2B352F]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-[#5C635D] dark:text-[#9BA39D]">
          Financial records are never deleted. Voiding keeps {receipt.receiptNumber} visibly stamped{' '}
          <strong className="text-[#121513] dark:text-[#F4F1EA]">VOID</strong> and posts an offsetting adjustment to your ledger.
        </p>

        <div>
          <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
            Reason for voiding
          </label>
          <SpeechInput
            value={reason}
            onChangeValue={setReason}
            placeholder="e.g. Wrong item price entered, re-issuing"
            required
          />
        </div>

        {error && <p className="text-xs text-[#B91C1C] dark:text-red-400">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-xl border border-[#DED6C2] dark:border-[#2B352F] px-4 py-2 text-sm font-medium text-[#5C635D] dark:text-[#9BA39D]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="min-h-[44px] rounded-xl bg-[#B91C1C] px-5 py-2 text-sm font-semibold text-white hover:bg-[#991B1B] disabled:opacity-60"
          >
            {submitting ? 'Voiding…' : 'Confirm Void'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function ReceiveBalanceModal({
  receipt,
  business,
  onClose,
  onRecorded,
}: {
  receipt: ReceiptRecord;
  business: BusinessProfile;
  onClose: () => void;
  onRecorded: (childReceipt: ReceiptRecord, updatedParent: ReceiptRecord) => void;
}) {
  const [amountInput, setAmountInput] = useState(() =>
    formatKoboPlainInput(receipt.balanceDueKobo)
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Transfer');
  const [soldBy, setSoldBy] = useState(receipt.soldBy || '');
  const [note, setNote] = useState('');
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !keypadOpen) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, keypadOpen]);

  const amountKobo = parseAmountToKobo(amountInput);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amountKobo <= 0) {
      setError('Enter a payment amount greater than zero.');
      return;
    }
    if (amountKobo > receipt.balanceDueKobo) {
      setError(`Amount cannot exceed balance due (${formatKobo(receipt.balanceDueKobo, business.currency)}).`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.receiveBalance(receipt.id, {
        amountKobo,
        paymentMethod,
        soldBy,
        note,
      });
      onRecorded(res.receipt, res.parentReceipt);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Unable to record balance payment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4" role="dialog" aria-modal="true">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-[#E5DEC9] dark:border-[#26302B] bg-[#FAF8F3] dark:bg-[#151B18] p-6 shadow-2xl space-y-4"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="label-caps text-[#064E3B] dark:text-[#10B981]">Receive Balance</p>
            <h3 className="mt-1 font-display text-2xl text-[#121513] dark:text-[#F4F1EA]">
              Payment for {receipt.receiptNumber}
            </h3>
            <p className="mt-0.5 text-xs text-[#5C635D] dark:text-[#9BA39D]">
              Balance due:{' '}
              <span className="font-mono-num font-semibold text-[#121513] dark:text-[#F4F1EA]">
                {formatKobo(receipt.balanceDueKobo, business.currency)}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-xl border border-[#DED6C2] dark:border-[#2B352F]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Amount received</label>
            <button
              type="button"
              onClick={() => setAmountInput(formatKoboPlainInput(receipt.balanceDueKobo))}
              className="text-xs font-medium text-[#064E3B] dark:text-[#10B981] hover:underline"
            >
              Full balance
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 font-mono-num text-base font-semibold text-[#121513] dark:text-[#F4F1EA] min-h-[44px]"
            />
            <button
              type="button"
              onClick={() => setKeypadOpen(true)}
              className="shrink-0 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3 text-xs font-medium text-[#121513] dark:text-[#F4F1EA] min-h-[44px]"
            >
              Keypad
            </button>
          </div>
        </div>

        <div>
          <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
            Payment Method
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['Cash', 'Transfer', 'POS', 'Card', 'Other'] as PaymentMethod[]).map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => setPaymentMethod(method)}
                className={`min-h-[40px] rounded-xl border text-xs font-medium transition-colors ${
                  paymentMethod === method
                    ? 'border-[#064E3B] bg-[#064E3B] text-white'
                    : 'border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] text-[#121513] dark:text-[#F4F1EA]'
                }`}
              >
                {method}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
              Received by
            </label>
            <SpeechInput value={soldBy} onChangeValue={setSoldBy} placeholder="Staff name (optional)" />
          </div>
          <div>
            <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
              Note
            </label>
            <SpeechInput value={note} onChangeValue={setNote} placeholder="Optional note" />
          </div>
        </div>

        {error && <p className="text-xs text-[#B91C1C] dark:text-red-400">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-xl border border-[#DED6C2] dark:border-[#2B352F] px-4 py-2 text-sm font-medium text-[#5C635D] dark:text-[#9BA39D]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="min-h-[44px] rounded-xl bg-[#064E3B] px-5 py-2 text-sm font-semibold text-white hover:bg-[#04392B] disabled:opacity-60"
          >
            {submitting ? 'Issuing receipt…' : 'Issue Balance Receipt'}
          </button>
        </div>

        <NumericKeypad
          open={keypadOpen}
          title="Balance amount received"
          initialValue={amountInput}
          mode="currency"
          currency={business.currency}
          onApply={setAmountInput}
          onClose={() => setKeypadOpen(false)}
        />
      </form>
    </div>
  );
}
