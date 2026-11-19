import React, { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, FileText, Zap } from 'lucide-react';
import { NumericKeypad } from '../components/NumericKeypad';
import { SpeechInput } from '../components/SpeechInput';
import { api } from '../lib/api';
import { Link, useRouter } from '../lib/router';
import { formatKobo, getLagosDateString, parseAmountToKobo } from '../shared/money';
import type { PaymentMethod } from '../shared/schemas';
import type {
  BusinessProfile,
  CustomerSuggestion,
  LedgerEntryRecord,
  ReceiptRecord,
} from '../shared/types';

const QUICK_AMOUNTS = [1000, 2000, 5000, 10000, 20000];

export function QuickSalePage({ business }: { business: BusinessProfile }) {
  const { navigate } = useRouter();
  const draftKey = `tallymark_quicksale_draft_${business.id}`;
  const [amountInput, setAmountInput] = useState('');
  const [note, setNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [soldBy, setSoldBy] = useState('');
  const [entryDate, setEntryDate] = useState(() => getLagosDateString());
  const [customers, setCustomers] = useState<CustomerSuggestion[]>([]);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [issuingReceipt, setIssuingReceipt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedEntry, setSavedEntry] = useState<LedgerEntryRecord | null>(null);
  const [issuedReceipt, setIssuedReceipt] = useState<ReceiptRecord | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          if (parsed.amountInput) setAmountInput(String(parsed.amountInput));
          if (parsed.note) setNote(String(parsed.note));
          if (parsed.paymentMethod) setPaymentMethod(parsed.paymentMethod);
          if (parsed.customerName) setCustomerName(String(parsed.customerName));
          if (parsed.customerPhone) setCustomerPhone(String(parsed.customerPhone));
          if (parsed.soldBy) setSoldBy(String(parsed.soldBy));
        }
      }
    } catch {
      // ignore storage errors
    }
  }, [draftKey]);

  useEffect(() => {
    if (savedEntry) return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          amountInput,
          note,
          paymentMethod,
          customerName,
          customerPhone,
          soldBy,
        })
      );
    } catch {
      // ignore storage errors
    }
  }, [draftKey, savedEntry, amountInput, note, paymentMethod, customerName, customerPhone, soldBy]);

  useEffect(() => {
    api
      .getSuggestions()
      .then((s) => setCustomers(s.customers || []))
      .catch(() => {});
  }, []);

  const amountKobo = parseAmountToKobo(amountInput || '0');

  const handleCustomerChange = (val: string) => {
    setCustomerName(val);
    const match = customers.find((c) => c.name.toLowerCase() === val.trim().toLowerCase());
    if (match && match.phone && !customerPhone) {
      setCustomerPhone(match.phone);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (amountKobo <= 0) {
      setError('Enter a sale amount greater than zero.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.createQuickSale({
        amountKobo,
        note: note.trim(),
        paymentMethod,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        soldBy: soldBy.trim(),
        entryDate,
        source: 'quick_sale',
      });
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // ignore
      }
      setSavedEntry(res.entry);
      setIssuedReceipt(null);
    } catch (err: any) {
      setError(err?.message || 'Unable to record quick sale');
    } finally {
      setSubmitting(false);
    }
  };

  const handleIssueReceiptLater = async () => {
    if (!savedEntry) return;
    setIssuingReceipt(true);
    setError(null);
    try {
      const res = await api.issueReceiptFromQuickSale(savedEntry.id);
      setIssuedReceipt(res.receipt);
    } catch (err: any) {
      setError(err?.message || 'Unable to issue receipt from this sale');
    } finally {
      setIssuingReceipt(false);
    }
  };

  const resetForm = () => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
    setSavedEntry(null);
    setIssuedReceipt(null);
    setAmountInput('');
    setNote('');
    setCustomerName('');
    setCustomerPhone('');
    setError(null);
  };

  if (savedEntry) {
    return (
      <div className="max-w-lg mx-auto rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-6 sm:p-8 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#064E3B]/10 dark:bg-[#10B981]/15 text-[#064E3B] dark:text-[#10B981] flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <p className="label-caps text-[#064E3B] dark:text-[#10B981]">Quick Sale Recorded</p>
            <h1 className="mt-1 font-display text-3xl text-[#121513] dark:text-[#F4F1EA]">
              {formatKobo(savedEntry.amountKobo, business.currency)}
            </h1>
            <p className="mt-1 text-xs text-[#5C635D] dark:text-[#9BA39D]">
              {savedEntry.paymentMethod} · {savedEntry.entryDate}
              {savedEntry.note ? ` · ${savedEntry.note}` : ''}
            </p>
          </div>
        </div>

        {issuedReceipt ? (
          <div className="rounded-xl border border-[#064E3B]/30 bg-[#064E3B]/5 dark:bg-[#10B981]/10 p-4 space-y-2">
            <p className="text-xs font-semibold text-[#064E3B] dark:text-[#10B981]">
              Official Receipt Issued: {issuedReceipt.receiptNumber}
            </p>
            <p className="text-xs text-[#5C635D] dark:text-[#9BA39D]">
              Linked to your Cash Book entry without double-counting sales.
            </p>
            <button
              type="button"
              onClick={() => navigate(`/app/receipts/${issuedReceipt.id}`)}
              className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-[#064E3B] dark:text-[#10B981] hover:underline"
            >
              <span>Open Receipt &amp; Share</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleIssueReceiptLater}
            disabled={issuingReceipt}
            className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl border border-[#064E3B] dark:border-[#10B981] px-4 py-2.5 text-sm font-semibold text-[#064E3B] dark:text-[#10B981] hover:bg-[#064E3B] hover:text-white dark:hover:bg-[#10B981] dark:hover:text-[#0D110F] transition-colors disabled:opacity-60"
          >
            <FileText className="w-4 h-4" />
            <span>{issuingReceipt ? 'Issuing receipt…' : 'Issue Receipt for This Sale'}</span>
          </button>
        )}

        {error && <p className="text-xs text-[#B91C1C] dark:text-red-400">{error}</p>}

        <div className="grid grid-cols-2 gap-3 pt-2">
          <button
            type="button"
            onClick={resetForm}
            className="min-h-[46px] rounded-xl bg-[#064E3B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#04392B]"
          >
            Record Another
          </button>
          <Link
            to="/app/cashbook"
            className="min-h-[46px] rounded-xl border border-[#DED6C2] dark:border-[#2B352F] px-4 py-2.5 text-sm font-medium inline-flex items-center justify-center"
          >
            View Cash Book
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#064E3B] dark:text-[#10B981]">
          <Zap className="w-3.5 h-3.5" />
          <span>5-Second Entry · No Receipt Needed</span>
        </div>
        <h1 className="mt-1 font-display text-3xl text-[#121513] dark:text-[#F4F1EA]">
          Quick Sale
        </h1>
        <p className="text-sm text-[#5C635D] dark:text-[#9BA39D]">
          Log fast over-the-counter cash, transfer, or POS sales directly into your Cash Book. You can still issue a receipt from the entry later.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-5 sm:p-6 space-y-5"
      >
        <div>
          <label htmlFor="qs-amount" className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
            Sale Amount ({business.currency}) *
          </label>
          <div className="flex gap-2">
            <input
              id="qs-amount"
              type="text"
              inputMode="decimal"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="0.00"
              autoFocus
              className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#111714] px-4 py-3 font-mono-num text-2xl font-semibold text-[#121513] dark:text-[#F4F1EA] min-h-[54px]"
              required
            />
            <button
              type="button"
              onClick={() => setKeypadOpen(true)}
              className="shrink-0 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-4 text-xs font-semibold min-h-[54px]"
            >
              Keypad
            </button>
          </div>

          <div className="mt-2.5 flex flex-wrap gap-2">
            {QUICK_AMOUNTS.map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => setAmountInput(String(amt))}
                className="min-h-[36px] rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#111714] px-3 font-mono-num text-xs font-medium hover:bg-[#EAE3D3] dark:hover:bg-[#1E2722]"
              >
                {formatKobo(amt * 100, business.currency)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
            Payment Method *
          </label>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {(['Cash', 'Transfer', 'POS', 'Card', 'Other'] as PaymentMethod[]).map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => setPaymentMethod(method)}
                className={`min-h-[44px] rounded-xl border text-xs font-semibold transition-colors ${
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

        <div>
          <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
            What was sold? (optional)
          </label>
          <SpeechInput
            value={note}
            onChangeValue={setNote}
            placeholder="e.g. 2 bags of cement, Ankara yardage"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
              Customer (optional)
            </label>
            <SpeechInput
              value={customerName}
              onChangeValue={handleCustomerChange}
              list="qs-customer-suggestions"
              placeholder="Walk-in customer"
            />
            <datalist id="qs-customer-suggestions">
              {customers.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
              Sold by (optional)
            </label>
            <SpeechInput
              value={soldBy}
              onChangeValue={setSoldBy}
              placeholder="Staff name"
            />
          </div>
        </div>

        <div>
          <label htmlFor="qs-date" className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
            Date
          </label>
          <input
            id="qs-date"
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            className="w-full sm:w-48 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 text-sm min-h-[44px]"
          />
        </div>

        {error && (
          <div className="rounded-xl border border-[#B91C1C]/30 bg-[#FEF2F2] dark:bg-red-950/30 p-3.5 flex items-center justify-between gap-3">
            <p className="text-xs text-[#B91C1C] dark:text-red-300">{error}</p>
            <button
              type="submit"
              disabled={submitting}
              className="shrink-0 min-h-[34px] rounded-lg bg-[#B91C1C] px-3 text-xs font-semibold text-white hover:bg-[#991B1B] disabled:opacity-60"
            >
              Retry
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full min-h-[52px] rounded-xl bg-[#064E3B] px-6 py-3 text-base font-semibold text-white hover:bg-[#04392B] transition-colors disabled:opacity-60"
        >
          {submitting
            ? 'Saving Quick Sale…'
            : `Save Quick Sale ${amountKobo > 0 ? `(${formatKobo(amountKobo, business.currency)})` : ''}`}
        </button>
      </form>

      <NumericKeypad
        open={keypadOpen}
        title="Quick sale amount"
        initialValue={amountInput}
        mode="currency"
        currency={business.currency}
        onApply={setAmountInput}
        onClose={() => setKeypadOpen(false)}
      />
    </div>
  );
}
