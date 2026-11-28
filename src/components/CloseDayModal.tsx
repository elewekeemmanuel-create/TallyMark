import React, { useEffect, useState } from 'react';
import { CheckCircle2, Download, Lock, MessageCircle, X } from 'lucide-react';
import { api } from '../lib/api';
import { downloadDailySummaryPdf } from '../lib/pdf';
import { calculateCloseDayVariance } from '../shared/cashbook';
import {
  formatKobo,
  formatKoboPlainInput,
  formatLagosDateOnly,
  parseAmountToKobo,
} from '../shared/money';
import type { PaymentMethod } from '../shared/schemas';
import type { BusinessProfile, CashBookDayView } from '../shared/types';
import { NumericKeypad } from './NumericKeypad';
import { SpeechInput } from './SpeechInput';

export function buildDailySummaryWhatsAppUrl(business: BusinessProfile, dv: CashBookDayView): string {
  const totalSales = dv.receiptSalesKobo + dv.quickSalesKobo + dv.creditSalesGivenKobo;
  const lines = [
    `*${business.name}* — Daily Cash Book (${formatLagosDateOnly(dv.date)})`,
    `Opening Cash: ${formatKobo(dv.openingCashKobo, business.currency)}`,
    `Sales: ${formatKobo(totalSales, business.currency)} (Receipts ${formatKobo(dv.receiptSalesKobo, business.currency)} · Quick ${formatKobo(dv.quickSalesKobo, business.currency)} · Credit ${formatKobo(dv.creditSalesGivenKobo, business.currency)})`,
    `Debt Payments Received: ${formatKobo(dv.paymentsReceivedKobo, business.currency)}`,
    `Money In: ${formatKobo(dv.moneyInTotalKobo, business.currency)}`,
    `Expenses (Money Out): ${formatKobo(dv.moneyOutTotalKobo, business.currency)}`,
    `Net (money in minus money out): ${formatKobo(dv.netKobo, business.currency)}`,
    `Expected Cash in Hand: ${formatKobo(dv.closingCashInHandKobo, business.currency)}`,
  ];
  if (dv.closure) {
    const sign = dv.closure.varianceKobo >= 0 ? '+' : '-';
    lines.push(`Counted Cash: ${formatKobo(dv.closure.countedCashKobo, business.currency)}`);
    lines.push(
      `Over/Short: ${dv.closure.varianceKobo === 0 ? 'Balanced (0)' : `${sign}${formatKobo(Math.abs(dv.closure.varianceKobo), business.currency)}`}`
    );
  }
  return `https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`;
}

