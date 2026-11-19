import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  CreditCard,
  Keyboard,
  Mic,
  Plus,
  ReceiptText,
  Sparkles,
  Square,
  Trash2,
  Wallet,
  Zap,
} from 'lucide-react';
import { NumericKeypad } from '../components/NumericKeypad';
import { useContinuousVoiceCapture } from '../components/SpeechInput';
import { ApiError, api } from '../lib/api';
import { Link } from '../lib/router';
import {
  formatKobo,
  formatKoboPlainInput,
  getLagosDateString,
  parseAmountToKobo,
} from '../shared/money';
import { EXPENSE_CATEGORY_PRESETS, type PaymentMethod } from '../shared/schemas';
import {
  type ConfirmVoiceEntryInput,
  type VoiceDraftItem,
  type VoiceEntryType,
} from '../shared/voiceDraft';
import type { BusinessProfile, LedgerEntryRecord } from '../shared/types';

interface EditableDraftRow {
  id: string;
  type: VoiceEntryType;
  amountInput: string;
  paymentMethod: PaymentMethod;
  categoryPreset: string;
  customCategory: string;
  customerName: string;
  customerPhone: string;
  note: string;
  soldBy: string;
  entryDate: string;
  confidence: 'high' | 'medium' | 'low';
  ambiguous: boolean;
  ambiguityReason: string;
}

function toEditableRow(item: VoiceDraftItem): EditableDraftRow {
  const isPreset = (EXPENSE_CATEGORY_PRESETS as readonly string[]).includes(item.category);
  return {
    id: item.id,
    type: item.type,
    amountInput: item.amountKobo > 0 ? formatKoboPlainInput(item.amountKobo) : '',
    paymentMethod: item.paymentMethod,
    categoryPreset: isPreset ? item.category : 'CUSTOM',
    customCategory: isPreset ? '' : item.category,
    customerName: item.customerName,
    customerPhone: item.customerPhone,
    note: item.note,
    soldBy: item.soldBy,
    entryDate: item.entryDate || getLagosDateString(),
    confidence: item.confidence,
    ambiguous: item.ambiguous,
    ambiguityReason: item.ambiguityReason,
  };
}

function createBlankRow(): EditableDraftRow {
  return {
    id: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'sale',
    amountInput: '',
    paymentMethod: 'Cash',
    categoryPreset: 'Other',
    customCategory: '',
    customerName: '',
    customerPhone: '',
    note: '',
    soldBy: '',
    entryDate: getLagosDateString(),
    confidence: 'high',
    ambiguous: false,
    ambiguityReason: '',
  };
}

const ENTRY_TYPE_LABELS: Record<VoiceEntryType, string> = {
  sale: 'Sale (Paid)',
  expense: 'Expense',
  credit_sale: 'Credit Sale (Borrowed)',
  payment_received: 'Debt Payment Received',
};

const QUICK_FALLBACK_LINKS = [
  { to: '/app/quick-sale', label: 'Quick Sale', icon: Zap },
  { to: '/app/credit-sale', label: 'Credit Sale', icon: CreditCard },
  { to: '/app/expenses?new=1', label: 'Add Expense', icon: Wallet },
  { to: '/app/new', label: 'New Receipt', icon: ReceiptText },
] as const;

