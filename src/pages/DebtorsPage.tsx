import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  MessageCircle,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { NumericKeypad } from '../components/NumericKeypad';
import { SpeechInput } from '../components/SpeechInput';
import { api } from '../lib/api';
import { Link } from '../lib/router';
import {
  formatKobo,
  formatKoboPlainInput,
  formatLagosDateOnly,
  getLagosDateString,
  parseAmountToKobo,
} from '../shared/money';
import type { PaymentMethod } from '../shared/schemas';
import type {
  BusinessProfile,
  CreditorRecord,
  DebtItemSummary,
  DebtorCustomerGroup,
  ReceiptRecord,
} from '../shared/types';
import { isInvoicesQuotesModuleEnabled } from '../shared/v2/entitlements';
import type { ReceivableItem } from '../shared/v2/types';

const V2ReceivablesSection = lazy(() =>
  import('../v2/components/V2ReceivablesSection').then((m) => ({
    default: m.V2ReceivablesSection,
  }))
);

function buildDebtorReminderUrl(
  business: BusinessProfile,
  group: DebtorCustomerGroup
): string {
  const text = [
    `Hello ${group.customerName},`,
    `Polite reminder from *${business.name}* regarding your outstanding balance of *${formatKobo(
      group.totalOwedKobo,
      business.currency
    )}*.`,
    `Please let us know when you would like to settle or transfer. Thank you!`,
  ].join('\n');
  const rawPhone = (group.customerPhone || '').replace(/[^\d+]/g, '');
  if (rawPhone) {
    let digits = rawPhone.replace(/\+/g, '');
    if (digits.startsWith('0') && digits.length === 11) {
      digits = `234${digits.slice(1)}`;
    }
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  }
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

function RecordDebtPaymentModal({
  business,
  group,
  debt,
  onClose,
  onRecorded,
}: {
  business: BusinessProfile;
  group: DebtorCustomerGroup;
  debt: DebtItemSummary;
  onClose: () => void;
  onRecorded: (receipt: ReceiptRecord) => void;
}) {
  const [amountInput, setAmountInput] = useState(() =>
    formatKoboPlainInput(debt.balanceDueKobo)
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Transfer');
  const [soldBy, setSoldBy] = useState('');
  const [note, setNote] = useState('');
  const [issuedDateLagos, setIssuedDateLagos] = useState(() => getLagosDateString());
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

  const amountKobo = parseAmountToKobo(amountInput || '0');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (amountKobo <= 0) {
      setError('Enter a payment amount greater than zero.');
      return;
    }
    if (amountKobo > debt.balanceDueKobo) {
      setError(
        `Amount cannot exceed owed balance (${formatKobo(debt.balanceDueKobo, business.currency)}).`
      );
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.recordDebtPayment({
        debtKind: debt.debtKind,
        debtId: debt.debtId,
        amountKobo,
        paymentMethod,
        note: note.trim(),
        soldBy: soldBy.trim(),
        issuedDateLagos,
      });
      onRecorded(res.receipt);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Unable to record payment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Record debt payment"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-[#E5DEC9] dark:border-[#26302B] bg-[#FAF8F3] dark:bg-[#151B18] p-6 shadow-2xl space-y-4"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="label-caps text-[#064E3B] dark:text-[#10B981]">Record Debt Payment</p>
            <h3 className="mt-1 font-display text-2xl">{group.customerName}</h3>
            <p className="mt-0.5 text-xs text-[#5C635D] dark:text-[#9BA39D]">
              {debt.referenceLabel} · Remaining:{' '}
              <span className="font-mono-num font-semibold text-[#121513] dark:text-[#F4F1EA]">
                {formatKobo(debt.balanceDueKobo, business.currency)}
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
            <label className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Amount Paid</label>
            <button
              type="button"
              onClick={() => setAmountInput(formatKoboPlainInput(debt.balanceDueKobo))}
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
              className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 font-mono-num text-base font-semibold min-h-[44px]"
              required
            />
            <button
              type="button"
              onClick={() => setKeypadOpen(true)}
              className="shrink-0 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3 text-xs font-medium min-h-[44px]"
            >
              Keypad
            </button>
          </div>
        </div>

        <div>
          <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
            Payment Method
          </label>
          <div className="grid grid-cols-5 gap-1.5">
            {(['Cash', 'Transfer', 'POS', 'Card', 'Other'] as PaymentMethod[]).map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => setPaymentMethod(method)}
                className={`min-h-[38px] rounded-xl border text-xs font-medium ${
                  paymentMethod === method
                    ? 'border-[#064E3B] bg-[#064E3B] text-white'
                    : 'border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714]'
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
              Payment Date
            </label>
            <input
              type="date"
              value={issuedDateLagos}
              onChange={(e) => setIssuedDateLagos(e.target.value)}
              className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3 py-2 text-sm min-h-[44px]"
            />
          </div>
          <div>
            <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
              Received by
            </label>
            <SpeechInput value={soldBy} onChangeValue={setSoldBy} placeholder="Staff (optional)" />
          </div>
        </div>

        <div>
          <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
            Note (optional)
          </label>
          <SpeechInput value={note} onChangeValue={setNote} placeholder="Optional payment note" />
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
            {submitting ? 'Recording…' : 'Record & Issue Receipt'}
          </button>
        </div>

        <NumericKeypad
          open={keypadOpen}
          title="Payment amount"
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

export function DebtorsPage({ business }: { business: BusinessProfile }) {
  const v2Enabled = isInvoicesQuotesModuleEnabled(business);
  const [tab, setTab] = useState<'debtors' | 'creditors'>('debtors');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [v2RefreshKey, setV2RefreshKey] = useState(0);

  // Debtors state
  const [debtors, setDebtors] = useState<DebtorCustomerGroup[]>([]);
  const [totalOwedKobo, setTotalOwedKobo] = useState(0);
  const [recentPayments, setRecentPayments] = useState<ReceiptRecord[]>([]);
  const [payModal, setPayModal] = useState<{
    group: DebtorCustomerGroup;
    debt: DebtItemSummary;
  } | null>(null);
  const [lastIssuedReceipt, setLastIssuedReceipt] = useState<ReceiptRecord | null>(null);

  // Creditors state
  const [creditors, setCreditors] = useState<CreditorRecord[]>([]);
  const [showAddCreditor, setShowAddCreditor] = useState(false);
  const [supName, setSupName] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supDesc, setSupDesc] = useState('');
  const [supAmtInput, setSupAmtInput] = useState('');
  const [supDue, setSupDue] = useState('');
  const [supKeypadOpen, setSupKeypadOpen] = useState(false);
  const [savingSup, setSavingSup] = useState(false);

  const [markPaidTarget, setMarkPaidTarget] = useState<CreditorRecord | null>(null);
  const [paidMethod, setPaidMethod] = useState<PaymentMethod>('Transfer');
  const [recordAsExpense, setRecordAsExpense] = useState(true);
  const [markingPaid, setMarkingPaid] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [debRes, credRes] = await Promise.all([api.getDebtors(), api.getCreditors()]);
      setDebtors(debRes.debtors);
      setTotalOwedKobo(debRes.totalOwedKobo);
      setRecentPayments(debRes.recentDebtPayments);
      setCreditors(credRes.creditors);
    } catch (err: any) {
      setError(err?.message || 'Unable to load debtors and creditors');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredDebtors = debtors.filter((g) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      g.customerName.toLowerCase().includes(q) ||
      g.customerPhone.toLowerCase().includes(q) ||
      g.debts.some((d) => d.description.toLowerCase().includes(q))
    );
  });

  const handleAddCreditor = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountKobo = parseAmountToKobo(supAmtInput || '0');
    if (!supName.trim() || amountKobo <= 0) {
      setError('Supplier name and positive amount are required.');
      return;
    }
    setSavingSup(true);
    setError(null);
    try {
      await api.createCreditor({
        supplierName: supName.trim(),
        phone: supPhone.trim(),
        description: supDesc.trim(),
        amountKobo,
        dueDate: supDue || '',
      });
      setSupName('');
      setSupPhone('');
      setSupDesc('');
      setSupAmtInput('');
      setSupDue('');
      setShowAddCreditor(false);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Unable to save supplier payable');
    } finally {
      setSavingSup(false);
    }
  };

  const handleConfirmMarkPaid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!markPaidTarget) return;
    setMarkingPaid(true);
    setError(null);
    try {
      await api.markCreditorPaid(markPaidTarget.id, {
        paymentMethod: paidMethod,
        recordAsExpense,
        entryDate: getLagosDateString(),
      });
      setMarkPaidTarget(null);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Unable to mark supplier paid');
    } finally {
      setMarkingPaid(false);
    }
  };

  const handleDeleteCreditor = async (id: string) => {
    try {
      await api.deleteCreditor(id);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Unable to delete creditor');
    }
  };

  const unpaidCreditorsTotal = creditors
    .filter((c) => c.status === 'UNPAID')
    .reduce((s, c) => s + c.amountKobo, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Receivables &amp; Payables</p>
          <h1 className="mt-1 font-display text-3xl text-[#121513] dark:text-[#F4F1EA]">
            Debtors &amp; Creditors
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/app/credit-sale"
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-[#064E3B] px-4 py-2 text-xs font-semibold text-white hover:bg-[#04392B]"
          >
            <Plus className="w-4 h-4" />
            <span>New Credit Sale</span>
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="inline-flex rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#F5F1E7] dark:bg-[#111714] p-1">
        <button
          type="button"
          onClick={() => setTab('debtors')}
          className={`min-h-[40px] rounded-lg px-4 text-xs font-semibold transition-colors ${
            tab === 'debtors'
              ? 'bg-[#064E3B] text-white'
              : 'text-[#5C635D] dark:text-[#9BA39D]'
          }`}
        >
          Customers Owing ({debtors.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('creditors')}
          className={`min-h-[40px] rounded-lg px-4 text-xs font-semibold transition-colors ${
            tab === 'creditors'
              ? 'bg-[#064E3B] text-white'
              : 'text-[#5C635D] dark:text-[#9BA39D]'
          }`}
        >
          Suppliers We Owe ({creditors.filter((c) => c.status === 'UNPAID').length})
        </button>
      </div>

      {lastIssuedReceipt && (
        <div className="rounded-xl border border-[#064E3B]/30 bg-[#064E3B]/5 dark:bg-[#10B981]/10 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-sm">
            <CheckCircle2 className="w-5 h-5 text-[#064E3B] dark:text-[#10B981] shrink-0" />
            <span>
              Payment recorded — Receipt{' '}
              <strong className="font-mono-num">{lastIssuedReceipt.receiptNumber}</strong> (
              {formatKobo(lastIssuedReceipt.totalKobo, business.currency)}) issued.
            </span>
          </div>
          <Link
            to={`/app/receipts/${lastIssuedReceipt.id}`}
            className="text-xs font-semibold text-[#064E3B] dark:text-[#10B981] underline"
          >
            View / Share Receipt
          </Link>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-[#B91C1C]/30 bg-[#FEF2F2] dark:bg-red-950/30 p-4 text-sm text-[#B91C1C] dark:text-red-300">
          {error}
        </div>
      )}

      {tab === 'debtors' ? (
        v2Enabled ? (
          <div className="space-y-5">
            <Suspense
              fallback={
                <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-8 text-center text-xs text-[#5C635D] dark:text-[#9BA39D]">
                  Loading unpaid balances…
                </div>
              }
            >
              <V2ReceivablesSection
                key={v2RefreshKey}
                business={business}
                onRecordPayment={(item: ReceivableItem) => {
                  const debtKind: 'CREDIT_SALE' | 'RECEIPT' =
                    item.sourceType === 'RECEIPT' ? 'RECEIPT' : 'CREDIT_SALE';
                  const debt: DebtItemSummary = {
                    debtKind,
                    debtId: item.sourceId,
                    referenceLabel: item.referenceNumber,
                    description: item.referenceNumber,
                    issuedDateLagos: item.issueDate,
                    dueDate: item.dueDate || '',
                    totalKobo: item.totalKobo,
                    amountPaidKobo: item.amountPaidKobo,
                    balanceDueKobo: item.balanceDueKobo,
                  };
                  const group: DebtorCustomerGroup = {
                    customerKey: item.customerId || item.customerName.toLowerCase(),
                    customerName: item.customerName,
                    customerPhone: item.customerPhone,
                    totalOwedKobo: item.balanceDueKobo,
                    oldestDebtDate: item.issueDate,
                    oldestDebtAgeDays: Math.max(0, item.daysOverdue),
                    debts: [debt],
                  };
                  setPayModal({ group, debt });
                }}
              />
            </Suspense>

            {recentPayments.length > 0 && (
              <section className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#ECE6D8] dark:border-[#242D28]">
                  <h2 className="text-sm font-semibold">Recent Debt Payments Received</h2>
                </div>
                <div className="divide-y divide-[#ECE6D8] dark:divide-[#242D28]">
                  {recentPayments.map((r) => (
                    <Link
                      key={r.id}
                      to={`/app/receipts/${r.id}`}
                      className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-[#FAF8F3] dark:hover:bg-[#1B231F]"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          <span className="font-mono-num font-semibold">{r.receiptNumber}</span> ·{' '}
                          {r.customerName || 'Customer'}
                        </p>
                        <p className="text-xs text-[#5C635D] dark:text-[#9BA39D]">
                          {formatLagosDateOnly(r.issuedDateLagos)} · {r.paymentMethod}
                        </p>
                      </div>
                      <span className="font-mono-num text-sm font-semibold text-[#064E3B] dark:text-[#10B981]">
                        +{formatKobo(r.totalKobo, business.currency)}
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-5">
              <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Total Owed to Business</p>
              <p className="mt-2 font-mono-num text-3xl font-semibold text-[#B45309] dark:text-amber-400">
                {loading ? '—' : formatKobo(totalOwedKobo, business.currency)}
              </p>
            </div>
            <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-5 flex items-center">
              <div className="relative w-full">
                <Search className="w-4 h-4 text-[#8B918B] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search debtor by name, phone, or item…"
                  className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#111714] pl-10 pr-3.5 py-2.5 text-sm min-h-[44px]"
                />
              </div>
            </div>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-2xl bg-[#F3EFE6] dark:bg-[#1B231F] animate-pulse" />
              ))}
            </div>
          ) : filteredDebtors.length === 0 ? (
            <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-8 text-center space-y-2">
              <div className="mx-auto w-11 h-11 rounded-2xl bg-[#F3EFE6] dark:bg-[#1B231F] flex items-center justify-center text-[#064E3B] dark:text-[#10B981]">
                <Users className="w-5 h-5" />
              </div>
              <p className="font-display text-2xl">No customers owe right now</p>
              <p className="text-sm text-[#5C635D] dark:text-[#9BA39D]">
                Part-paid receipts and credit sales automatically appear here until settled.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredDebtors.map((group) => (
                <div
                  key={group.customerKey}
                  className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] overflow-hidden"
                >
                  <div className="px-5 py-4 border-b border-[#ECE6D8] dark:border-[#242D28] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold">{group.customerName}</h2>
                        {group.customerPhone && (
                          <span className="font-mono-num text-xs text-[#5C635D] dark:text-[#9BA39D]">
                            {group.customerPhone}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[#5C635D] dark:text-[#9BA39D]">
                        <Clock className="w-3.5 h-3.5" />
                        <span>
                          Oldest debt:{' '}
                          {group.oldestDebtAgeDays === 0
                            ? 'Today'
                            : `${group.oldestDebtAgeDays} day${group.oldestDebtAgeDays === 1 ? '' : 's'} ago`}{' '}
                          ({formatLagosDateOnly(group.oldestDebtDate)})
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-left sm:text-right">
                        <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Total Owed</p>
                        <p className="font-mono-num text-lg font-semibold text-[#B45309] dark:text-amber-400">
                          {formatKobo(group.totalOwedKobo, business.currency)}
                        </p>
                      </div>
                      <a
                        href={buildDebtorReminderUrl(business, group)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-[#064E3B] dark:border-[#10B981] px-3 py-2 text-xs font-semibold text-[#064E3B] dark:text-[#10B981] hover:bg-[#064E3B] hover:text-white transition-colors whitespace-nowrap"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        <span>Remind</span>
                      </a>
                    </div>
                  </div>

                  <div className="divide-y divide-[#ECE6D8] dark:divide-[#242D28]">
                    {group.debts.map((debt) => (
                      <div
                        key={`${debt.debtKind}-${debt.debtId}`}
                        className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="font-mono-num font-semibold text-xs text-[#064E3B] dark:text-[#10B981]">
                              {debt.referenceLabel}
                            </span>
                            <span className="truncate font-medium">{debt.description}</span>
                          </div>
                          <p className="mt-0.5 text-xs text-[#5C635D] dark:text-[#9BA39D] font-mono-num">
                            Total {formatKobo(debt.totalKobo, business.currency)} · Paid{' '}
                            {formatKobo(debt.amountPaidKobo, business.currency)} · Owing{' '}
                            <strong className="text-[#121513] dark:text-[#F4F1EA]">
                              {formatKobo(debt.balanceDueKobo, business.currency)}
                            </strong>
                            {debt.dueDate ? ` · Due ${debt.dueDate}` : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPayModal({ group, debt })}
                          className="shrink-0 min-h-[40px] rounded-xl bg-[#064E3B] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#04392B] whitespace-nowrap"
                        >
                          Record Payment
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {recentPayments.length > 0 && (
            <section className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#ECE6D8] dark:border-[#242D28]">
                <h2 className="text-sm font-semibold">Recent Debt Payments Received</h2>
              </div>
              <div className="divide-y divide-[#ECE6D8] dark:divide-[#242D28]">
                {recentPayments.map((r) => (
                  <Link
                    key={r.id}
                    to={`/app/receipts/${r.id}`}
                    className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-[#FAF8F3] dark:hover:bg-[#1B231F]"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        <span className="font-mono-num font-semibold">{r.receiptNumber}</span> ·{' '}
                        {r.customerName || 'Customer'}
                      </p>
                      <p className="text-xs text-[#5C635D] dark:text-[#9BA39D]">
                        {formatLagosDateOnly(r.issuedDateLagos)} · {r.paymentMethod}
                      </p>
                    </div>
                    <span className="font-mono-num text-sm font-semibold text-[#064E3B] dark:text-[#10B981]">
                      +{formatKobo(r.totalKobo, business.currency)}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
        )
      ) : (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-5">
            <div>
              <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Unpaid Supplier Bills</p>
              <p className="mt-1 font-mono-num text-3xl font-semibold">
                {formatKobo(unpaidCreditorsTotal, business.currency)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddCreditor((v) => !v)}
              className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-[#064E3B] px-4 py-2 text-xs font-semibold text-white hover:bg-[#04392B]"
            >
              <Plus className="w-4 h-4" />
              <span>Add Supplier Bill</span>
            </button>
          </div>

          {showAddCreditor && (
            <form
              onSubmit={handleAddCreditor}
              className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-5 space-y-4"
            >
              <h2 className="font-display text-2xl">Add Creditor / Supplier Bill</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1">
                    Supplier Name *
                  </label>
                  <SpeechInput
                    value={supName}
                    onChangeValue={setSupName}
                    placeholder="e.g. Chidi Wholesale Ltd"
                    required
                  />
                </div>
                <div>
                  <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1">
                    Phone (optional)
                  </label>
                  <input
                    type="tel"
                    value={supPhone}
                    onChange={(e) => setSupPhone(e.target.value)}
                    placeholder="0803 000 0000"
                    className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 font-mono-num text-sm min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1">
                    Amount Owed *
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={supAmtInput}
                      onChange={(e) => setSupAmtInput(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 font-mono-num text-sm font-semibold min-h-[44px]"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setSupKeypadOpen(true)}
                      className="shrink-0 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] px-3 text-xs font-medium min-h-[44px]"
                    >
                      Keypad
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1">
                    Due Date (optional)
                  </label>
                  <input
                    type="date"
                    value={supDue}
                    onChange={(e) => setSupDue(e.target.value)}
                    className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 text-sm min-h-[44px]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1">
                    What we owe for
                  </label>
                  <SpeechInput
                    value={supDesc}
                    onChangeValue={setSupDesc}
                    placeholder="e.g. 20 cartons cooking oil"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddCreditor(false)}
                  className="min-h-[42px] rounded-xl border border-[#DED6C2] dark:border-[#2B352F] px-4 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingSup}
                  className="min-h-[42px] rounded-xl bg-[#064E3B] px-5 text-xs font-semibold text-white"
                >
                  {savingSup ? 'Saving…' : 'Save Supplier Bill'}
                </button>
              </div>
            </form>
          )}

          {creditors.length === 0 ? (
            <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-8 text-center text-sm text-[#5C635D] dark:text-[#9BA39D]">
              No supplier bills logged yet. Track what your business owes suppliers here.
            </div>
          ) : (
            <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] divide-y divide-[#ECE6D8] dark:divide-[#242D28]">
              {creditors.map((c) => (
                <div
                  key={c.id}
                  className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{c.supplierName}</span>
                      <span
                        className={`text-[11px] font-semibold uppercase ${
                          c.status === 'PAID'
                            ? 'text-[#064E3B] dark:text-[#10B981]'
                            : 'text-[#B45309] dark:text-amber-400'
                        }`}
                      >
                        {c.status}
                      </span>
                    </div>
                    <p className="text-xs text-[#5C635D] dark:text-[#9BA39D]">
                      {c.description || 'Supplier invoice'}
                      {c.dueDate ? ` · Due ${c.dueDate}` : ''}
                      {c.phone ? ` · ${c.phone}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono-num text-sm font-semibold">
                      {formatKobo(c.amountKobo, business.currency)}
                    </span>
                    {c.status === 'UNPAID' && (
                      <button
                        type="button"
                        onClick={() => setMarkPaidTarget(c)}
                        className="min-h-[38px] rounded-xl bg-[#064E3B] px-3 text-xs font-semibold text-white hover:bg-[#04392B]"
                      >
                        Mark Paid
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteCreditor(c.id)}
                      aria-label="Delete creditor"
                      className="min-w-[38px] min-h-[38px] inline-flex items-center justify-center rounded-xl border border-[#DED6C2] dark:border-[#2B352F] text-[#5C635D] hover:text-[#B91C1C]"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {payModal && (
        <RecordDebtPaymentModal
          business={business}
          group={payModal.group}
          debt={payModal.debt}
          onClose={() => setPayModal(null)}
          onRecorded={(receipt) => {
            setLastIssuedReceipt(receipt);
            setV2RefreshKey((k) => k + 1);
            load();
          }}
        />
      )}

      {markPaidTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setMarkPaidTarget(null);
          }}
        >
          <form
            onSubmit={handleConfirmMarkPaid}
            className="w-full max-w-md rounded-2xl border border-[#E5DEC9] dark:border-[#26302B] bg-[#FAF8F3] dark:bg-[#151B18] p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="label-caps text-[#064E3B] dark:text-[#10B981]">Settle Supplier Bill</p>
                <h3 className="mt-1 font-display text-2xl">{markPaidTarget.supplierName}</h3>
                <p className="text-sm font-mono-num font-semibold mt-1">
                  {formatKobo(markPaidTarget.amountKobo, business.currency)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMarkPaidTarget(null)}
                className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-xl border border-[#DED6C2] dark:border-[#2B352F]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
                Paid With
              </label>
              <div className="grid grid-cols-5 gap-1.5">
                {(['Cash', 'Transfer', 'POS', 'Card', 'Other'] as PaymentMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPaidMethod(m)}
                    className={`min-h-[38px] rounded-xl border text-xs font-medium ${
                      paidMethod === m
                        ? 'border-[#064E3B] bg-[#064E3B] text-white'
                        : 'border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714]'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2.5 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={recordAsExpense}
                onChange={(e) => setRecordAsExpense(e.target.checked)}
                className="w-4 h-4 accent-[#064E3B]"
              />
              <span>Also record as an Expense in today’s Cash Book</span>
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setMarkPaidTarget(null)}
                className="min-h-[44px] rounded-xl border border-[#DED6C2] dark:border-[#2B352F] px-4 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={markingPaid}
                className="min-h-[44px] rounded-xl bg-[#064E3B] px-5 text-sm font-semibold text-white"
              >
                {markingPaid ? 'Saving…' : 'Confirm Paid'}
              </button>
            </div>
          </form>
        </div>
      )}

      <NumericKeypad
        open={supKeypadOpen}
        title="Supplier bill amount"
        initialValue={supAmtInput}
        mode="currency"
        currency={business.currency}
        onApply={setSupAmtInput}
        onClose={() => setSupKeypadOpen(false)}
      />
    </div>
  );
}
