import React, { useEffect, useState } from 'react';
import { CheckCircle2, CreditCard } from 'lucide-react';
import { NumericKeypad } from '../components/NumericKeypad';
import { SpeechInput } from '../components/SpeechInput';
import { api } from '../lib/api';
import { Link } from '../lib/router';
import { formatKobo, getLagosDateString, parseAmountToKobo } from '../shared/money';
import type { BusinessProfile, CreditSaleRecord, CustomerSuggestion } from '../shared/types';

export function CreditSalePage({ business }: { business: BusinessProfile }) {
  const draftKey = `tallymark_creditsale_draft_${business.id}`;
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [itemNote, setItemNote] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [soldBy, setSoldBy] = useState('');
  const [entryDate, setEntryDate] = useState(() => getLagosDateString());
  const [customers, setCustomers] = useState<CustomerSuggestion[]>([]);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCredit, setSavedCredit] = useState<CreditSaleRecord | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          if (parsed.customerName) setCustomerName(String(parsed.customerName));
          if (parsed.customerPhone) setCustomerPhone(String(parsed.customerPhone));
          if (parsed.amountInput) setAmountInput(String(parsed.amountInput));
          if (parsed.itemNote) setItemNote(String(parsed.itemNote));
          if (parsed.dueDate) setDueDate(String(parsed.dueDate));
          if (parsed.soldBy) setSoldBy(String(parsed.soldBy));
        }
      }
    } catch {
      // ignore storage errors
    }
  }, [draftKey]);

  useEffect(() => {
    if (savedCredit) return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          customerName,
          customerPhone,
          amountInput,
          itemNote,
          dueDate,
          soldBy,
        })
      );
    } catch {
      // ignore
    }
  }, [draftKey, savedCredit, customerName, customerPhone, amountInput, itemNote, dueDate, soldBy]);

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
    if (!customerName.trim()) {
      setError('Customer name is required for a credit sale.');
      return;
    }
    if (amountKobo <= 0) {
      setError('Enter the amount owed (greater than zero).');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.createCreditSale({
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        amountKobo,
        itemNote: itemNote.trim(),
        dueDate: dueDate || '',
        soldBy: soldBy.trim(),
        entryDate,
      });
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // ignore
      }
      setSavedCredit(res.creditSale);
    } catch (err: any) {
      setError(err?.message || 'Unable to record credit sale');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
    setSavedCredit(null);
    setCustomerName('');
    setCustomerPhone('');
    setAmountInput('');
    setItemNote('');
    setDueDate('');
    setError(null);
  };

  if (savedCredit) {
    return (
      <div className="max-w-lg mx-auto rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-6 sm:p-8 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#B45309]/10 text-[#B45309] dark:text-amber-400 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <p className="label-caps text-[#B45309] dark:text-amber-400">Credit Sale Recorded</p>
            <h1 className="mt-1 font-display text-3xl">
              {formatKobo(savedCredit.totalKobo, business.currency)}
            </h1>
            <p className="mt-1 text-sm text-[#121513] dark:text-[#F4F1EA]">
              Owed by <strong>{savedCredit.customerName}</strong>
              {savedCredit.dueDate ? ` · Due ${savedCredit.dueDate}` : ''}
            </p>
            <p className="mt-1 text-xs text-[#5C635D] dark:text-[#9BA39D]">
              ₦0.00 counted as money received today until customer pays.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2">
          <Link
            to="/app/debtors"
            className="min-h-[46px] rounded-xl bg-[#064E3B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#04392B] inline-flex items-center justify-center"
          >
            View Debtors
          </Link>
          <button
            type="button"
            onClick={resetForm}
            className="min-h-[46px] rounded-xl border border-[#DED6C2] dark:border-[#2B352F] px-4 py-2.5 text-sm font-medium"
          >
            Record Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#B45309] dark:text-amber-400">
          <CreditCard className="w-3.5 h-3.5" />
          <span>Borrowed / Pay Later</span>
        </div>
        <h1 className="mt-1 font-display text-3xl text-[#121513] dark:text-[#F4F1EA]">
          Credit Sale
        </h1>
        <p className="text-sm text-[#5C635D] dark:text-[#9BA39D]">
          Creates a customer debt in Debtors. Money is only counted in your Cash Book when the customer pays.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-5 sm:p-6 space-y-5"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
              Customer Name *
            </label>
            <SpeechInput
              value={customerName}
              onChangeValue={handleCustomerChange}
              list="cs-customer-suggestions"
              placeholder="e.g. Alhaji Musa"
              required
            />
            <datalist id="cs-customer-suggestions">
              {customers.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="cs-phone" className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
              Phone (for WhatsApp reminder)
            </label>
            <input
              id="cs-phone"
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="0803 000 0000"
              className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 font-mono-num text-sm min-h-[44px]"
            />
          </div>
        </div>

        <div>
          <label htmlFor="cs-amount" className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
            Amount Owed ({business.currency}) *
          </label>
          <div className="flex gap-2">
            <input
              id="cs-amount"
              type="text"
              inputMode="decimal"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#111714] px-4 py-3 font-mono-num text-2xl font-semibold min-h-[54px]"
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
        </div>

        <div>
          <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
            Items taken on credit
          </label>
          <SpeechInput
            value={itemNote}
            onChangeValue={setItemNote}
            placeholder="e.g. 3 cartons of noodles, 1 crate drinks"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="cs-date" className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
              Sale Date
            </label>
            <input
              id="cs-date"
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3 py-2.5 text-sm min-h-[44px]"
            />
          </div>
          <div>
            <label htmlFor="cs-due" className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
              Due Date (optional)
            </label>
            <input
              id="cs-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3 py-2.5 text-sm min-h-[44px]"
            />
          </div>
          <div>
            <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
              Sold by (optional)
            </label>
            <SpeechInput value={soldBy} onChangeValue={setSoldBy} placeholder="Staff name" />
          </div>
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
          {submitting ? 'Saving Credit Sale…' : 'Record Credit Sale'}
        </button>
      </form>

      <NumericKeypad
        open={keypadOpen}
        title="Amount owed"
        initialValue={amountInput}
        mode="currency"
        currency={business.currency}
        onApply={setAmountInput}
        onClose={() => setKeypadOpen(false)}
      />
    </div>
  );
}
