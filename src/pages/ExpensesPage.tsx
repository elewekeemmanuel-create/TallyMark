import React, { useCallback, useEffect, useState } from 'react';
import {
  Edit3,
  History,
  Lock,
  Mic,
  Plus,
  Search,
  Trash2,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import { AuthProofImage } from '../components/AuthProofImage';
import { CorrectionEntryModal } from '../components/CloseDayModal';
import { NumericKeypad } from '../components/NumericKeypad';
import { SpeechInput, SpeechTextarea } from '../components/SpeechInput';
import { ApiError, api } from '../lib/api';
import { useRouter } from '../lib/router';
import {
  formatKobo,
  formatKoboPlainInput,
  formatLagosDateOnly,
  formatLagosDateTime,
  getLagosDateString,
  parseAmountToKobo,
} from '../shared/money';
import { EXPENSE_CATEGORY_PRESETS, type PaymentMethod } from '../shared/schemas';
import type { BusinessProfile, ExpenseRecord, ExpenseRevisionRecord } from '../shared/types';

async function fileToCompressedProofDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file'));
      img.onload = () => {
        const maxDim = 1280;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas unavailable'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function ExpensesPage({ business }: { business: BusinessProfile }) {
  const { search } = useRouter();
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [q, setQ] = useState('');
  const [filterCat, setFilterCat] = useState('ALL');
  const [filterMethod, setFilterMethod] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Quick-add / Edit form
  const [showForm, setShowForm] = useState(() => new URLSearchParams(search).get('new') === '1');
  const [editing, setEditing] = useState<ExpenseRecord | null>(null);
  const [entryDate, setEntryDate] = useState(() => getLagosDateString());
  const [amountInput, setAmountInput] = useState('');
  const [categoryPreset, setCategoryPreset] = useState<string>('Stock');
  const [customCategory, setCustomCategory] = useState('');
  const [payee, setPayee] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [note, setNote] = useState('');
  const [proofPath, setProofPath] = useState<string | null>(null);
  const [proofPreviewUrl, setProofPreviewUrl] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const draftKey = `tallymark_expense_draft_${business.id}`;

  // Modals
  const [revisionsTarget, setRevisionsTarget] = useState<ExpenseRecord | null>(null);
  const [revisions, setRevisions] = useState<ExpenseRevisionRecord[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [closedDayPrompt, setClosedDayPrompt] = useState<{
    date: string;
    expenseId?: string | null;
    message: string;
  } | null>(null);
  const [showCorrectionFor, setShowCorrectionFor] = useState<{
    date: string;
    expenseId?: string | null;
    message: string;
  } | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          if (parsed.amountInput) setAmountInput(String(parsed.amountInput));
          if (parsed.categoryPreset) setCategoryPreset(String(parsed.categoryPreset));
          if (parsed.customCategory) setCustomCategory(String(parsed.customCategory));
          if (parsed.payee) setPayee(String(parsed.payee));
          if (parsed.paymentMethod) setPaymentMethod(parsed.paymentMethod);
          if (parsed.note) setNote(String(parsed.note));
        }
      }
    } catch {
      // ignore
    }
  }, [draftKey]);

  useEffect(() => {
    if (editing || !showForm) return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          amountInput,
          categoryPreset,
          customCategory,
          payee,
          paymentMethod,
          note,
        })
      );
    } catch {
      // ignore
    }
  }, [draftKey, editing, showForm, amountInput, categoryPreset, customCategory, payee, paymentMethod, note]);

  useEffect(() => {
    if (!revisionsTarget && !lightboxUrl) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxUrl) setLightboxUrl(null);
        else if (revisionsTarget) setRevisionsTarget(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [revisionsTarget, lightboxUrl]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getExpenses({
        q: q.trim() || undefined,
        category: filterCat !== 'ALL' ? filterCat : undefined,
        paymentMethod: filterMethod !== 'ALL' ? filterMethod : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setExpenses(res.expenses);
    } catch (err: any) {
      setError(err?.message || 'Unable to load expenses');
    } finally {
      setLoading(false);
    }
  }, [q, filterCat, filterMethod, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (new URLSearchParams(search).get('new') === '1') {
      setShowForm(true);
    }
  }, [search]);

  const startNew = () => {
    setEditing(null);
    setEntryDate(getLagosDateString());
    setAmountInput('');
    setCategoryPreset('Stock');
    setCustomCategory('');
    setPayee('');
    setPaymentMethod('Cash');
    setNote('');
    setProofPath(null);
    setProofPreviewUrl(null);
    setShowForm(true);
  };

  const startEdit = (exp: ExpenseRecord) => {
    if (exp.isClosedDay) {
      setClosedDayPrompt({
        date: exp.entryDate,
        expenseId: exp.id,
        message: `Day ${exp.entryDate} is closed. Editing this expense directly is locked — post a visible correction entry instead.`,
      });
      return;
    }
    setEditing(exp);
    setEntryDate(exp.entryDate);
    setAmountInput(formatKoboPlainInput(exp.amountKobo));
    if ((EXPENSE_CATEGORY_PRESETS as readonly string[]).includes(exp.category)) {
      setCategoryPreset(exp.category);
      setCustomCategory('');
    } else {
      setCategoryPreset('CUSTOM');
      setCustomCategory(exp.category);
    }
    setPayee(exp.payee);
    setPaymentMethod(exp.paymentMethod);
    setNote(exp.note);
    setProofPath(exp.proofPath);
    setProofPreviewUrl(exp.proofUrl);
    setShowForm(true);
  };

  const handleProofFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingProof(true);
    setError(null);
    try {
      const dataUrl = await fileToCompressedProofDataUrl(file);
      const uploaded = await api.uploadExpenseProof(dataUrl);
      setProofPath(uploaded.proofPath);
      setProofPreviewUrl(uploaded.proofUrl);
    } catch (err: any) {
      setError(err?.message || 'Unable to upload proof image');
    } finally {
      setUploadingProof(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const amountKobo = parseAmountToKobo(amountInput || '0');
    const finalCategory =
      categoryPreset === 'CUSTOM' ? customCategory.trim() : categoryPreset;
    if (amountKobo <= 0) {
      setError('Enter an expense amount greater than zero.');
      return;
    }
    if (!finalCategory) {
      setError('Choose or enter an expense category.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.updateExpense(editing.id, {
          entryDate,
          amountKobo,
          category: finalCategory,
          payee: payee.trim(),
          paymentMethod,
          note: note.trim(),
          proofPath,
        });
      } else {
        await api.createExpense({
          entryDate,
          amountKobo,
          category: finalCategory,
          payee: payee.trim(),
          paymentMethod,
          note: note.trim(),
          proofPath,
          source: 'manual',
        });
        try {
          localStorage.removeItem(draftKey);
        } catch {
          // ignore
        }
      }
      setShowForm(false);
      setEditing(null);
      await load();
    } catch (err: any) {
      if (err instanceof ApiError && (err.code === 'CLOSED_DAY' || err.status === 409)) {
        setClosedDayPrompt({
          date: err.closedDate || entryDate,
          expenseId: editing?.id || null,
          message: err.message,
        });
      } else {
        setError(err?.message || 'Unable to save expense');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (exp: ExpenseRecord) => {
    if (exp.isClosedDay) {
      setClosedDayPrompt({
        date: exp.entryDate,
        expenseId: exp.id,
        message: `Day ${exp.entryDate} is closed. Deleting this expense is locked — post a visible correction entry instead.`,
      });
      return;
    }
    try {
      await api.deleteExpense(exp.id);
      await load();
    } catch (err: any) {
      if (err instanceof ApiError && (err.code === 'CLOSED_DAY' || err.status === 409)) {
        setClosedDayPrompt({
          date: err.closedDate || exp.entryDate,
          expenseId: exp.id,
          message: err.message,
        });
      } else {
        setError(err?.message || 'Unable to delete expense');
      }
    }
  };

  const openRevisions = async (exp: ExpenseRecord) => {
    setRevisionsTarget(exp);
    setRevisionsLoading(true);
    try {
      const res = await api.getExpenseRevisions(exp.id);
      setRevisions(res.revisions);
    } catch {
      setRevisions([]);
    } finally {
      setRevisionsLoading(false);
    }
  };

  const totalFilteredKobo = expenses.reduce((s, e) => s + e.amountKobo, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="label-caps text-[#6B7280] dark:text-[#9CA3AF]">Money Out</p>
          <h1 className="mt-1 font-display text-3xl text-[#111827] dark:text-[#F3F4F6]">
            Expenses
          </h1>
        </div>
        <button
          type="button"
          onClick={() => (showForm ? setShowForm(false) : startNew())}
          className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-[10px] bg-[#064E3B] px-4 py-2 text-xs font-semibold text-white hover:bg-[#04392B]"
        >
          <Plus className="w-4 h-4" />
          <span>{showForm ? 'Hide Form' : 'Add Expense'}</span>
        </button>
      </div>

      {closedDayPrompt && (
        <div className="rounded-[10px] border border-[#B45309]/40 bg-[#FEF3C7]/70 dark:bg-amber-950/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-sm text-[#92400E] dark:text-amber-300">
            <Lock className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{closedDayPrompt.message}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setClosedDayPrompt(null)}
              className="min-h-[38px] rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] px-3 text-xs font-medium"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => {
                // Opens correction modal directly via separate state
                setRevisionsTarget(null);
                setShowCorrectionFor(closedDayPrompt);
                setClosedDayPrompt(null);
              }}
              className="min-h-[38px] rounded-[10px] bg-[#064E3B] px-3.5 text-xs font-semibold text-white"
            >
              Post Correction Entry
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleSave}
          className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 sm:p-6 space-y-5"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl">
              {editing ? 'Edit Expense' : 'Quick-Add Expense'}
            </h2>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setEditing(null);
              }}
              className="min-w-[38px] min-h-[38px] inline-flex items-center justify-center rounded-[10px] border border-gray-200 dark:border-[#232D29]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block label-caps text-[#6B7280] dark:text-[#9CA3AF] mb-1.5">
                Amount ({business.currency}) *
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3.5 py-2.5 font-mono-num text-lg font-semibold min-h-[44px]"
                  required
                />
                <button
                  type="button"
                  onClick={() => setKeypadOpen(true)}
                  className="shrink-0 rounded-[10px] border border-gray-200 dark:border-[#232D29] px-3 text-xs font-medium min-h-[44px]"
                >
                  Keypad
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="exp-date" className="block label-caps text-[#6B7280] dark:text-[#9CA3AF] mb-1.5">
                Date *
              </label>
              <input
                id="exp-date"
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] px-3.5 py-2.5 text-sm min-h-[44px]"
                required
              />
            </div>
          </div>

          <div>
            <label className="block label-caps text-[#6B7280] dark:text-[#9CA3AF] mb-1.5">
              Category *
            </label>
            <div className="flex flex-wrap gap-2">
              {EXPENSE_CATEGORY_PRESETS.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryPreset(cat)}
                  className={`min-h-[38px] rounded-[10px] border px-3 text-xs font-medium transition-colors ${
                    categoryPreset === cat
                      ? 'border-[#064E3B] bg-[#064E3B] text-white'
                      : 'border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715]'
                  }`}
                >
                  {cat}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCategoryPreset('CUSTOM')}
                className={`min-h-[38px] rounded-[10px] border px-3 text-xs font-medium transition-colors ${
                  categoryPreset === 'CUSTOM'
                    ? 'border-[#064E3B] bg-[#064E3B] text-white'
                    : 'border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715]'
                }`}
              >
                + Custom
              </button>
            </div>
            {categoryPreset === 'CUSTOM' && (
              <div className="mt-2">
                <SpeechInput
                  value={customCategory}
                  onChangeValue={setCustomCategory}
                  placeholder="Enter custom category (e.g. Fuel, Packaging)"
                  required
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block label-caps text-[#6B7280] dark:text-[#9CA3AF] mb-1.5">
                Paid To / Payee (optional)
              </label>
              <SpeechInput
                value={payee}
                onChangeValue={setPayee}
                placeholder="e.g. NEPA, Dispatch rider, Landlord"
              />
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
                    className={`min-h-[44px] rounded-[10px] border text-xs font-medium ${
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
          </div>

          <div>
            <label className="block label-caps text-[#6B7280] dark:text-[#9CA3AF] mb-1.5">
              Note (optional)
            </label>
            <SpeechTextarea
              rows={2}
              value={note}
              onChangeValue={setNote}
              placeholder="What was this expense for?"
            />
          </div>

          <div>
            <label className="block label-caps text-[#6B7280] dark:text-[#9CA3AF] mb-1.5">
              Proof of Payment Photo (private, optional)
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <label className="min-h-[44px] inline-flex items-center gap-2 rounded-[10px] border border-dashed border-gray-200 dark:border-[#36423B] bg-[#F6F7F8] dark:bg-[#111715] px-4 py-2 text-xs font-medium cursor-pointer">
                <Upload className="w-4 h-4 text-[#064E3B] dark:text-[#6EE7B7]" />
                <span>{uploadingProof ? 'Uploading…' : proofPath ? 'Replace proof photo' : 'Upload receipt / transfer proof'}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleProofFile}
                  className="hidden"
                />
              </label>
              {proofPreviewUrl && (
                <div className="flex items-center gap-2">
                  <AuthProofImage
                    proofUrl={proofPreviewUrl}
                    onClick={(resolved) => setLightboxUrl(resolved)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setProofPath(null);
                      setProofPreviewUrl(null);
                    }}
                    className="text-xs text-[#B91C1C] hover:underline"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="rounded-[10px] border border-[#B91C1C]/30 bg-[#FEF2F2] dark:bg-red-950/30 p-3 flex items-center justify-between gap-3">
              <p className="text-xs text-[#B91C1C] dark:text-red-300">{error}</p>
              <button
                type="submit"
                disabled={saving || uploadingProof}
                className="shrink-0 min-h-[34px] rounded-lg bg-[#B91C1C] px-3 text-xs font-semibold text-white hover:bg-[#991B1B]"
              >
                Retry
              </button>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setEditing(null);
              }}
              className="min-h-[44px] rounded-[10px] border border-gray-200 dark:border-[#232D29] px-4 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || uploadingProof}
              className="min-h-[44px] rounded-[10px] bg-[#064E3B] px-5 text-sm font-semibold text-white hover:bg-[#04392B] disabled:opacity-60"
            >
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Save Expense'}
            </button>
          </div>
        </form>
      )}

      {!showForm && error && (
        <div className="rounded-[10px] border border-[#B91C1C]/30 bg-[#FEF2F2] dark:bg-red-950/30 p-3.5 flex items-center justify-between gap-3">
          <p className="text-xs text-[#B91C1C] dark:text-red-300">{error}</p>
          <button
            type="button"
            onClick={load}
            className="shrink-0 min-h-[34px] rounded-lg bg-[#B91C1C] px-3 text-xs font-semibold text-white hover:bg-[#991B1B]"
          >
            Retry
          </button>
        </div>
      )}

      {/* Filters & Summary */}
      <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search payee, note, category…"
              className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] pl-10 pr-3 py-2 text-sm min-h-[42px]"
            />
          </div>
          <select
            value={filterCat}
            onChange={(e) => setFilterCat(e.target.value)}
            className="rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] px-3 py-2 text-sm min-h-[42px]"
          >
            <option value="ALL">All Categories</option>
            {EXPENSE_CATEGORY_PRESETS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={filterMethod}
            onChange={(e) => setFilterMethod(e.target.value)}
            className="rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] px-3 py-2 text-sm min-h-[42px]"
          >
            <option value="ALL">All Methods</option>
            <option value="Cash">Cash</option>
            <option value="Transfer">Transfer</option>
            <option value="POS">POS</option>
            <option value="Card">Card</option>
            <option value="Other">Other</option>
          </select>
          <div className="flex items-center justify-between px-3 rounded-[10px] bg-[#F4F6F8] dark:bg-[#111715] text-xs">
            <span className="text-[#6B7280] dark:text-[#9CA3AF]">Total shown</span>
            <span className="font-mono-num font-semibold">
              {formatKobo(totalFilteredKobo, business.currency)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[#6B7280] dark:text-[#9CA3AF]">Date range:</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] px-2.5 py-1.5"
          />
          <span>to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] px-2.5 py-1.5"
          />
          {(dateFrom || dateTo || filterCat !== 'ALL' || filterMethod !== 'ALL' || q) && (
            <button
              type="button"
              onClick={() => {
                setQ('');
                setFilterCat('ALL');
                setFilterMethod('ALL');
                setDateFrom('');
                setDateTo('');
              }}
              className="text-[#064E3B] dark:text-[#6EE7B7] font-medium hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-[20px] bg-[#F4F6F8] dark:bg-[#1A221F] animate-pulse" />
          ))}
        </div>
      ) : expenses.length === 0 ? (
        <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-8 text-center space-y-2">
          <div className="mx-auto w-11 h-11 rounded-[20px] bg-[#F4F6F8] dark:bg-[#1A221F] flex items-center justify-center text-[#064E3B] dark:text-[#6EE7B7]">
            <Wallet className="w-5 h-5" />
          </div>
          <p className="font-display text-2xl">No expenses logged yet</p>
          <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF]">
            Record stock purchases, fuel, rent, salaries, or transport costs with optional proof photos.
          </p>
        </div>
      ) : (
        <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] divide-y divide-gray-100 dark:divide-[#1F2925]">
          {expenses.map((exp) => (
            <div
              key={exp.id}
              className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-3 min-w-0">
                {exp.proofUrl && (
                  <AuthProofImage
                    proofUrl={exp.proofUrl}
                    alt={`Proof for ${exp.category}`}
                    className="w-12 h-12 rounded-[10px] object-cover border border-gray-200 dark:border-[#232D29]"
                    onClick={(resolved) => setLightboxUrl(resolved)}
                  />
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{exp.category}</span>
                    {exp.payee && (
                      <span className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                        · {exp.payee}
                      </span>
                    )}
                    {exp.isClosedDay && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#B45309] dark:text-amber-400">
                        <Lock className="w-3 h-3" />
                        <span>Day closed</span>
                      </span>
                    )}
                    {exp.source === 'voice' && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#064E3B] dark:text-[#6EE7B7]">
                        <Mic className="w-3 h-3" />
                        <span>Voice</span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mt-0.5">
                    {formatLagosDateOnly(exp.entryDate)} · {exp.paymentMethod}
                    {exp.note ? ` · ${exp.note}` : ''}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0">
                <span className="font-mono-num text-sm font-semibold text-[#B91C1C] dark:text-red-400">
                  -{formatKobo(exp.amountKobo, business.currency)}
                </span>
                <button
                  type="button"
                  onClick={() => openRevisions(exp)}
                  title="Edit history"
                  aria-label="Edit history"
                  className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center rounded-[10px] border border-gray-200 dark:border-[#232D29] text-[#6B7280] dark:text-[#9CA3AF]"
                >
                  <History className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => startEdit(exp)}
                  title={exp.isClosedDay ? 'Day closed — post correction' : 'Edit expense'}
                  aria-label="Edit expense"
                  className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center rounded-[10px] border border-gray-200 dark:border-[#232D29] text-[#6B7280] dark:text-[#9CA3AF]"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(exp)}
                  title={exp.isClosedDay ? 'Day closed — locked' : 'Delete expense'}
                  aria-label="Delete expense"
                  className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center rounded-[10px] border border-gray-200 dark:border-[#232D29] text-[#6B7280] hover:text-[#B91C1C]"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Revisions Modal */}
      {revisionsTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-[#F6F7F8] dark:bg-[#131917] p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="label-caps text-[#6B7280] dark:text-[#9CA3AF]">Audit Trail</p>
                <h3 className="font-display text-2xl">
                  {revisionsTarget.category} ·{' '}
                  {formatKobo(revisionsTarget.amountKobo, business.currency)}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRevisionsTarget(null)}
                className="min-w-[38px] min-h-[38px] inline-flex items-center justify-center rounded-[10px] border border-gray-200 dark:border-[#232D29]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {revisionsLoading ? (
              <p className="text-xs text-[#6B7280]">Loading history…</p>
            ) : revisions.length === 0 ? (
              <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF]">
                No edits or corrections recorded for this expense.
              </p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {revisions.map((rev) => (
                  <div
                    key={rev.id}
                    className="rounded-[10px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#111715] p-3 text-xs space-y-1"
                  >
                    <div className="flex justify-between font-semibold">
                      <span>{rev.action}</span>
                      <span className="font-mono-num text-[#6B7280]">
                        {formatLagosDateTime(rev.changedAt)}
                      </span>
                    </div>
                    {rev.reason && <p className="text-[#6B7280] dark:text-[#9CA3AF]">{rev.reason}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lightbox for Private Proof Photo */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="relative max-w-2xl max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setLightboxUrl(null)}
              aria-label="Close preview"
              className="absolute -top-3 -right-3 w-9 h-9 rounded-full bg-white text-black flex items-center justify-center shadow"
            >
              <X className="w-4 h-4" />
            </button>
            <img src={lightboxUrl} alt="Expense proof" className="max-h-[82vh] rounded-[10px] object-contain" />
          </div>
        </div>
      )}

      <NumericKeypad
        open={keypadOpen}
        title="Expense amount"
        initialValue={amountInput}
        mode="currency"
        currency={business.currency}
        onApply={setAmountInput}
        onClose={() => setKeypadOpen(false)}
      />

      {showCorrectionFor && (
        <CorrectionEntryModal
          business={business}
          defaultDate={showCorrectionFor.date}
          defaultExpenseId={showCorrectionFor.expenseId || null}
          onClose={() => setShowCorrectionFor(null)}
          onCreated={load}
        />
      )}
    </div>
  );
}