export function SpeakDayPage({ business }: { business: BusinessProfile }) {
  const voice = useContinuousVoiceCapture();
  const draftKey = `tallymark_speak_draft_${business.id}`;

  const [step, setStep] = useState<'capture' | 'review' | 'done'>('capture');
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryNote, setSummaryNote] = useState('');
  const [rows, setRows] = useState<EditableDraftRow[]>([]);
  const [savedEntries, setSavedEntries] = useState<LedgerEntryRecord[]>([]);
  const [keypadRowId, setKeypadRowId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          if (typeof parsed.transcript === 'string' && parsed.transcript) {
            voice.setFinalTranscript(parsed.transcript);
          }
          if (Array.isArray(parsed.rows) && parsed.rows.length > 0) {
            setRows(parsed.rows);
            if (parsed.step === 'review') setStep('review');
          }
          if (typeof parsed.summaryNote === 'string') {
            setSummaryNote(parsed.summaryNote);
          }
        }
      }
    } catch {
      // ignore storage errors
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  useEffect(() => {
    if (step === 'done') return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          transcript: voice.finalTranscript,
          step,
          rows,
          summaryNote,
        })
      );
    } catch {
      // ignore
    }
  }, [draftKey, voice.finalTranscript, step, rows, summaryNote]);

  const combinedLiveText = useMemo(() => {
    const base = voice.finalTranscript.trim();
    const interim = voice.interimTranscript.trim();
    if (!interim) return base;
    return base ? `${base} ${interim}` : interim;
  }, [voice.finalTranscript, voice.interimTranscript]);

  const handleDraftEntries = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (voice.listening) {
      voice.stop();
    }
    const text = combinedLiveText.trim();
    if (text.length < 2) {
      setError('Speak or type what happened today before drafting.');
      return;
    }

    setError(null);
    setDrafting(true);
    try {
      const res = await api.parseVoiceTranscript(text);
      setRows(res.entries.map(toEditableRow));
      setSummaryNote(res.summaryNote || '');
      setStep('review');
    } catch (err: any) {
      setError(
        err?.message ||
          'Could not draft entries right now. You can edit the text or use the manual forms below.'
      );
    } finally {
      setDrafting(false);
    }
  };

  const updateRow = (id: string, patch: Partial<EditableDraftRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const addRow = () => {
    setRows((prev) => [...prev, createBlankRow()]);
  };

  const reviewTotals = useMemo(() => {
    let inKobo = 0;
    let outKobo = 0;
    let creditKobo = 0;
    let checkCount = 0;

    for (const r of rows) {
      const kobo = parseAmountToKobo(r.amountInput || '0');
      if (r.type === 'sale' || r.type === 'payment_received') inKobo += kobo;
      else if (r.type === 'expense') outKobo += kobo;
      else if (r.type === 'credit_sale') creditKobo += kobo;

      const missingCustomer = r.type === 'credit_sale' && !r.customerName.trim();
      if (r.ambiguous || r.confidence === 'low' || kobo <= 0 || missingCustomer) {
        checkCount += 1;
      }
    }

    return { inKobo, outKobo, creditKobo, checkCount };
  }, [rows]);

  const handleConfirmSave = async () => {
    setError(null);
    if (rows.length === 0) {
      setError('Add or keep at least one entry before saving.');
      return;
    }

    const payload: ConfirmVoiceEntryInput[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const amountKobo = parseAmountToKobo(r.amountInput || '0');
      if (amountKobo <= 0) {
        setError(`Entry #${i + 1} needs an amount greater than zero.`);
        return;
      }
      if (r.type === 'credit_sale' && !r.customerName.trim()) {
        setError(`Entry #${i + 1} is a credit sale — enter the customer's name.`);
        return;
      }
      const category =
        r.type === 'expense'
          ? r.categoryPreset === 'CUSTOM'
            ? r.customCategory.trim() || 'Other'
            : r.categoryPreset
          : 'Other';

      payload.push({
        type: r.type,
        amountKobo,
        paymentMethod: r.type === 'credit_sale' ? 'Other' : r.paymentMethod,
        category,
        customerName: r.customerName.trim(),
        customerPhone: r.customerPhone.trim(),
        note: r.note.trim(),
        soldBy: r.soldBy.trim(),
        entryDate: r.entryDate || getLagosDateString(),
      });
    }

    setSaving(true);
    try {
      const res = await api.confirmVoiceEntries(payload);
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // ignore
      }
      setSavedEntries(res.entries || []);
      setStep('done');
    } catch (err: any) {
      if (err instanceof ApiError && (err.code === 'CLOSED_DAY' || err.status === 409)) {
        setError(err.message);
      } else {
        setError(err?.message || 'Unable to save confirmed entries.');
      }
    } finally {
      setSaving(false);
    }
  };

  const resetAll = () => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
    voice.stop();
    voice.setFinalTranscript('');
    setRows([]);
    setSavedEntries([]);
    setSummaryNote('');
    setError(null);
    setStep('capture');
  };

  const keypadTargetRow = rows.find((r) => r.id === keypadRowId) || null;

  if (step === 'done') {
    return (
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-6 sm:p-8 space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#064E3B]/10 dark:bg-[#10B981]/15 text-[#064E3B] dark:text-[#10B981] flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <p className="label-caps text-[#064E3B] dark:text-[#10B981]">Saved to Cash Book</p>
              <h1 className="mt-1 font-display text-3xl text-[#121513] dark:text-[#F4F1EA]">
                {savedEntries.length} voice {savedEntries.length === 1 ? 'entry' : 'entries'} recorded
              </h1>
              <p className="mt-1 text-xs text-[#5C635D] dark:text-[#9BA39D]">
                Marked with source: voice in your Cash Book and Expenses ledger.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-[#ECE6D8] dark:border-[#242D28] divide-y divide-[#ECE6D8] dark:divide-[#242D28]">
            {savedEntries.map((e) => (
              <div key={e.id} className="px-4 py-3 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium truncate">{e.note || e.entryKind}</p>
                  <p className="text-xs text-[#5C635D] dark:text-[#9BA39D]">
                    {e.entryDate} · {e.paymentMethod || 'Cash'}
                    {e.customerName ? ` · ${e.customerName}` : ''} · Voice
                  </p>
                </div>
                <span
                  className={`font-mono-num font-semibold shrink-0 ${
                    e.entryType === 'EXPENSE'
                      ? 'text-[#B91C1C] dark:text-red-400'
                      : e.entryKind === 'CREDIT_SALE'
                      ? 'text-[#B45309] dark:text-amber-400'
                      : 'text-[#064E3B] dark:text-[#10B981]'
                  }`}
                >
                  {e.entryType === 'EXPENSE' ? '-' : '+'}
                  {formatKobo(e.amountKobo, business.currency)}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2.5">
            <Link
              to="/app/cashbook"
              className="min-h-[46px] inline-flex items-center gap-2 rounded-xl bg-[#064E3B] px-5 text-xs font-semibold text-white hover:bg-[#04392B]"
            >
              <BookOpen className="w-4 h-4" />
              <span>Open Cash Book</span>
            </Link>
            <button
              type="button"
              onClick={resetAll}
              className="min-h-[46px] inline-flex items-center gap-2 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] px-4 text-xs font-semibold"
            >
              <Mic className="w-4 h-4 text-[#064E3B] dark:text-[#10B981]" />
              <span>Speak More</span>
            </button>
            <Link
              to="/app"
              className="min-h-[46px] inline-flex items-center rounded-xl border border-[#DED6C2] dark:border-[#2B352F] px-4 text-xs font-semibold"
            >
              Back Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'review') {
    return (
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep('capture');
              }}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#5C635D] dark:text-[#9BA39D] hover:text-[#121513]"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Edit transcript</span>
            </button>
            <h1 className="mt-1 font-display text-3xl text-[#121513] dark:text-[#F4F1EA]">
              Drafted for you. Please check before saving.
            </h1>
          </div>
          <button
            type="button"
            onClick={addRow}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] px-4 text-xs font-semibold"
          >
            <Plus className="w-4 h-4 text-[#064E3B] dark:text-[#10B981]" />
            <span>Add Entry</span>
          </button>
        </div>

        {/* Mandatory Review Notice */}
        <div className="rounded-2xl border border-[#064E3B]/25 dark:border-[#10B981]/30 bg-[#064E3B]/5 dark:bg-[#10B981]/10 p-4 flex items-start gap-3">
          <Sparkles className="w-4 h-4 text-[#064E3B] dark:text-[#10B981] mt-0.5 shrink-0" />
          <div className="text-xs text-[#121513] dark:text-[#F4F1EA] space-y-1">
            <p className="font-semibold">
              Nothing is saved yet. Review, edit, remove, or add entries below, then tap Confirm &amp; Save.
            </p>
            {summaryNote && (
              <p className="text-[#5C635D] dark:text-[#9BA39D]">{summaryNote}</p>
            )}
          </div>
        </div>

        {/* Live Totals Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-3.5">
            <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Draft Items</p>
            <p className="mt-1 font-mono-num text-lg font-semibold">{rows.length}</p>
          </div>
          <div className="rounded-xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-3.5">
            <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Money In</p>
            <p className="mt-1 font-mono-num text-lg font-semibold text-[#064E3B] dark:text-[#10B981]">
              {formatKobo(reviewTotals.inKobo, business.currency)}
            </p>
          </div>
          <div className="rounded-xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-3.5">
            <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Money Out</p>
            <p className="mt-1 font-mono-num text-lg font-semibold text-[#B91C1C] dark:text-red-400">
              {formatKobo(reviewTotals.outKobo, business.currency)}
            </p>
          </div>
          <div className="rounded-xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-3.5">
            <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Needs Check</p>
            <p
              className={`mt-1 font-mono-num text-lg font-semibold ${
                reviewTotals.checkCount > 0 ? 'text-[#B45309] dark:text-amber-400' : ''
              }`}
            >
              {reviewTotals.checkCount}
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-[#B91C1C]/30 bg-[#FEF2F2] dark:bg-red-950/30 p-4 text-sm text-[#B91C1C] dark:text-red-300">
            {error}
          </div>
        )}

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-8 text-center space-y-3">
            <p className="font-display text-2xl">All draft entries removed</p>
            <p className="text-sm text-[#5C635D] dark:text-[#9BA39D]">
              Nothing was saved to your cash book. Add a row or speak again.
            </p>
            <div className="flex justify-center gap-2">
              <button
                type="button"
                onClick={addRow}
                className="min-h-[44px] rounded-xl bg-[#064E3B] px-4 text-xs font-semibold text-white"
              >
                + Add Entry
              </button>
              <button
                type="button"
                onClick={() => setStep('capture')}
                className="min-h-[44px] rounded-xl border border-[#DED6C2] dark:border-[#2B352F] px-4 text-xs font-semibold"
              >
                Speak Again
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3.5">
            {rows.map((row, idx) => {
              const amountKobo = parseAmountToKobo(row.amountInput || '0');
              const needsAttention =
                row.ambiguous ||
                row.confidence === 'low' ||
                amountKobo <= 0 ||
                (row.type === 'credit_sale' && !row.customerName.trim());

              return (
                <div
                  key={row.id}
                  data-testid="voice-draft-row"
                  className={`rounded-2xl border bg-white dark:bg-[#151B18] p-4 sm:p-5 space-y-3.5 ${
                    needsAttention
                      ? 'border-[#B45309]/60 dark:border-amber-500/50'
                      : 'border-[#E5DEC9] dark:border-[#242D28]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono-num text-xs font-semibold text-[#5C635D] dark:text-[#9BA39D]">
                        Entry #{idx + 1}
                      </span>
                      {needsAttention && (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-[#FEF3C7] dark:bg-amber-950/50 px-2 py-0.5 text-[11px] font-semibold text-[#92400E] dark:text-amber-300">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Please check</span>
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      aria-label={`Remove entry ${idx + 1}`}
                      className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-xl border border-[#DED6C2] dark:border-[#2B352F] text-[#5C635D] hover:text-[#B91C1C]"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {needsAttention && (
                    <p className="text-xs text-[#92400E] dark:text-amber-300 bg-[#FEF3C7]/60 dark:bg-amber-950/30 rounded-xl px-3 py-2">
                      {row.ambiguityReason ||
                        (amountKobo <= 0
                          ? 'Amount unclear — enter the exact amount before saving.'
                          : row.type === 'credit_sale' && !row.customerName.trim()
                          ? 'Enter customer name for this credit sale.'
                          : 'Low confidence item — verify type and amount.')}
                    </p>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium mb-1 text-[#5C635D] dark:text-[#9BA39D]">
                        Entry Type
                      </label>
                      <select
                        value={row.type}
                        onChange={(e) =>
                          updateRow(row.id, {
                            type: e.target.value as VoiceEntryType,
                            ambiguous: false,
                          })
                        }
                        className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3 py-2 text-xs font-semibold min-h-[44px]"
                      >
                        {Object.entries(ENTRY_TYPE_LABELS).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium mb-1 text-[#5C635D] dark:text-[#9BA39D]">
                        Amount ({business.currency}) *
                      </label>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.amountInput}
                          onChange={(e) =>
                            updateRow(row.id, {
                              amountInput: e.target.value,
                              ambiguous: false,
                            })
                          }
                          placeholder="0.00"
                          className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3 py-2 font-mono-num text-sm font-semibold min-h-[44px]"
                        />
                        <button
                          type="button"
                          onClick={() => setKeypadRowId(row.id)}
                          aria-label={`Open numeric keypad for entry ${idx + 1}`}
                          className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#111714]"
                        >
                          <Keyboard className="w-4 h-4 text-[#064E3B] dark:text-[#10B981]" />
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium mb-1 text-[#5C635D] dark:text-[#9BA39D]">
                        {row.type === 'credit_sale' ? 'Payment Status' : 'Payment Method'}
                      </label>
                      {row.type === 'credit_sale' ? (
                        <div className="rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#111714] px-3 py-2 text-xs text-[#B45309] dark:text-amber-400 font-medium min-h-[44px] flex items-center">
                          Unpaid credit (debt)
                        </div>
                      ) : (
                        <select
                          value={row.paymentMethod}
                          onChange={(e) =>
                            updateRow(row.id, { paymentMethod: e.target.value as PaymentMethod })
                          }
                          className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3 py-2 text-xs min-h-[44px]"
                        >
                          {(['Cash', 'Transfer', 'POS', 'Card', 'Other'] as PaymentMethod[]).map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {row.type === 'expense' && (
                      <div>
                        <label className="block text-[11px] font-medium mb-1 text-[#5C635D] dark:text-[#9BA39D]">
                          Category
                        </label>
                        <select
                          value={row.categoryPreset}
                          onChange={(e) => updateRow(row.id, { categoryPreset: e.target.value })}
                          className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3 py-2 text-xs min-h-[44px]"
                        >
                          {EXPENSE_CATEGORY_PRESETS.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                          <option value="CUSTOM">Custom category…</option>
                        </select>
                        {row.categoryPreset === 'CUSTOM' && (
                          <input
                            type="text"
                            value={row.customCategory}
                            onChange={(e) => updateRow(row.id, { customCategory: e.target.value })}
                            placeholder="Category name"
                            className="mt-2 w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3 py-2 text-xs min-h-[40px]"
                          />
                        )}
                      </div>
                    )}

                    <div>
                      <label className="block text-[11px] font-medium mb-1 text-[#5C635D] dark:text-[#9BA39D]">
                        {row.type === 'expense'
                          ? 'Payee / Supplier'
                          : row.type === 'credit_sale'
                          ? 'Customer Name *'
                          : 'Customer Name'}
                      </label>
                      <input
                        type="text"
                        value={row.customerName}
                        onChange={(e) =>
                          updateRow(row.id, {
                            customerName: e.target.value,
                            ambiguous: false,
                          })
                        }
                        placeholder={
                          row.type === 'credit_sale'
                            ? 'Required (e.g. Mama Ngozi)'
                            : row.type === 'expense'
                            ? 'Optional supplier'
                            : 'Optional customer'
                        }
                        className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3 py-2 text-xs min-h-[44px]"
                      />
                    </div>

                    <div className={row.type === 'expense' ? '' : 'sm:col-span-2'}>
                      <label className="block text-[11px] font-medium mb-1 text-[#5C635D] dark:text-[#9BA39D]">
                        Note / Description
                      </label>
                      <input
                        type="text"
                        value={row.note}
                        onChange={(e) => updateRow(row.id, { note: e.target.value })}
                        placeholder="What was sold, spent, or paid"
                        className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3 py-2 text-xs min-h-[44px]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium mb-1 text-[#5C635D] dark:text-[#9BA39D]">
                        Entry Date
                      </label>
                      <input
                        type="date"
                        value={row.entryDate}
                        onChange={(e) => updateRow(row.id, { entryDate: e.target.value })}
                        className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3 py-2 text-xs min-h-[42px]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium mb-1 text-[#5C635D] dark:text-[#9BA39D]">
                        Sold / Logged by (optional)
                      </label>
                      <input
                        type="text"
                        value={row.soldBy}
                        onChange={(e) => updateRow(row.id, { soldBy: e.target.value })}
                        placeholder="Staff name"
                        className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3 py-2 text-xs min-h-[42px]"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={addRow}
            className="min-h-[46px] inline-flex items-center gap-1.5 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] px-4 text-xs font-semibold"
          >
            <Plus className="w-4 h-4" />
            <span>Add Another Entry</span>
          </button>

          <button
            type="button"
            onClick={handleConfirmSave}
            disabled={saving || rows.length === 0}
            className="min-h-[50px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#064E3B] px-6 text-sm font-semibold text-white hover:bg-[#04392B] disabled:opacity-60"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>
              {saving
                ? 'Saving to Cash Book…'
                : `Confirm & Save (${rows.length} ${rows.length === 1 ? 'entry' : 'entries'})`}
            </span>
          </button>
        </div>

        <NumericKeypad
          open={Boolean(keypadTargetRow)}
          title="Edit drafted amount"
          initialValue={keypadTargetRow?.amountInput || ''}
          mode="currency"
          currency={business.currency}
          onApply={(val) => {
            if (keypadTargetRow) {
              updateRow(keypadTargetRow.id, { amountInput: val, ambiguous: false });
            }
          }}
          onClose={() => setKeypadRowId(null)}
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <Link
          to="/app"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#5C635D] dark:text-[#9BA39D] hover:text-[#121513]"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back Home</span>
        </Link>
        <h1 className="mt-2 font-display text-3xl text-[#121513] dark:text-[#F4F1EA]">
          Speak your day
        </h1>
        <p className="mt-1 text-sm text-[#5C635D] dark:text-[#9BA39D]">
          Say what you sold, spent, or gave on credit in natural English. We draft the entries for you to check — nothing is saved until you confirm.
        </p>
      </div>

      {/* Main Mic Card */}
      <form
        onSubmit={handleDraftEntries}
        className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-5 sm:p-7 space-y-5"
      >
        <div className="flex flex-col items-center text-center space-y-3">
          {voice.supported && voice.status !== 'denied' ? (
            <>
              <button
                type="button"
                onClick={voice.toggle}
                aria-label={voice.listening ? 'Stop recording' : 'Tap to speak your day'}
                className={`relative w-24 h-24 rounded-3xl flex flex-col items-center justify-center gap-1.5 transition-all shadow-sm ${
                  voice.listening
                    ? 'bg-[#B91C1C] text-white ring-8 ring-[#B91C1C]/15'
                    : 'bg-[#064E3B] text-white hover:bg-[#04392B]'
                }`}
              >
                {voice.listening ? (
                  <Square className="w-7 h-7 fill-current" />
                ) : (
                  <Mic className="w-8 h-8" />
                )}
                <span className="text-[11px] font-semibold uppercase tracking-wider">
                  {voice.listening ? 'Stop' : 'Speak'}
                </span>
              </button>

              <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-[#5C635D] dark:text-[#9BA39D]">
                <span>
                  {voice.listening
                    ? `Listening (${voice.activeLang})… speak naturally`
                    : 'Tap the mic to start talking, or type below'}
                </span>
                <button
                  type="button"
                  onClick={() => voice.start(voice.activeLang === 'en-NG' ? 'en-US' : 'en-NG')}
                  className="text-[#064E3B] dark:text-[#10B981] font-medium hover:underline"
                >
                  Switch to {voice.activeLang === 'en-NG' ? 'en-US' : 'en-NG'}
                </button>
              </div>
            </>
          ) : (
            <div
              role="status"
              className="w-full rounded-xl border border-[#B45309]/40 bg-[#FEF3C7]/60 dark:bg-amber-950/30 p-4 text-left space-y-2"
            >
              <div className="flex items-start gap-2.5 text-sm text-[#92400E] dark:text-amber-300">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  {voice.errorMessage ||
                    'Microphone access is unavailable. You can type your summary below or jump straight to a manual form.'}
                </span>
              </div>
            </div>
          )}

          {voice.errorMessage && voice.supported && voice.status !== 'denied' && (
            <p className="text-xs text-[#B91C1C] dark:text-red-400">{voice.errorMessage}</p>
          )}
        </div>

        {/* Live Editable Transcript */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label
              htmlFor="voice-transcript"
              className="text-xs font-semibold text-[#121513] dark:text-[#F4F1EA]"
            >
              Your transcript (live &amp; editable)
            </label>
            {voice.finalTranscript.trim() && (
              <button
                type="button"
                onClick={() => voice.setFinalTranscript('')}
                className="text-xs text-[#5C635D] hover:text-[#B91C1C]"
              >
                Clear
              </button>
            )}
          </div>
          <textarea
            id="voice-transcript"
            rows={4}
            value={voice.finalTranscript}
            onChange={(e) => voice.setFinalTranscript(e.target.value)}
            placeholder='Example: "I spent five thousand on transport and twelve thousand on stock, Mama Ngozi owes me eight thousand, and I sold two bags for twenty thousand cash."'
            className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#111714] px-3.5 py-3 text-sm text-[#121513] dark:text-[#F4F1EA] placeholder:text-[#8B918B] focus:outline-none focus:ring-2 focus:ring-[#064E3B]/30 focus:border-[#064E3B]"
          />
          {voice.interimTranscript && (
            <p className="mt-1.5 text-xs italic text-[#064E3B] dark:text-[#10B981]">
              Hearing: “{voice.interimTranscript}”
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-[#5C635D] dark:text-[#9BA39D]">
            Privacy: only the transcript text above is sent to draft entries. Nothing else leaves your book.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-[#B91C1C]/30 bg-[#FEF2F2] dark:bg-red-950/30 p-4 text-sm text-[#B91C1C] dark:text-red-300 flex items-center justify-between gap-3">
            <p>{error}</p>
            <button
              type="button"
              disabled={drafting}
              onClick={() => handleDraftEntries()}
              className="shrink-0 min-h-[34px] rounded-lg bg-[#B91C1C] px-3 text-xs font-semibold text-white hover:bg-[#991B1B] disabled:opacity-60"
            >
              Retry
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={drafting || combinedLiveText.trim().length < 2}
          className="w-full min-h-[50px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#064E3B] px-5 text-sm font-semibold text-white hover:bg-[#04392B] disabled:opacity-60"
        >
          <Sparkles className="w-4 h-4" />
          <span>{drafting ? 'Drafting entries for review…' : 'Draft Entries to Review'}</span>
        </button>
      </form>

      {/* Manual Forms Fallback */}
      <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-4 sm:p-5 space-y-3">
        <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">
          Or enter manually anytime
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {QUICK_FALLBACK_LINKS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-xl border border-[#DED6C2] dark:border-[#2B352F] px-3 py-2.5 flex items-center gap-2 text-xs font-semibold hover:bg-[#F5F1E7] dark:hover:bg-[#1B231F] min-h-[44px]"
              >
                <Icon className="w-4 h-4 text-[#064E3B] dark:text-[#10B981] shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