export function CloseDayModal({
  business,
  dayView: initialDayView,
  onClose,
  onClosed,
}: {
  business: BusinessProfile;
  dayView: CashBookDayView;
  onClose: () => void;
  onClosed: (updated: CashBookDayView) => void;
}) {
  const [dayView, setDayView] = useState<CashBookDayView>(initialDayView);
  const [countedInput, setCountedInput] = useState(() =>
    formatKoboPlainInput(Math.max(0, initialDayView.closingCashInHandKobo))
  );
  const [note, setNote] = useState('');
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !keypadOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, keypadOpen]);

  const countedCashKobo = parseAmountToKobo(countedInput || '0');
  const expectedCashKobo = dayView.closingCashInHandKobo;
  const varianceKobo = calculateCloseDayVariance(expectedCashKobo, countedCashKobo);
  const totalSalesKobo =
    dayView.receiptSalesKobo + dayView.quickSalesKobo + dayView.creditSalesGivenKobo;

  const handleCloseDay = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.closeDay({
        closeDate: dayView.date,
        countedCashKobo,
        note: note.trim(),
      });
      setDayView(res.dayView);
      onClosed(res.dayView);
    } catch (err: any) {
      setError(err?.message || 'Unable to close this day');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadPdf = async () => {
    setPdfBusy(true);
    setError(null);
    try {
      await downloadDailySummaryPdf(business, dayView);
    } catch {
      setError('Unable to generate Daily Summary PDF');
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Close the day"
    >
      <div className="w-full max-w-lg rounded-[24px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-6 shadow-2xl space-y-5 my-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#064E3B] dark:text-[#6EE7B7]">
              {dayView.isClosed ? 'Daily Summary' : 'Close the Day'}
            </p>
            <h3 className="mt-1 font-display text-2xl font-semibold text-[#111827] dark:text-[#F3F4F6]">
              {formatLagosDateOnly(dayView.date)}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-[10px] border border-gray-200 dark:border-[#232D29] hover:bg-[#F6F7F8] dark:hover:bg-[#1A221F]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Summary breakdown */}
        <div className="rounded-[16px] border border-gray-200/70 dark:border-[#1F2925] bg-[#F6F7F8] dark:bg-[#0B0F0E] p-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
            <span>Opening Cash</span>
            <span className="font-mono-num">{formatKobo(dayView.openingCashKobo, business.currency)}</span>
          </div>
          <div className="flex justify-between gap-4 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
            <span>Receipt Sales (received)</span>
            <span className="font-mono-num">{formatKobo(dayView.receiptSalesKobo, business.currency)}</span>
          </div>
          <div className="flex justify-between gap-4 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
            <span>Quick Sales (without receipt)</span>
            <span className="font-mono-num">{formatKobo(dayView.quickSalesKobo, business.currency)}</span>
          </div>
          <div className="flex justify-between gap-4 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
            <span>Debt Payments Received</span>
            <span className="font-mono-num">{formatKobo(dayView.paymentsReceivedKobo, business.currency)}</span>
          </div>
          <div className="flex justify-between gap-4 text-xs text-[#B45309] dark:text-amber-400">
            <span>New Credit Given (owed)</span>
            <span className="font-mono-num">{formatKobo(dayView.creditSalesGivenKobo, business.currency)}</span>
          </div>
          <div className="pt-2 border-t border-gray-100 dark:border-[#1F2925] flex justify-between gap-4 font-semibold">
            <span>Total Sales Value</span>
            <span className="font-mono-num">{formatKobo(totalSalesKobo, business.currency)}</span>
          </div>
          <div className="flex justify-between gap-4 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
            <span>Expenses (Money Out)</span>
            <span className="font-mono-num text-[#B91C1C] dark:text-red-400">
              -{formatKobo(dayView.moneyOutTotalKobo, business.currency)}
            </span>
          </div>
          <div className="flex justify-between gap-4 font-semibold">
            <span>Net (money in minus money out)</span>
            <span className="font-mono-num text-[#064E3B] dark:text-[#6EE7B7]">
              {formatKobo(dayView.netKobo, business.currency)}
            </span>
          </div>
          <div className="pt-2 border-t border-gray-100 dark:border-[#1F2925] flex justify-between gap-4 font-semibold">
            <span>Expected Cash in Hand</span>
            <span className="font-mono-num">{formatKobo(expectedCashKobo, business.currency)}</span>
          </div>
        </div>

        {dayView.isClosed && dayView.closure ? (
          <div className="space-y-4">
            <div className="rounded-[10px] border border-[#064E3B]/30 dark:border-[#10B981]/30 bg-[#064E3B]/5 dark:bg-[#10B981]/10 p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#064E3B] dark:text-[#6EE7B7]">
                <Lock className="w-4 h-4" />
                <span>Day Locked &amp; Closed</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Actual Cash Counted</span>
                <span className="font-mono-num font-semibold">
                  {formatKobo(dayView.closure.countedCashKobo, business.currency)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Over / Short Difference</span>
                <span
                  className={`font-mono-num font-semibold ${
                    dayView.closure.varianceKobo === 0
                      ? 'text-[#064E3B] dark:text-[#6EE7B7]'
                      : dayView.closure.varianceKobo > 0
                      ? 'text-[#064E3B] dark:text-[#6EE7B7]'
                      : 'text-[#B91C1C] dark:text-red-400'
                  }`}
                >
                  {dayView.closure.varianceKobo === 0
                    ? 'Balanced (₦0.00)'
                    : `${dayView.closure.varianceKobo > 0 ? 'Over +' : 'Short -'}${formatKobo(
                        Math.abs(dayView.closure.varianceKobo),
                        business.currency
                      )}`}
                </span>
              </div>
              {dayView.closure.note && (
                <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                  Note: {dayView.closure.note}
                </p>
              )}
            </div>

            {error && <p className="text-xs text-[#B91C1C] dark:text-red-400">{error}</p>}

            <div className="flex flex-wrap items-center gap-2">
              <a
                href={buildDailySummaryWhatsAppUrl(business, dayView)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-[10px] bg-[#064E3B] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#04392B]"
              >
                <MessageCircle className="w-4 h-4" />
                <span>Share on WhatsApp</span>
              </a>
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={pdfBusy}
                className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] px-4 py-2.5 text-xs font-semibold"
              >
                <Download className="w-4 h-4" />
                <span>{pdfBusy ? 'Preparing PDF…' : 'Download Summary PDF'}</span>
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleCloseDay} className="space-y-4">
            <div>
              <label className="block label-caps text-[#6B7280] dark:text-[#9CA3AF] mb-1.5">
                Cash Actually Counted in Drawer
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={countedInput}
                  onChange={(e) => setCountedInput(e.target.value)}
                  className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] px-3.5 py-2.5 font-mono-num text-base font-semibold min-h-[44px]"
                  required
                />
                <button
                  type="button"
                  onClick={() => setKeypadOpen(true)}
                  className="shrink-0 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] px-3 text-xs font-medium min-h-[44px]"
                >
                  Keypad
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs rounded-lg bg-[#F4F6F8] dark:bg-[#1A221F] px-3 py-2">
                <span className="text-[#6B7280] dark:text-[#9CA3AF]">Cash Over / Short</span>
                <span
                  className={`font-mono-num font-semibold ${
                    varianceKobo === 0
                      ? 'text-[#064E3B] dark:text-[#6EE7B7]'
                      : varianceKobo > 0
                      ? 'text-[#064E3B] dark:text-[#6EE7B7]'
                      : 'text-[#B91C1C] dark:text-red-400'
                  }`}
                >
                  {varianceKobo === 0
                    ? 'Exact match (0)'
                    : `${varianceKobo > 0 ? 'Over +' : 'Short -'}${formatKobo(
                        Math.abs(varianceKobo),
                        business.currency
                      )}`}
                </span>
              </div>
            </div>

            <div>
              <label className="block label-caps text-[#6B7280] dark:text-[#9CA3AF] mb-1.5">
                Note (optional — e.g. reason for shortage)
              </label>
              <SpeechInput
                value={note}
                onChangeValue={setNote}
                placeholder="Optional note on drawer count"
              />
            </div>

            <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              Closing locks {formatLagosDateOnly(dayView.date)} in the database. Any later changes must be logged as a visible correction entry.
            </p>

            {error && <p className="text-xs text-[#B91C1C] dark:text-red-400">{error}</p>}

            <div className="flex items-center justify-end gap-2">
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
                className="min-h-[44px] inline-flex items-center gap-2 rounded-[10px] bg-[#064E3B] px-5 py-2 text-sm font-semibold text-white hover:bg-[#04392B] disabled:opacity-60"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{submitting ? 'Closing…' : 'Lock & Close Day'}</span>
              </button>
            </div>
          </form>
        )}

        <NumericKeypad
          open={keypadOpen}
          title="Actual cash counted"
          initialValue={countedInput}
          mode="currency"
          currency={business.currency}
          onApply={setCountedInput}
          onClose={() => setKeypadOpen(false)}
        />
      </div>
    </div>
  );
}

export function CorrectionEntryModal({
  business,
  defaultDate,
  defaultExpenseId = null,
  onClose,
  onCreated,
}: {
  business: BusinessProfile;
  defaultDate: string;
  defaultExpenseId?: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [entryDate, setEntryDate] = useState(defaultDate);
  const [direction, setDirection] = useState<'IN' | 'OUT'>('OUT');
  const [amountInput, setAmountInput] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [reason, setReason] = useState('');
  const [soldBy, setSoldBy] = useState('');
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !keypadOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, keypadOpen]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountKobo = parseAmountToKobo(amountInput || '0');
    if (amountKobo <= 0) {
      setError('Enter a correction amount greater than zero.');
      return;
    }
    if (reason.trim().length < 3) {
      setError('Please state a clear reason (at least 3 characters).');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.postCorrectionEntry({
        entryDate,
        direction,
        amountKobo,
        paymentMethod,
        reason: reason.trim(),
        soldBy: soldBy.trim(),
        expenseId: defaultExpenseId,
      });
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Unable to post correction entry');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Post visible correction entry"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-[24px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-6 shadow-2xl space-y-4"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#B45309] dark:text-amber-400">Visible Audit Correction</p>
            <h3 className="mt-1 font-display text-2xl font-semibold">Post Correction Entry</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-[10px] border border-gray-200 dark:border-[#232D29] hover:bg-[#F6F7F8] dark:hover:bg-[#1A221F]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDirection('IN')}
            className={`min-h-[42px] rounded-[10px] border text-xs font-semibold ${
              direction === 'IN'
                ? 'border-[#064E3B] bg-[#064E3B] text-white'
                : 'border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715]'
            }`}
          >
            Money In (+)
          </button>
          <button
            type="button"
            onClick={() => setDirection('OUT')}
            className={`min-h-[42px] rounded-[10px] border text-xs font-semibold ${
              direction === 'OUT'
                ? 'border-[#B91C1C] bg-[#B91C1C] text-white'
                : 'border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715]'
            }`}
          >
            Money Out (−)
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block label-caps text-[#6B7280] dark:text-[#9CA3AF] mb-1.5">
              Date
            </label>
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] px-3 py-2 text-sm min-h-[44px]"
              required
            />
          </div>
          <div>
            <label className="block label-caps text-[#6B7280] dark:text-[#9CA3AF] mb-1.5">
              Amount
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                inputMode="decimal"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] px-3 py-2 font-mono-num text-sm font-semibold min-h-[44px]"
                required
              />
              <button
                type="button"
                onClick={() => setKeypadOpen(true)}
                className="shrink-0 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] px-2.5 text-xs font-medium min-h-[44px]"
              >
                Pad
              </button>
            </div>
          </div>
        </div>

        <div>
          <label className="block label-caps text-[#6B7280] dark:text-[#9CA3AF] mb-1.5">
            Payment Method
          </label>
          <div className="grid grid-cols-5 gap-1.5">
            {(['Cash', 'Transfer', 'POS', 'Card', 'Other'] as PaymentMethod[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPaymentMethod(m)}
                className={`min-h-[38px] rounded-[10px] border text-xs font-medium ${
                  paymentMethod === m
                    ? 'border-[#064E3B] bg-[#064E3B] text-white'
                    : 'border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715]'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block label-caps text-[#6B7280] dark:text-[#9CA3AF] mb-1.5">
            Reason for correction *
          </label>
          <SpeechInput
            value={reason}
            onChangeValue={setReason}
            placeholder="e.g. Missed transport expense after closing"
            required
          />
        </div>

        <div>
          <label className="block label-caps text-[#6B7280] dark:text-[#9CA3AF] mb-1.5">
            Logged by (optional)
          </label>
          <SpeechInput value={soldBy} onChangeValue={setSoldBy} placeholder="Staff or owner name" />
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
            {submitting ? 'Posting…' : 'Post Correction'}
          </button>
        </div>

        <NumericKeypad
          open={keypadOpen}
          title="Correction amount"
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
