import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  MessageCircle,
  Printer,
  QrCode,
  Share2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { downloadReceiptPdf } from '../lib/pdf';
import { Link } from '../lib/router';
import {
  formatKobo,
  formatKoboPlainInput,
  parseAmountToKobo,
} from '../shared/money';
import { sanitizeRasterImageDataUrl, type PaymentMethod, type ReceiptTemplate } from '../shared/schemas';
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

export function ReceiptQrModal({
  receipt,
  onClose,
}: {
  receipt: PublicReceiptRecord;
  onClose: () => void;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const publicUrl = buildPublicReceiptUrl(receipt.publicId);
  const hasSignature = Boolean(sanitizeRasterImageDataUrl(receipt.businessSignatureDataUrl));

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(publicUrl, {
      width: 480,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#111827', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [publicUrl]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleDownloadQr = () => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `${receipt.receiptNumber.replace(/[^A-Za-z0-9_-]/g, '_')}-verify-qr.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Verification QR code for ${receipt.receiptNumber}`}
    >
      <div className="w-full max-w-sm rounded-[24px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-[#064E3B] dark:text-[#6EE7B7]">Receipt Verification QR</p>
            <h3 className="mt-1 font-display text-2xl font-semibold text-[#111827] dark:text-[#F3F4F6]">
              {receipt.receiptNumber}
            </h3>
            <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              {receipt.businessName} ·{' '}
              {receipt.status === 'VOID'
                ? 'Voided'
                : receipt.status === 'PART_PAID'
                ? 'Part Paid'
                : 'Paid in Full'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-[10px] border border-gray-200 dark:border-[#232D29]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="rounded-[20px] border border-gray-200/70 dark:border-[#232D29] bg-white p-5 flex flex-col items-center gap-3">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`Scan to verify receipt ${receipt.receiptNumber}`}
              className="w-56 h-56 rounded-lg"
            />
          ) : (
            <div className="w-56 h-56 rounded-lg bg-[#F4F6F8] animate-pulse" />
          )}
          <p className="text-xs text-center text-[#6B7280]">
            Scan with any phone camera to open the live verification page for this receipt.
          </p>
          {hasSignature && receipt.status !== 'VOID' && (
            <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#064E3B]">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Authenticated with issuer signature</span>
            </div>
          )}
        </div>

        <div className="rounded-[10px] border border-gray-200/70 dark:border-[#232D29] bg-white dark:bg-[#111715] px-3 py-2 flex items-center justify-between gap-2">
          <span className="font-mono-num text-[11px] text-[#6B7280] dark:text-[#9CA3AF] truncate">
            {publicUrl}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 text-xs font-semibold text-[#064E3B] dark:text-[#6EE7B7] hover:underline"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleDownloadQr}
            disabled={!qrDataUrl}
            className="inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-[#064E3B] px-3.5 py-2.5 text-xs font-semibold text-white hover:bg-[#04392B] min-h-[44px] disabled:opacity-60"
          >
            <Download className="w-4 h-4" />
            <span>Download QR</span>
          </button>
          <Link
            to={`/r/${receipt.publicId}`}
            onClick={onClose}
            className="inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] px-3.5 py-2.5 text-xs font-semibold text-[#111827] dark:text-[#F3F4F6] hover:bg-[#F4F6F8] dark:hover:bg-[#1A221F] min-h-[44px]"
          >
            <ExternalLink className="w-4 h-4" />
            <span>Open Page</span>
          </Link>
        </div>
      </div>
    </div>
  );
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
  const [qrOpen, setQrOpen] = useState(false);
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
          className="inline-flex items-center gap-2 rounded-[10px] bg-[#064E3B] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#04392B] transition-colors min-h-[44px] whitespace-nowrap shrink-0"
        >
          <MessageCircle className="w-4 h-4" />
          <span>Share on WhatsApp</span>
        </a>

        {canWebShare && (
          <button
            type="button"
            onClick={handleWebShare}
            className="inline-flex items-center gap-2 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3.5 py-2.5 text-xs font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-[#F4F6F8] dark:hover:bg-[#1A221F] transition-colors min-h-[44px] whitespace-nowrap shrink-0"
          >
            <Share2 className="w-4 h-4" />
            <span>Share</span>
          </button>
        )}

        <button
          type="button"
          onClick={handleDownloadPdf}
          disabled={pdfBusy}
          className="inline-flex items-center gap-2 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3.5 py-2.5 text-xs font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-[#F4F6F8] dark:hover:bg-[#1A221F] transition-colors min-h-[44px] whitespace-nowrap shrink-0 disabled:opacity-60"
        >
          <Download className="w-4 h-4" />
          <span>{pdfBusy ? 'Preparing PDF…' : 'Download PDF'}</span>
        </button>

        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3.5 py-2.5 text-xs font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-[#F4F6F8] dark:hover:bg-[#1A221F] transition-colors min-h-[44px] whitespace-nowrap shrink-0"
        >
          <Printer className="w-4 h-4" />
          <span>Print</span>
        </button>

        <button
          type="button"
          onClick={() => setQrOpen(true)}
          className="inline-flex items-center gap-2 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3.5 py-2.5 text-xs font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-[#F4F6F8] dark:hover:bg-[#1A221F] transition-colors min-h-[44px] whitespace-nowrap shrink-0"
        >
          <QrCode className="w-4 h-4 text-[#064E3B] dark:text-[#6EE7B7]" />
          <span>Verify QR</span>
        </button>

        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-2 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3.5 py-2.5 text-xs font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-[#F4F6F8] dark:hover:bg-[#1A221F] transition-colors min-h-[44px] whitespace-nowrap shrink-0"
        >
          {copied ? <Check className="w-4 h-4 text-[#064E3B] dark:text-[#6EE7B7]" /> : <Copy className="w-4 h-4" />}
          <span>{copied ? 'Link copied' : 'Copy link'}</span>
        </button>
      </div>
      {shareError && <p className="text-xs text-[#B91C1C] dark:text-red-400">{shareError}</p>}
      {qrOpen && <ReceiptQrModal receipt={receipt} onClose={() => setQrOpen(false)} />}
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
        className="w-full max-w-md rounded-[24px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-6 shadow-2xl space-y-4"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#B91C1C]">Void Receipt</p>
            <h3 className="mt-1 font-display text-2xl font-semibold text-[#111827] dark:text-[#F3F4F6]">
              Mark {receipt.receiptNumber} as VOID
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-[10px] border border-gray-200 dark:border-[#232D29]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF]">
          Financial records are never deleted. Voiding keeps {receipt.receiptNumber} visibly stamped{' '}
          <strong className="text-[#111827] dark:text-[#F3F4F6]">VOID</strong> and posts an offsetting adjustment to your ledger.
        </p>

        <div>
          <label className="block label-caps text-[#6B7280] dark:text-[#9CA3AF] mb-1.5">
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
            className="min-h-[44px] rounded-[10px] border border-gray-200 dark:border-[#232D29] px-4 py-2 text-sm font-medium text-[#6B7280] dark:text-[#9CA3AF]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="min-h-[44px] rounded-[10px] bg-[#B91C1C] px-5 py-2 text-sm font-semibold text-white hover:bg-[#991B1B] disabled:opacity-60"
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
        className="w-full max-w-md rounded-[24px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-6 shadow-2xl space-y-4"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#064E3B] dark:text-[#6EE7B7]">Receive Balance</p>
            <h3 className="mt-1 font-display text-2xl font-semibold text-[#111827] dark:text-[#F3F4F6]">
              Payment for {receipt.receiptNumber}
            </h3>
            <p className="mt-0.5 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              Balance due:{' '}
              <span className="font-mono-num font-semibold text-[#111827] dark:text-[#F3F4F6]">
                {formatKobo(receipt.balanceDueKobo, business.currency)}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-[10px] border border-gray-200 dark:border-[#232D29]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="label-caps text-[#6B7280] dark:text-[#9CA3AF]">Amount received</label>
            <button
              type="button"
              onClick={() => setAmountInput(formatKoboPlainInput(receipt.balanceDueKobo))}
              className="text-xs font-medium text-[#064E3B] dark:text-[#6EE7B7] hover:underline"
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
              className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] px-3.5 py-2.5 font-mono-num text-base font-semibold text-[#111827] dark:text-[#F3F4F6] min-h-[44px]"
            />
            <button
              type="button"
              onClick={() => setKeypadOpen(true)}
              className="shrink-0 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] px-3 text-xs font-medium text-[#111827] dark:text-[#F3F4F6] min-h-[44px]"
            >
              Keypad
            </button>
          </div>
        </div>

        <div>
          <label className="block label-caps text-[#6B7280] dark:text-[#9CA3AF] mb-1.5">
            Payment Method
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['Cash', 'Transfer', 'POS', 'Card', 'Other'] as PaymentMethod[]).map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => setPaymentMethod(method)}
                className={`min-h-[40px] rounded-[10px] border text-xs font-medium transition-colors ${
                  paymentMethod === method
                    ? 'border-[#064E3B] bg-[#064E3B] text-white'
                    : 'border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] text-[#111827] dark:text-[#F3F4F6]'
                }`}
              >
                {method}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block label-caps text-[#6B7280] dark:text-[#9CA3AF] mb-1.5">
              Received by
            </label>
            <SpeechInput value={soldBy} onChangeValue={setSoldBy} placeholder="Staff name (optional)" />
          </div>
          <div>
            <label className="block label-caps text-[#6B7280] dark:text-[#9CA3AF] mb-1.5">
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
            className="min-h-[44px] rounded-[10px] border border-gray-200 dark:border-[#232D29] px-4 py-2 text-sm font-medium text-[#6B7280] dark:text-[#9CA3AF]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="min-h-[44px] rounded-[10px] bg-[#064E3B] px-5 py-2 text-sm font-semibold text-white hover:bg-[#04392B] disabled:opacity-60"
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
