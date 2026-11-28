import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { Link, useRouter } from '../../lib/router';
import {
  formatKobo,
  formatKoboPlainInput,
  getLagosDateString,
  parseAmountToKobo,
} from '../../shared/money';
import type {
  BusinessProfile,
  CatalogItemSuggestion,
  CustomerSuggestion,
} from '../../shared/types';
import {
  calculateV2DocumentTotals,
  computeDueDate,
  formatQtyThousandths,
  parseQtyToThousandths,
  type DepositType,
  type PaymentTermsKind,
} from '../../shared/v2/money';
import type { BankAccount } from '../../shared/v2/types';
import { v2Api } from '../api';

interface LineFormRow {
  key: string;
  description: string;
  qtyText: string;
  unitPriceText: string;
  discountText: string;
}

function makeEmptyLine(): LineFormRow {
  return {
    key: `line-${Math.random().toString(36).slice(2, 9)}`,
    description: '',
    qtyText: '1',
    unitPriceText: '',
    discountText: '',
  };
}

export function InvoiceEditorPage({
  business,
  invoiceId,
  onBusinessUpdated,
}: {
  business: BusinessProfile;
  invoiceId?: string;
  onBusinessUpdated?: (biz: BusinessProfile) => void;
}) {
  const { navigate } = useRouter();
  const idempotencyKeyRef = useRef(
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? `inv-${crypto.randomUUID()}`
      : `inv-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  const [customers, setCustomers] = useState<CustomerSuggestion[]>([]);
  const [catalog, setCatalog] = useState<CatalogItemSuggestion[]>([]);
  const [loadingDraft, setLoadingDraft] = useState(Boolean(invoiceId));

  // Primary fields (<= 5 before "More details")
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [lines, setLines] = useState<LineFormRow[]>([makeEmptyLine()]);
  const [termsKind, setTermsKind] = useState<PaymentTermsKind>(() => {
    const d = business.defaultPaymentTermsDays ?? 7;
    if (d === 0) return 'due_on_receipt';
    if (d === 7) return 'net_7';
    if (d === 14) return 'net_14';
    if (d === 30) return 'net_30';
    return 'net_7';
  });
  const [customDueDate, setCustomDueDate] = useState(() =>
    computeDueDate(getLagosDateString(), 'net_7')
  );
  const [selectedBankIds, setSelectedBankIds] = useState<string[]>(() =>
    (business.bankAccounts || []).map((b) => b.id)
  );

  // First-invoice inline bank details setup (requested at first invoice, not at signup)
  const [showQuickBank, setShowQuickBank] = useState(false);
  const [qbBankName, setQbBankName] = useState('');
  const [qbAccountNumber, setQbAccountNumber] = useState('');
  const [qbAccountName, setQbAccountName] = useState(business.name);
  const [savingBank, setSavingBank] = useState(false);

  // Advanced fields behind "More details"
  const [showMore, setShowMore] = useState(false);
  const [issueDate, setIssueDate] = useState(() => getLagosDateString());
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [invoiceDiscountText, setInvoiceDiscountText] = useState('');
  const [depositType, setDepositType] = useState<DepositType>('none');
  const [depositInputText, setDepositInputText] = useState('');
  const [notes, setNotes] = useState(business.defaultInvoiceNotes || '');
  const [template, setTemplate] = useState(business.defaultTemplate || 'modern');

  const [submitting, setSubmitting] = useState<'draft' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSuggestions()
      .then((res) => {
        setCustomers(res.customers || []);
        setCatalog(res.items || []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!invoiceId) return;
    setLoadingDraft(true);
    v2Api
      .getInvoice(invoiceId)
      .then(({ invoice }) => {
        if (invoice.status !== 'DRAFT') {
          navigate(`/app/invoices/${invoice.id}`, { replace: true });
          return;
        }
        setCustomerId(invoice.customerId);
        setCustomerName(invoice.customerName);
        setCustomerPhone(invoice.customerPhone);
        setCustomerEmail(invoice.customerEmail);
        setCustomerAddress(invoice.customerAddress);
        setIssueDate(invoice.issueDate);
        setTermsKind(invoice.termsKind);
        setCustomDueDate(invoice.dueDate);
        setLines(
          invoice.lines.length
            ? invoice.lines.map((l) => ({
                key: l.id || `l-${Math.random()}`,
                description: l.description,
                qtyText: formatQtyThousandths(l.qtyThousandths),
                unitPriceText: formatKoboPlainInput(l.unitPriceKobo),
                discountText: l.discountKobo > 0 ? formatKoboPlainInput(l.discountKobo) : '',
              }))
            : [makeEmptyLine()]
        );
        setInvoiceDiscountText(
          invoice.invoiceDiscountKobo > 0 ? formatKoboPlainInput(invoice.invoiceDiscountKobo) : ''
        );
        setDepositType(invoice.depositType);
        setDepositInputText(
          invoice.depositType === 'percent'
            ? String(invoice.depositValue / 100)
            : invoice.depositType === 'fixed'
            ? formatKoboPlainInput(invoice.depositValue)
            : ''
        );
        setNotes(invoice.notes || '');
        setSelectedBankIds(invoice.bankAccountIds || []);
        setTemplate(invoice.template || business.defaultTemplate);
      })
      .catch((err: any) => setError(err?.message || 'Unable to load draft'))
      .finally(() => setLoadingDraft(false));
  }, [invoiceId, business.defaultTemplate, navigate]);

  const parsedLines = useMemo(
    () =>
      lines.map((l) => ({
        description: l.description.trim(),
        qtyThousandths: Math.max(0, parseQtyToThousandths(l.qtyText)),
        unitPriceKobo: parseAmountToKobo(l.unitPriceText),
        discountKobo: parseAmountToKobo(l.discountText),
      })),
    [lines]
  );

  const depositValue = useMemo(() => {
    if (depositType === 'percent') {
      const pct = Number.parseFloat(depositInputText) || 0;
      return Math.max(0, Math.min(10000, Math.round(pct * 100)));
    }
    if (depositType === 'fixed') {
      return parseAmountToKobo(depositInputText);
    }
    return 0;
  }, [depositType, depositInputText]);

  const totals = useMemo(() => {
    const valid = parsedLines.filter((l) => l.qtyThousandths > 0);
    return calculateV2DocumentTotals({
      lines: valid.length ? valid : [{ description: 'Item', qtyThousandths: 1000, unitPriceKobo: 0 }],
      invoiceDiscountKobo: parseAmountToKobo(invoiceDiscountText),
      vatEnabled: business.vatEnabled,
      vatMode: business.vatMode,
      vatRateBps: business.vatRateBps,
      depositType,
      depositValue,
    });
  }, [
    parsedLines,
    invoiceDiscountText,
    business.vatEnabled,
    business.vatMode,
    business.vatRateBps,
    depositType,
    depositValue,
  ]);

  const effectiveDueDate = computeDueDate(issueDate, termsKind, customDueDate);

  const pickCustomer = (c: CustomerSuggestion) => {
    setCustomerId(c.id);
    setCustomerName(c.name);
    setCustomerPhone(c.phone || '');
  };

  const pickCatalogItem = (item: CatalogItemSuggestion) => {
    setLines((prev) => {
      const emptyIdx = prev.findIndex((r) => !r.description.trim() && !r.unitPriceText.trim());
      const nextRow: LineFormRow = {
        key: `cat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        description: item.description,
        qtyText: '1',
        unitPriceText: formatKoboPlainInput(item.unitPriceKobo),
        discountText: '',
      };
      if (emptyIdx >= 0) {
        const copy = [...prev];
        copy[emptyIdx] = nextRow;
        return copy;
      }
      return [...prev, nextRow];
    });
  };

  const handleQuickAddBank = async () => {
    if (!qbBankName.trim() || !qbAccountName.trim() || qbAccountNumber.trim().length < 6) {
      setError('Enter bank name, account name, and account number.');
      return;
    }
    setSavingBank(true);
    setError(null);
    try {
      const newBank: BankAccount = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `bank-${Date.now()}`,
        bankName: qbBankName.trim(),
        accountName: qbAccountName.trim(),
        accountNumber: qbAccountNumber.trim(),
        isDefault: true,
      };
      const updatedBanks = [...(business.bankAccounts || []), newBank];
      const res = await v2Api.updateBillingSettings({ bankAccounts: updatedBanks });
      onBusinessUpdated?.(res.business);
      setSelectedBankIds((prev) => [...prev, newBank.id]);
      setQbBankName('');
      setQbAccountNumber('');
      setShowQuickBank(false);
    } catch (err: any) {
      setError(err?.message || 'Unable to save bank account');
    } finally {
      setSavingBank(false);
    }
  };

  const handleSubmit = async (sendNow: boolean) => {
    setError(null);
    if (!customerName.trim()) {
      setError('Select or enter a customer name.');
      return;
    }
    const cleanLines = parsedLines.filter((l) => l.description.length > 0 && l.qtyThousandths > 0);
    if (cleanLines.length === 0) {
      setError('Add at least one item with a description and quantity.');
      return;
    }
    if (sendNow && totals.totalKobo <= 0) {
      setError('Invoice total must be greater than zero before sending.');
      return;
    }

    setSubmitting(sendNow ? 'send' : 'draft');
    try {
      const res = await v2Api.saveInvoice({
        invoiceId: invoiceId || null,
        customerId,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        customerEmail: customerEmail.trim(),
        customerAddress: customerAddress.trim(),
        issueDate,
        termsKind,
        dueDate: effectiveDueDate,
        lines: cleanLines,
        invoiceDiscountKobo: parseAmountToKobo(invoiceDiscountText),
        depositType,
        depositValue,
        notes: notes.trim(),
        bankAccountIds: selectedBankIds,
        template,
        idempotencyKey: idempotencyKeyRef.current,
        sendNow,
      });
      navigate(`/app/invoices/${res.invoice.id}`, { replace: true });
    } catch (err: any) {
      setError(err?.message || 'Unable to save invoice');
    } finally {
      setSubmitting(null);
    }
  };

  if (loadingDraft) {
    return <div className="py-16 text-center text-xs text-[#6B7280]">Loading draft…</div>;
  }

  const banks = business.bankAccounts || [];

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/app/documents"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6B7280] hover:text-[#111827] dark:hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Documents</span>
        </Link>
        <span className="font-mono text-xs text-[#6B7280]">
          Next #{business.invoicePrefix || 'INV-'}
          {String(business.nextInvoiceSequence || 1).padStart(4, '0')}
        </span>
      </div>

      <div>
        <h1 className="font-display text-3xl sm:text-4xl">
          {invoiceId ? 'Edit Invoice Draft' : 'New Invoice'}
        </h1>
        <p className="mt-1 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
          Invoices track what is owed. Money enters your cash book only when a payment is recorded.
        </p>
      </div>

      {error && (
        <div className="rounded-[10px] border border-[#B91C1C]/30 bg-[#FEF2F2] dark:bg-red-950/30 p-3.5 text-xs text-[#B91C1C] dark:text-red-300">
          {error}
        </div>
      )}

      {/* 1. Customer */}
      <section className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 space-y-3">
        <label className="block text-xs font-semibold">1. Customer</label>
        {customers.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {customers.slice(0, 6).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pickCustomer(c)}
                className={`rounded-[10px] border px-3 py-1.5 text-xs font-medium min-h-[36px] transition-colors ${
                  customerId === c.id
                    ? 'border-[#064E3B] bg-[#064E3B] text-white'
                    : 'border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715]'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
        <input
          type="text"
          value={customerName}
          onChange={(e) => {
            setCustomerName(e.target.value);
            setCustomerId(null);
          }}
          placeholder="Customer or company name"
          className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3.5 py-2.5 text-sm min-h-[44px]"
        />
      </section>

      {/* 2. Line Items */}
      <section className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold">2. Items</label>
          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, makeEmptyLine()])}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#064E3B] dark:text-[#6EE7B7]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add item</span>
          </button>
        </div>

        {catalog.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {catalog.slice(0, 5).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => pickCatalogItem(item)}
                className="rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 py-1.5 text-xs hover:border-[#064E3B] min-h-[34px]"
              >
                {item.description} ·{' '}
                <span className="font-mono">{formatKobo(item.unitPriceKobo, business.currency)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="space-y-2.5">
          {lines.map((row, idx) => (
            <div
              key={row.key}
              className="rounded-[10px] border border-gray-100 dark:border-[#1F2925] bg-[#F6F7F8] dark:bg-[#111715] p-3 space-y-2"
            >
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={row.description}
                  onChange={(e) =>
                    setLines((prev) =>
                      prev.map((l, i) => (i === idx ? { ...l, description: e.target.value } : l))
                    )
                  }
                  placeholder="Item or service description"
                  className="flex-1 rounded-lg border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3 py-2 text-sm min-h-[40px]"
                />
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                    aria-label="Remove line"
                    className="p-2 text-[#6B7280] hover:text-[#B91C1C]"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <label className="text-[11px] text-[#6B7280] space-y-0.5">
                  <span>Qty (up to 3 decimals)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.qtyText}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l, i) => (i === idx ? { ...l, qtyText: e.target.value } : l))
                      )
                    }
                    className="w-full rounded-lg border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-2.5 py-2 text-xs font-mono text-[#111827] dark:text-[#F3F4F6] min-h-[38px]"
                  />
                </label>
                <label className="text-[11px] text-[#6B7280] space-y-0.5">
                  <span>Unit price (₦)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.unitPriceText}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l, i) =>
                          i === idx ? { ...l, unitPriceText: e.target.value } : l
                        )
                      )
                    }
                    placeholder="0.00"
                    className="w-full rounded-lg border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-2.5 py-2 text-xs font-mono text-[#111827] dark:text-[#F3F4F6] min-h-[38px]"
                  />
                </label>
                {showMore && (
                  <label className="text-[11px] text-[#6B7280] space-y-0.5 col-span-2 sm:col-span-1">
                    <span>Line discount (₦)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={row.discountText}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l, i) =>
                            i === idx ? { ...l, discountText: e.target.value } : l
                          )
                        )
                      }
                      placeholder="0.00"
                      className="w-full rounded-lg border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-2.5 py-2 text-xs font-mono text-[#111827] dark:text-[#F3F4F6] min-h-[38px]"
                    />
                  </label>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 3. Payment Terms */}
      <section className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold">3. Payment terms</label>
          <span className="font-mono text-xs text-[#6B7280]">Due {effectiveDueDate}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: 'due_on_receipt', label: 'Due on receipt' },
              { id: 'net_7', label: '7 days' },
              { id: 'net_14', label: '14 days' },
              { id: 'net_30', label: '30 days' },
              { id: 'custom', label: 'Custom date' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTermsKind(t.id)}
              className={`rounded-[10px] border px-3 py-2 text-xs font-medium min-h-[38px] ${
                termsKind === t.id
                  ? 'border-[#064E3B] bg-[#064E3B] text-white'
                  : 'border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {termsKind === 'custom' && (
          <input
            type="date"
            value={customDueDate}
            min={issueDate}
            onChange={(e) => setCustomDueDate(e.target.value)}
            className="rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 py-2 text-sm font-mono min-h-[42px]"
          />
        )}
      </section>

      {/* 4. Bank Accounts to Show (First-invoice setup prompt when empty) */}
      <section className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold">4. Bank details on invoice</label>
          <button
            type="button"
            onClick={() => setShowQuickBank((v) => !v)}
            className="text-xs font-semibold text-[#064E3B] dark:text-[#6EE7B7] hover:underline"
          >
            {showQuickBank ? 'Close' : '+ Add bank account'}
          </button>
        </div>

        {banks.length === 0 && !showQuickBank && (
          <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
            No bank account saved yet. Add one so your customer can copy your account number straight from the invoice.
          </p>
        )}

        {banks.length > 0 && (
          <div className="space-y-1.5">
            {banks.map((b) => {
              const checked = selectedBankIds.includes(b.id);
              return (
                <label
                  key={b.id}
                  className="flex items-center justify-between gap-3 rounded-[10px] border border-gray-200/70 dark:border-[#1F2925] bg-[#F6F7F8] dark:bg-[#111715] px-3.5 py-2.5 text-xs cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelectedBankIds((prev) =>
                          checked ? prev.filter((id) => id !== b.id) : [...prev, b.id]
                        )
                      }
                      className="w-4 h-4 accent-[#064E3B]"
                    />
                    <span className="font-semibold truncate">{b.bankName}</span>
                    <span className="text-[#6B7280] truncate">{b.accountName}</span>
                  </div>
                  <span className="font-mono font-semibold shrink-0">{b.accountNumber}</span>
                </label>
              );
            })}
          </div>
        )}

        {showQuickBank && (
          <div className="rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] p-3.5 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                placeholder="Bank name"
                value={qbBankName}
                onChange={(e) => setQbBankName(e.target.value)}
                className="rounded-lg border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3 py-2 text-xs min-h-[40px]"
              />
              <input
                type="text"
                placeholder="Account number"
                value={qbAccountNumber}
                onChange={(e) => setQbAccountNumber(e.target.value)}
                className="rounded-lg border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3 py-2 text-xs font-mono min-h-[40px]"
              />
              <input
                type="text"
                placeholder="Account name"
                value={qbAccountName}
                onChange={(e) => setQbAccountName(e.target.value)}
                className="rounded-lg border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3 py-2 text-xs min-h-[40px]"
              />
            </div>
            <button
              type="button"
              onClick={handleQuickAddBank}
              disabled={savingBank}
              className="rounded-[10px] bg-[#064E3B] px-4 py-2 text-xs font-semibold text-white min-h-[38px]"
            >
              {savingBank ? 'Saving…' : 'Save bank account'}
            </button>
          </div>
        )}
      </section>

      {/* Collapsible More Details */}
      <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] overflow-hidden">
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="w-full px-5 py-3.5 flex items-center justify-between text-xs font-semibold text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-white"
        >
          <span>More details (discount, deposit, address, notes)</span>
          {showMore ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showMore && (
          <div className="px-5 pb-5 pt-2 border-t border-gray-100 dark:border-[#1F2925] space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-xs space-y-1">
                <span className="font-medium">Issue date</span>
                <input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 py-2 text-xs font-mono min-h-[42px]"
                />
              </label>
              <label className="block text-xs space-y-1">
                <span className="font-medium">Invoice discount before VAT (₦)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={invoiceDiscountText}
                  onChange={(e) => setInvoiceDiscountText(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 py-2 text-xs font-mono min-h-[42px]"
                />
              </label>
              <label className="block text-xs space-y-1">
                <span className="font-medium">Deposit requested (&ldquo;Amount due now&rdquo;)</span>
                <div className="flex gap-2">
                  <select
                    value={depositType}
                    onChange={(e) => setDepositType(e.target.value as DepositType)}
                    className="rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-2.5 py-2 text-xs min-h-[42px]"
                  >
                    <option value="none">Full amount</option>
                    <option value="percent">% Percent</option>
                    <option value="fixed">Fixed ₦</option>
                  </select>
                  {depositType !== 'none' && (
                    <input
                      type="text"
                      inputMode="decimal"
                      value={depositInputText}
                      onChange={(e) => setDepositInputText(e.target.value)}
                      placeholder={depositType === 'percent' ? 'e.g. 50' : '0.00'}
                      className="flex-1 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 py-2 text-xs font-mono min-h-[42px]"
                    />
                  )}
                </div>
              </label>
              <label className="block text-xs space-y-1">
                <span className="font-medium">Customer phone (private, never shown on public link)</span>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="0803…"
                  className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 py-2 text-xs min-h-[42px]"
                />
              </label>
              <label className="block text-xs space-y-1 sm:col-span-2">
                <span className="font-medium">Customer address</span>
                <input
                  type="text"
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  placeholder="Optional street / city"
                  className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 py-2 text-xs min-h-[42px]"
                />
              </label>
              <label className="block text-xs space-y-1 sm:col-span-2">
                <span className="font-medium">Notes</span>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Delivery note or payment instruction"
                  className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 py-2 text-xs"
                />
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Live Totals Summary + Primary Action */}
      <section className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-[#F4F6F8] dark:bg-[#111715] p-5 space-y-4">
        <div className="space-y-1 text-xs">
          <div className="flex justify-between text-[#6B7280] dark:text-[#9CA3AF]">
            <span>Subtotal</span>
            <span className="font-mono tabular-nums">
              {formatKobo(totals.subtotalKobo, business.currency)}
            </span>
          </div>
          {totals.invoiceDiscountKobo > 0 && (
            <div className="flex justify-between text-[#6B7280] dark:text-[#9CA3AF]">
              <span>Invoice discount</span>
              <span className="font-mono tabular-nums">
                −{formatKobo(totals.invoiceDiscountKobo, business.currency)}
              </span>
            </div>
          )}
          {business.vatEnabled && totals.vatKobo > 0 && (
            <div className="flex justify-between text-[#6B7280] dark:text-[#9CA3AF]">
              <span>VAT ({(business.vatRateBps / 100).toFixed(1).replace(/\.0$/, '')}%)</span>
              <span className="font-mono tabular-nums">
                {formatKobo(totals.vatKobo, business.currency)}
              </span>
            </div>
          )}
          <div className="pt-2 border-t border-gray-200 dark:border-[#1F2925] flex justify-between text-base font-semibold">
            <span>Invoice Total</span>
            <span className="font-mono tabular-nums">
              {formatKobo(totals.totalKobo, business.currency)}
            </span>
          </div>
          {totals.depositType !== 'none' && totals.amountDueNowKobo < totals.totalKobo && (
            <div className="flex justify-between text-xs font-semibold text-[#064E3B] dark:text-[#6EE7B7]">
              <span>Amount due now</span>
              <span className="font-mono tabular-nums">
                {formatKobo(totals.amountDueNowKobo, business.currency)}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={submitting !== null}
            onClick={() => handleSubmit(true)}
            className="flex-1 min-w-[160px] rounded-[10px] bg-[#064E3B] px-5 py-3 text-sm font-semibold text-white hover:bg-[#04392B] min-h-[48px] disabled:opacity-60"
          >
            {submitting === 'send' ? 'Sending…' : 'Send invoice'}
          </button>
          <button
            type="button"
            disabled={submitting !== null}
            onClick={() => handleSubmit(false)}
            className="rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-4 py-3 text-xs font-semibold min-h-[48px] disabled:opacity-60"
          >
            {submitting === 'draft' ? 'Saving…' : 'Save draft'}
          </button>
        </div>
      </section>
    </div>
  );
}
