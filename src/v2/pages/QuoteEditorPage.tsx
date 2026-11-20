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
  computeValidUntilDate,
  formatQtyThousandths,
  parseQtyToThousandths,
  type DepositType,
  type PaymentTermsKind,
} from '../../shared/v2/money';
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
    key: `qline-${Math.random().toString(36).slice(2, 9)}`,
    description: '',
    qtyText: '1',
    unitPriceText: '',
    discountText: '',
  };
}

export function QuoteEditorPage({
  business,
  quoteId,
}: {
  business: BusinessProfile;
  quoteId?: string;
}) {
  const { navigate } = useRouter();
  const idempotencyKeyRef = useRef(
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? `quo-${crypto.randomUUID()}`
      : `quo-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  const [customers, setCustomers] = useState<CustomerSuggestion[]>([]);
  const [catalog, setCatalog] = useState<CatalogItemSuggestion[]>([]);
  const [loadingDraft, setLoadingDraft] = useState(Boolean(quoteId));

  // Primary fields (<= 5 before "More details")
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [lines, setLines] = useState<LineFormRow[]>([makeEmptyLine()]);
  const [issueDate, setIssueDate] = useState(() => getLagosDateString());
  const [validUntil, setValidUntil] = useState(() => computeValidUntilDate(getLagosDateString(), 14));
  const [termsKind, setTermsKind] = useState<PaymentTermsKind>(() => {
    const d = business.defaultPaymentTermsDays ?? 7;
    if (d === 0) return 'due_on_receipt';
    if (d === 7) return 'net_7';
    if (d === 14) return 'net_14';
    if (d === 30) return 'net_30';
    return 'net_7';
  });

  // Advanced fields behind "More details"
  const [showMore, setShowMore] = useState(false);
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [quoteDiscountText, setQuoteDiscountText] = useState('');
  const [depositType, setDepositType] = useState<DepositType>('none');
  const [depositInputText, setDepositInputText] = useState('');
  const [notes, setNotes] = useState(business.defaultInvoiceNotes || '');
  const [selectedBankIds, setSelectedBankIds] = useState<string[]>(() =>
    (business.bankAccounts || []).map((b) => b.id)
  );
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
    if (!quoteId) return;
    setLoadingDraft(true);
    v2Api
      .getQuote(quoteId)
      .then(({ quote }) => {
        if (quote.status !== 'DRAFT') {
          navigate(`/app/quotes/${quote.id}`, { replace: true });
          return;
        }
        setCustomerId(quote.customerId);
        setCustomerName(quote.customerName);
        setCustomerPhone(quote.customerPhone);
        setCustomerEmail(quote.customerEmail);
        setCustomerAddress(quote.customerAddress);
        setIssueDate(quote.issueDate);
        setValidUntil(quote.validUntil);
        setTermsKind(quote.termsKind);
        setLines(
          quote.lines.length
            ? quote.lines.map((l) => ({
                key: l.id || `ql-${Math.random()}`,
                description: l.description,
                qtyText: formatQtyThousandths(l.qtyThousandths),
                unitPriceText: formatKoboPlainInput(l.unitPriceKobo),
                discountText: l.discountKobo > 0 ? formatKoboPlainInput(l.discountKobo) : '',
              }))
            : [makeEmptyLine()]
        );
        setQuoteDiscountText(
          quote.invoiceDiscountKobo > 0 ? formatKoboPlainInput(quote.invoiceDiscountKobo) : ''
        );
        setDepositType(quote.depositType);
        setDepositInputText(
          quote.depositType === 'percent'
            ? String(quote.depositValue / 100)
            : quote.depositType === 'fixed'
            ? formatKoboPlainInput(quote.depositValue)
            : ''
        );
        setNotes(quote.notes || '');
        setSelectedBankIds(quote.bankAccountIds || []);
        setTemplate(quote.template || business.defaultTemplate);
      })
      .catch((err: any) => setError(err?.message || 'Unable to load quote draft'))
      .finally(() => setLoadingDraft(false));
  }, [quoteId, navigate, business.defaultTemplate]);

  const parsedLines = useMemo(() => {
    return lines
      .filter((l) => l.description.trim().length > 0)
      .map((l) => ({
        description: l.description.trim(),
        qtyThousandths: Math.max(1, parseQtyToThousandths(l.qtyText) || 1000),
        unitPriceKobo: parseAmountToKobo(l.unitPriceText),
        discountKobo: parseAmountToKobo(l.discountText),
      }));
  }, [lines]);

  const depositValueInt = useMemo(() => {
    if (depositType === 'percent') {
      const pct = Number(depositInputText);
      return Number.isFinite(pct) && pct > 0 ? Math.min(10000, Math.round(pct * 100)) : 0;
    }
    if (depositType === 'fixed') {
      return parseAmountToKobo(depositInputText);
    }
    return 0;
  }, [depositType, depositInputText]);

  const totals = useMemo(() => {
    return calculateV2DocumentTotals({
      lines: parsedLines.length
        ? parsedLines
        : [{ description: 'Item', qtyThousandths: 1000, unitPriceKobo: 0, discountKobo: 0 }],
      invoiceDiscountKobo: parseAmountToKobo(quoteDiscountText),
      vatEnabled: business.vatEnabled,
      vatMode: business.vatMode,
      vatRateBps: business.vatRateBps,
      depositType,
      depositValue: depositValueInt,
    });
  }, [parsedLines, quoteDiscountText, business.vatEnabled, business.vatMode, business.vatRateBps, depositType, depositValueInt]);

  const updateLine = (idx: number, patch: Partial<LineFormRow>) => {
    setLines((prev) => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const applyCatalogSuggestion = (item: CatalogItemSuggestion) => {
    setLines((prev) => {
      const emptyIdx = prev.findIndex((r) => !r.description.trim());
      const newRow: LineFormRow = {
        key: `qline-${Math.random().toString(36).slice(2, 9)}`,
        description: item.description,
        qtyText: '1',
        unitPriceText: formatKoboPlainInput(item.unitPriceKobo),
        discountText: '',
      };
      if (emptyIdx !== -1) {
        return prev.map((r, i) => (i === emptyIdx ? newRow : r));
      }
      return [...prev, newRow];
    });
  };

  const applyValidityPreset = (days: number) => {
    setValidUntil(computeValidUntilDate(issueDate, days));
  };

  const handleSubmit = async (sendNow: boolean) => {
    setError(null);
    if (!customerName.trim()) {
      setError('Enter or select a customer name.');
      return;
    }
    if (parsedLines.length === 0) {
      setError('Add at least one item with a description.');
      return;
    }
    if (validUntil < issueDate) {
      setError('Valid until date cannot be earlier than the issue date.');
      return;
    }

    setSubmitting(sendNow ? 'send' : 'draft');
    try {
      const payload = {
        customerId,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        customerEmail: customerEmail.trim(),
        customerAddress: customerAddress.trim(),
        issueDate,
        validUntil,
        termsKind,
        lines: parsedLines,
        invoiceDiscountKobo: parseAmountToKobo(quoteDiscountText),
        depositType,
        depositValue: depositValueInt,
        notes: notes.trim(),
        bankAccountIds: selectedBankIds,
        template,
        idempotencyKey: quoteId ? undefined : idempotencyKeyRef.current,
        sendNow,
      };

      const res = quoteId
        ? await v2Api.updateQuote(quoteId, payload)
        : await v2Api.createQuote(payload);

      navigate(`/app/quotes/${res.quote.id}`, { replace: true });
    } catch (err: any) {
      setError(err?.message || 'Unable to save quote. Please check your details and try again.');
    } finally {
      setSubmitting(null);
    }
  };

  if (loadingDraft) {
    return <div className="py-16 text-center text-xs text-[#5C635D]">Loading quote draft…</div>;
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link
            to="/app/documents"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#5C635D] hover:text-[#121513] dark:text-[#9BA39D]"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Documents</span>
          </Link>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl">
            {quoteId ? 'Edit Quote Draft' : 'New Quote'}
          </h1>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-[#B91C1C]/30 bg-[#FEF2F2] p-3.5 text-xs text-[#B91C1C]">
          {error}
        </div>
      )}

      {/* 1. Customer */}
      <section className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-5 space-y-3">
        <label className="block text-xs font-semibold" htmlFor="quote-customer-name">
          Customer
        </label>
        <input
          id="quote-customer-name"
          type="text"
          value={customerName}
          onChange={(e) => {
            setCustomerName(e.target.value);
            setCustomerId(null);
          }}
          placeholder="Customer or company name"
          className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#101512] px-3.5 py-2.5 text-sm min-h-[44px]"
        />
        {customers.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {customers.slice(0, 6).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setCustomerId(c.id);
                  setCustomerName(c.name);
                  setCustomerPhone(c.phone || '');
                }}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  customerId === c.id
                    ? 'border-[#064E3B] bg-[#064E3B] text-white'
                    : 'border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#101512] text-[#121513] dark:text-[#F4F1EA]'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 2. Line Items */}
      <section className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold">Items</p>
          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, makeEmptyLine()])}
            className="inline-flex items-center gap-1 rounded-lg border border-[#DED6C2] dark:border-[#2B352F] px-2.5 py-1.5 text-xs font-medium hover:bg-[#FAF8F3] dark:hover:bg-[#1B231F]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add line</span>
          </button>
        </div>

        {catalog.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {catalog.slice(0, 5).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => applyCatalogSuggestion(item)}
                className="rounded-lg border border-[#E5DEC9] dark:border-[#242D28] bg-[#FAF8F3] dark:bg-[#101512] px-2.5 py-1 text-[11px] font-medium text-[#5C635D] dark:text-[#9BA39D] hover:border-[#064E3B]"
              >
                + {item.description} ({formatKobo(item.unitPriceKobo, business.currency)})
              </button>
            ))}
          </div>
        )}

        <div className="space-y-3">
          {lines.map((row, idx) => (
            <div
              key={row.key}
              className="rounded-xl border border-[#EFEAD9] dark:border-[#242D28] bg-[#FAF8F3] dark:bg-[#101512] p-3 space-y-2.5"
            >
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={row.description}
                  onChange={(e) => updateLine(idx, { description: e.target.value })}
                  placeholder="Item or service description"
                  className="flex-1 rounded-lg border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] px-3 py-2 text-sm min-h-[42px]"
                />
                {lines.length > 1 && (
                  <button
                    type="button"
                    aria-label="Remove line"
                    onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                    className="p-2 rounded-lg text-[#5C635D] hover:text-[#B91C1C]"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] text-[#5C635D] mb-1">Qty</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.qtyText}
                    onChange={(e) => updateLine(idx, { qtyText: e.target.value })}
                    className="w-full rounded-lg border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] px-2.5 py-2 text-sm font-mono min-h-[40px]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#5C635D] mb-1">
                    Unit price ({business.currency})
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.unitPriceText}
                    onChange={(e) => updateLine(idx, { unitPriceText: e.target.value })}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] px-2.5 py-2 text-sm font-mono min-h-[40px]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#5C635D] mb-1">Line discount</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.discountText}
                    onChange={(e) => updateLine(idx, { discountText: e.target.value })}
                    placeholder="0"
                    className="w-full rounded-lg border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] px-2.5 py-2 text-sm font-mono min-h-[40px]"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 3. Valid Until & Payment Terms */}
      <section className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block text-xs font-semibold" htmlFor="quote-valid-until">
              Valid until
            </label>
            <input
              id="quote-valid-until"
              type="date"
              value={validUntil}
              min={issueDate}
              onChange={(e) => setValidUntil(e.target.value)}
              className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#101512] px-3 py-2.5 text-sm font-mono min-h-[44px]"
            />
            <div className="flex flex-wrap gap-1.5">
              {[7, 14, 30].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => applyValidityPreset(d)}
                  className="rounded-lg border border-[#DED6C2] dark:border-[#2B352F] px-2.5 py-1 text-[11px] font-medium text-[#5C635D] hover:border-[#064E3B]"
                >
                  {d} days
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold" htmlFor="quote-terms">
              Payment terms (if accepted)
            </label>
            <select
              id="quote-terms"
              value={termsKind}
              onChange={(e) => setTermsKind(e.target.value as PaymentTermsKind)}
              className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#101512] px-3 py-2.5 text-sm min-h-[44px]"
            >
              <option value="due_on_receipt">Due on receipt</option>
              <option value="net_7">7 days</option>
              <option value="net_14">14 days</option>
              <option value="net_30">30 days</option>
            </select>
          </div>
        </div>
      </section>

      {/* More details (collapsed by default to obey <= 5 primary fields) */}
      <section className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] overflow-hidden">
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5 text-xs font-semibold hover:bg-[#FAF8F3] dark:hover:bg-[#1B231F]"
        >
          <span>More details (customer contact, discount, deposit, notes)</span>
          {showMore ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showMore && (
          <div className="px-5 pb-5 pt-2 space-y-4 border-t border-[#EFEAD9] dark:border-[#242D28]">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-[#5C635D] mb-1">Issue date</label>
                <input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#101512] px-3 py-2 text-sm font-mono min-h-[42px]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#5C635D] mb-1">Customer phone</label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="080..."
                  className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#101512] px-3 py-2 text-sm min-h-[42px]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#5C635D] mb-1">Customer email</label>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#101512] px-3 py-2 text-sm min-h-[42px]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-[#5C635D] mb-1">Customer address</label>
              <input
                type="text"
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                placeholder="Shop or delivery address"
                className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#101512] px-3 py-2 text-sm min-h-[42px]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-[#5C635D] mb-1">
                  Quote discount ({business.currency})
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={quoteDiscountText}
                  onChange={(e) => setQuoteDiscountText(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#101512] px-3 py-2 text-sm font-mono min-h-[42px]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#5C635D] mb-1">Deposit if accepted</label>
                <select
                  value={depositType}
                  onChange={(e) => setDepositType(e.target.value as DepositType)}
                  className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#101512] px-3 py-2 text-sm min-h-[42px]"
                >
                  <option value="none">No deposit</option>
                  <option value="percent">Percentage (%)</option>
                  <option value="fixed">Fixed amount</option>
                </select>
              </div>
              {depositType !== 'none' && (
                <div>
                  <label className="block text-xs text-[#5C635D] mb-1">
                    {depositType === 'percent' ? 'Deposit (%)' : `Deposit (${business.currency})`}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={depositInputText}
                    onChange={(e) => setDepositInputText(e.target.value)}
                    placeholder={depositType === 'percent' ? '50' : '0.00'}
                    className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#101512] px-3 py-2 text-sm font-mono min-h-[42px]"
                  />
                </div>
              )}
            </div>

            {(business.bankAccounts || []).length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-[#5C635D]">Bank accounts to copy if converted to invoice</p>
                <div className="space-y-1.5">
                  {(business.bankAccounts || []).map((bank) => {
                    const checked = selectedBankIds.includes(bank.id);
                    return (
                      <label
                        key={bank.id}
                        className="flex items-center gap-2.5 text-xs cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setSelectedBankIds((prev) =>
                              e.target.checked
                                ? [...prev, bank.id]
                                : prev.filter((id) => id !== bank.id)
                            )
                          }
                          className="rounded border-[#DED6C2] text-[#064E3B]"
                        />
                        <span className="font-medium">{bank.bankName}</span>
                        <span className="font-mono text-[#5C635D]">{bank.accountNumber}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs text-[#5C635D] mb-1">Notes &amp; terms</label>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Delivery timeline, warranty, or validity terms"
                className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#101512] px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs text-[#5C635D] mb-1">Template style</label>
              <select
                value={template}
                onChange={(e) => setTemplate(e.target.value as 'modern' | 'classic' | 'compact')}
                className="w-full sm:w-56 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#101512] px-3 py-2 text-sm min-h-[42px]"
              >
                <option value="modern">Modern</option>
                <option value="classic">Classic</option>
                <option value="compact">Compact</option>
              </select>
            </div>
          </div>
        )}
      </section>

      {/* Live Totals + Primary Action */}
      <section className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-5 space-y-4">
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between text-[#5C635D]">
            <span>Subtotal</span>
            <span className="font-mono tabular-nums">{formatKobo(totals.subtotalKobo, business.currency)}</span>
          </div>
          {totals.lineDiscountTotalKobo > 0 && (
            <div className="flex justify-between text-[#5C635D]">
              <span>Line discounts</span>
              <span className="font-mono tabular-nums">
                −{formatKobo(totals.lineDiscountTotalKobo, business.currency)}
              </span>
            </div>
          )}
          {totals.invoiceDiscountKobo > 0 && (
            <div className="flex justify-between text-[#5C635D]">
              <span>Quote discount</span>
              <span className="font-mono tabular-nums">
                −{formatKobo(totals.invoiceDiscountKobo, business.currency)}
              </span>
            </div>
          )}
          {business.vatEnabled && totals.vatKobo > 0 && (
            <div className="flex justify-between text-[#5C635D]">
              <span>
                VAT ({(business.vatRateBps / 100).toFixed(1).replace(/\.0$/, '')}%
                {business.vatMode === 'inclusive' ? ' incl.' : ''})
              </span>
              <span className="font-mono tabular-nums">{formatKobo(totals.vatKobo, business.currency)}</span>
            </div>
          )}
          <div className="pt-2 border-t border-[#EFEAD9] dark:border-[#242D28] flex justify-between text-base font-bold">
            <span>Quote Total</span>
            <span className="font-mono tabular-nums text-[#064E3B] dark:text-[#10B981]">
              {formatKobo(totals.totalKobo, business.currency)}
            </span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <button
            type="button"
            disabled={submitting !== null}
            onClick={() => handleSubmit(true)}
            className="flex-1 rounded-xl bg-[#064E3B] px-5 py-3 text-sm font-semibold text-white hover:bg-[#04392B] disabled:opacity-60 min-h-[46px]"
          >
            {submitting === 'send' ? 'Issuing quote…' : 'Send quote'}
          </button>
          <button
            type="button"
            disabled={submitting !== null}
            onClick={() => handleSubmit(false)}
            className="rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] px-5 py-3 text-sm font-semibold hover:bg-[#FAF8F3] dark:hover:bg-[#1B231F] disabled:opacity-60 min-h-[46px]"
          >
            {submitting === 'draft' ? 'Saving…' : 'Save draft'}
          </button>
        </div>
      </section>
    </div>
  );
}
