import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { Link, useRouter } from '../lib/router';
import {
  calculateReceiptTotals,
  formatKobo,
  formatKoboPlainInput,
  getLagosDateString,
  parseAmountToKobo,
} from '../shared/money';
import type { EntrySource, PaymentMethod, ReceiptTemplate } from '../shared/schemas';
import type {
  BusinessProfile,
  CatalogItemSuggestion,
  CustomerSuggestion,
  PublicReceiptRecord,
  ReceiptRecord,
} from '../shared/types';
import { NumericKeypad } from '../components/NumericKeypad';
import { ReceiptShareBar } from '../components/ReceiptActionsModal';
import { ReceiptTemplateView, receiptToPublicPreview } from '../components/ReceiptTemplates';
import { SpeechInput, SpeechTextarea } from '../components/SpeechInput';

interface DraftLineItem {
  id: string;
  description: string;
  qty: string;
  unitPrice: string;
  discount: string;
  showDiscount: boolean;
}

interface ReceiptDraft {
  customerName: string;
  customerPhone: string;
  items: DraftLineItem[];
  paymentMethod: PaymentMethod;
  amountPaid: string;
  amountPaidTouched: boolean;
  note: string;
  soldBy: string;
  issuedDateLagos: string;
  template: ReceiptTemplate;
  source: EntrySource;
}

function createEmptyItem(): DraftLineItem {
  return {
    id: Math.random().toString(36).slice(2, 10),
    description: '',
    qty: '1',
    unitPrice: '',
    discount: '',
    showDiscount: false,
  };
}

function createFreshDraft(defaultTemplate: ReceiptTemplate): ReceiptDraft {
  return {
    customerName: '',
    customerPhone: '',
    items: [createEmptyItem()],
    paymentMethod: 'Cash',
    amountPaid: '',
    amountPaidTouched: false,
    note: '',
    soldBy: '',
    issuedDateLagos: getLagosDateString(),
    template: defaultTemplate,
    source: 'manual',
  };
}

export function NewReceiptPage({ business }: { business: BusinessProfile }) {
  const { search } = useRouter();
  const draftKey = `tallymark_receipt_draft_${business.id}`;

  const [draft, setDraft] = useState<ReceiptDraft>(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved) as ReceiptDraft;
        if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
          const isUntouched =
            !parsed.customerName &&
            !parsed.note &&
            parsed.items.length === 1 &&
            !parsed.items[0].description &&
            !parsed.items[0].unitPrice;
          return {
            ...parsed,
            issuedDateLagos: isUntouched
              ? getLagosDateString()
              : parsed.issuedDateLagos || getLagosDateString(),
          };
        }
      }
    } catch {
      // ignore
    }
    return createFreshDraft(business.defaultTemplate);
  });

  const [customers, setCustomers] = useState<CustomerSuggestion[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItemSuggestion[]>([]);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [activeItemDropdown, setActiveItemDropdown] = useState<string | null>(null);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);

  useEffect(() => {
    if (!mobilePreviewOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobilePreviewOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobilePreviewOpen]);

  const [keypad, setKeypad] = useState<{
    open: boolean;
    title: string;
    value: string;
    mode: 'currency' | 'quantity';
    onApply: (val: string) => void;
  }>({
    open: false,
    title: '',
    value: '',
    mode: 'currency',
    onApply: () => {},
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuedReceipt, setIssuedReceipt] = useState<ReceiptRecord | null>(null);

  // Load autosuggest customers & items
  useEffect(() => {
    api
      .getSuggestions()
      .then((res) => {
        setCustomers(res.customers);
        setCatalogItems(res.items);
      })
      .catch(() => {});
  }, []);

  // Support ?duplicateFrom=<id>
  useEffect(() => {
    const params = new URLSearchParams(search);
    const dupId = params.get('duplicateFrom');
    if (!dupId) return;
    api
      .getReceipt(dupId)
      .then(({ receipt }) => {
        setDraft({
          customerName: receipt.customerName,
          customerPhone: receipt.customerPhone,
          items: receipt.items.map((item) => ({
            id: Math.random().toString(36).slice(2, 10),
            description: item.description,
            qty: String(item.qty),
            unitPrice: formatKoboPlainInput(item.unitPriceKobo),
            discount: item.discountKobo > 0 ? formatKoboPlainInput(item.discountKobo) : '',
            showDiscount: item.discountKobo > 0,
          })),
          paymentMethod: receipt.paymentMethod,
          amountPaid: '',
          amountPaidTouched: false,
          note: receipt.note,
          soldBy: receipt.soldBy,
          issuedDateLagos: getLagosDateString(),
          template: receipt.template,
          source: 'manual',
        });
      })
      .catch(() => {});
  }, [search]);

  // Persist draft locally on every edit
  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      // ignore
    }
  }, [draft, draftKey]);

  const parsedItems = useMemo(() => {
    return draft.items.map((item) => {
      const qtyNum = Math.max(0, Number.parseFloat(item.qty || '0') || 0);
      return {
        description: item.description.trim() || 'Item',
        qty: qtyNum > 0 ? qtyNum : 1,
        unitPriceKobo: parseAmountToKobo(item.unitPrice || '0'),
        discountKobo: parseAmountToKobo(item.discount || '0'),
      };
    });
  }, [draft.items]);

  const totals = useMemo(() => {
    return calculateReceiptTotals(
      parsedItems,
      business.vatEnabled,
      business.vatMode,
      business.vatRateBps
    );
  }, [parsedItems, business.vatEnabled, business.vatMode, business.vatRateBps]);

  const amountPaidKobo = useMemo(() => {
    if (!draft.amountPaidTouched) {
      return totals.totalKobo;
    }
    return Math.min(totals.totalKobo, parseAmountToKobo(draft.amountPaid || '0'));
  }, [draft.amountPaidTouched, draft.amountPaid, totals.totalKobo]);

  const balanceDueKobo = Math.max(0, totals.totalKobo - amountPaidKobo);

  const previewRecord: PublicReceiptRecord = useMemo(() => {
    const nextNum = `${business.receiptPrefix}${String(business.nextSequence).padStart(4, '0')}`;
    return {
      publicId: 'live-preview',
      receiptNumber: nextNum,
      receiptKind: 'SALE',
      parentReceiptNumber: null,
      businessName: business.name,
      businessLogoDataUrl: business.logoDataUrl,
      businessSignatureDataUrl: business.signatureDataUrl ?? null,
      businessAddress: business.address,
      businessPhone: business.phone,
      businessEmail: business.email,
      brandColor: business.brandColor,
      currency: business.currency,
      customerName: draft.customerName,
      customerPhone: draft.customerPhone,
      items: totals.items,
      subtotalKobo: totals.subtotalKobo,
      discountTotalKobo: totals.discountTotalKobo,
      vatEnabled: business.vatEnabled,
      vatMode: business.vatMode,
      vatRateBps: business.vatRateBps,
      vatKobo: totals.vatKobo,
      totalKobo: totals.totalKobo,
      amountPaidKobo,
      balanceDueKobo,
      paymentMethod: draft.paymentMethod,
      note: draft.note,
      soldBy: draft.soldBy,
      template: draft.template,
      status: balanceDueKobo === 0 ? 'PAID' : 'PART_PAID',
      voidReason: null,
      voidedAt: null,
      issuedDateLagos: draft.issuedDateLagos || getLagosDateString(),
      issuedAt: new Date().toISOString(),
    };
  }, [business, draft, totals, amountPaidKobo, balanceDueKobo]);

  const filteredCustomers = useMemo(() => {
    const q = draft.customerName.trim().toLowerCase();
    if (!q) return customers.slice(0, 5);
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q))
      .slice(0, 6);
  }, [customers, draft.customerName]);

  const updateItem = (id: string, patch: Partial<DraftLineItem>) => {
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }));
  };

  const removeItem = (id: string) => {
    setDraft((prev) => {
      if (prev.items.length <= 1) return prev;
      return { ...prev, items: prev.items.filter((i) => i.id !== id) };
    });
  };

  const resetDraft = () => {
    const fresh = createFreshDraft(business.defaultTemplate);
    setDraft(fresh);
    setError(null);
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
  };

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validItems = draft.items.filter((i) => i.description.trim().length > 0);
    if (validItems.length === 0) {
      setError('Enter at least one item description.');
      return;
    }

    const payloadItems = validItems.map((i) => ({
      description: i.description.trim(),
      qty: Math.max(0.001, Number.parseFloat(i.qty || '1') || 1),
      unitPriceKobo: parseAmountToKobo(i.unitPrice || '0'),
      discountKobo: parseAmountToKobo(i.discount || '0'),
    }));

    setSubmitting(true);
    try {
      const res = await api.createReceipt({
        customerName: draft.customerName.trim(),
        customerPhone: draft.customerPhone.trim(),
        items: payloadItems,
        paymentMethod: draft.paymentMethod,
        amountPaidKobo,
        note: draft.note.trim(),
        soldBy: draft.soldBy.trim(),
        issuedDateLagos: draft.issuedDateLagos,
        template: draft.template,
        source: draft.source,
      });

      setIssuedReceipt(res.receipt);
      resetDraft();
      api
        .getSuggestions()
        .then((s) => {
          setCustomers(s.customers);
          setCatalogItems(s.items);
        })
        .catch(() => {});
    } catch (err: any) {
      setError(err?.message || 'Unable to issue receipt. Draft is safely saved on this device.');
    } finally {
      setSubmitting(false);
    }
  };

  // Post-issue confirmation & sharing screen
  if (issuedReceipt) {
    const publicPreview = receiptToPublicPreview(issuedReceipt, business);
    return (
      <div className="space-y-6">
        <div className="no-print rounded-[20px] border border-[#064E3B]/30 bg-white dark:bg-[#131917] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-6 h-6 text-[#064E3B] dark:text-[#6EE7B7] shrink-0 mt-0.5" />
            <div>
              <p className="label-caps text-[#064E3B] dark:text-[#6EE7B7]">Receipt Issued</p>
              <h1 className="mt-0.5 font-display text-3xl text-[#111827] dark:text-[#F3F4F6]">
                {issuedReceipt.receiptNumber} · {formatKobo(issuedReceipt.totalKobo, business.currency)}
              </h1>
              <p className="mt-1 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                Saved to your ledger. Share with your customer on WhatsApp or download PDF.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIssuedReceipt(null)}
              className="min-h-[44px] rounded-[10px] bg-[#064E3B] px-4 py-2 text-xs font-semibold text-white hover:bg-[#04392B]"
            >
              Issue Another
            </button>
            <Link
              to={`/app/receipts/${issuedReceipt.id}`}
              className="min-h-[44px] inline-flex items-center rounded-[10px] border border-gray-200 dark:border-[#232D29] px-4 py-2 text-xs font-medium"
            >
              Details
            </Link>
          </div>
        </div>

        <div className="no-print">
          <ReceiptShareBar receipt={publicPreview} />
        </div>

        <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-[#F4F6F8]/60 dark:bg-[#111715] p-4 sm:p-6">
          <ReceiptTemplateView receipt={publicPreview} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="label-caps text-[#6B7280] dark:text-[#9CA3AF]">
            Next number · <span className="font-mono-num">{business.receiptPrefix}{String(business.nextSequence).padStart(4, '0')}</span>
          </p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl text-[#111827] dark:text-[#F3F4F6]">
            New Receipt
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMobilePreviewOpen(true)}
            className="lg:hidden inline-flex items-center gap-1.5 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3.5 py-2 text-xs font-medium min-h-[44px]"
          >
            <Eye className="w-4 h-4" />
            <span>Preview</span>
          </button>
          <button
            type="button"
            onClick={resetDraft}
            title="Clear draft"
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3 py-2 text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] min-h-[44px]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Clear</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Form Column */}
        <form onSubmit={handleIssue} className="lg:col-span-7 space-y-5">
          {/* Customer */}
          <section className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-4 sm:p-5 space-y-3">
            <p className="label-caps text-[#6B7280] dark:text-[#9CA3AF]">
              Customer (optional for walk-ins)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="relative">
                <SpeechInput
                  value={draft.customerName}
                  onChangeValue={(val) => {
                    setDraft((d) => ({ ...d, customerName: val }));
                    setCustomerDropdownOpen(true);
                  }}
                  onDictated={() => setDraft((d) => ({ ...d, source: 'voice' }))}
                  onFocus={() => setCustomerDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setCustomerDropdownOpen(false), 160)}
                  placeholder="Customer name"
                  micLabel="Dictate customer name"
                />
                {customerDropdownOpen && filteredCustomers.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] shadow-lg overflow-hidden">
                    {filteredCustomers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={() => {
                          setDraft((d) => ({
                            ...d,
                            customerName: c.name,
                            customerPhone: c.phone || d.customerPhone,
                          }));
                          setCustomerDropdownOpen(false);
                        }}
                        className="w-full px-3.5 py-2.5 text-left text-xs hover:bg-[#F6F7F8] dark:hover:bg-[#1A221F] flex items-center justify-between gap-2 min-h-[40px]"
                      >
                        <span className="font-medium">{c.name}</span>
                        <span className="font-mono-num text-[#6B7280]">{c.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <input
                type="tel"
                value={draft.customerPhone}
                onChange={(e) => setDraft((d) => ({ ...d, customerPhone: e.target.value }))}
                placeholder="WhatsApp / phone (optional)"
                className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] px-3.5 py-2.5 font-mono-num text-sm min-h-[44px]"
              />
            </div>
          </section>

          {/* Line Items */}
          <section className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="label-caps text-[#6B7280] dark:text-[#9CA3AF]">Items Sold</p>
              <button
                type="button"
                onClick={() =>
                  setDraft((d) => ({ ...d, items: [...d.items, createEmptyItem()] }))
                }
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#064E3B] dark:text-[#6EE7B7] hover:underline min-h-[36px]"
              >
                <Plus className="w-4 h-4" />
                <span>Add item</span>
              </button>
            </div>

            <div className="space-y-3">
              {draft.items.map((item, idx) => {
                const matchingItems = catalogItems
                  .filter((ci) =>
                    !item.description.trim()
                      ? true
                      : ci.description.toLowerCase().includes(item.description.trim().toLowerCase())
                  )
                  .slice(0, 5);

                return (
                  <div
                    key={item.id}
                    className="rounded-[10px] border border-gray-100 dark:border-[#1F2925] bg-[#F6F7F8]/70 dark:bg-[#111715] p-3.5 space-y-3"
                  >
                    <div className="flex items-start gap-2">
                      <div className="relative flex-1">
                        <SpeechInput
                          value={item.description}
                          onChangeValue={(val) => {
                            updateItem(item.id, { description: val });
                            setActiveItemDropdown(item.id);
                          }}
                          onDictated={() => setDraft((d) => ({ ...d, source: 'voice' }))}
                          onFocus={() => setActiveItemDropdown(item.id)}
                          onBlur={() => setTimeout(() => setActiveItemDropdown(null), 160)}
                          placeholder={`Item ${idx + 1} description`}
                          micLabel="Dictate item description"
                        />
                        {activeItemDropdown === item.id && matchingItems.length > 0 && (
                          <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] shadow-lg overflow-hidden">
                            {matchingItems.map((ci) => (
                              <button
                                key={ci.id}
                                type="button"
                                onMouseDown={() => {
                                  updateItem(item.id, {
                                    description: ci.description,
                                    unitPrice: formatKoboPlainInput(ci.unitPriceKobo),
                                  });
                                  setActiveItemDropdown(null);
                                }}
                                className="w-full px-3.5 py-2.5 text-left text-xs hover:bg-[#F6F7F8] dark:hover:bg-[#1A221F] flex items-center justify-between gap-2 min-h-[40px]"
                              >
                                <span className="font-medium truncate">{ci.description}</span>
                                <span className="font-mono-num text-[#064E3B] dark:text-[#6EE7B7] shrink-0">
                                  {formatKobo(ci.unitPriceKobo, business.currency)}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {draft.items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          aria-label="Remove item"
                          className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-[10px] border border-gray-200 dark:border-[#232D29] text-[#6B7280] hover:text-[#B91C1C]"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      <div>
                        <label className="block text-[11px] text-[#6B7280] dark:text-[#9CA3AF] mb-1">
                          Qty
                        </label>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={item.qty}
                            onChange={(e) => updateItem(item.id, { qty: e.target.value })}
                            className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3 py-2 font-mono-num text-sm min-h-[44px]"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setKeypad({
                                open: true,
                                title: `Quantity · Item ${idx + 1}`,
                                value: item.qty,
                                mode: 'quantity',
                                onApply: (v) => updateItem(item.id, { qty: v }),
                              })
                            }
                            className="px-2.5 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] text-[11px] font-medium min-h-[44px]"
                          >
                            Pad
                          </button>
                        </div>
                      </div>

                      <div className="col-span-1 sm:col-span-2">
                        <label className="block text-[11px] text-[#6B7280] dark:text-[#9CA3AF] mb-1">
                          Unit Price ({business.currency})
                        </label>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={item.unitPrice}
                            onChange={(e) => updateItem(item.id, { unitPrice: e.target.value })}
                            placeholder="0.00"
                            className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3 py-2 font-mono-num text-sm min-h-[44px]"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setKeypad({
                                open: true,
                                title: `Unit price · Item ${idx + 1}`,
                                value: item.unitPrice,
                                mode: 'currency',
                                onApply: (v) => updateItem(item.id, { unitPrice: v }),
                              })
                            }
                            className="px-3 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] text-xs font-medium min-h-[44px]"
                          >
                            Keypad
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-1">
                      {!item.showDiscount ? (
                        <button
                          type="button"
                          onClick={() => updateItem(item.id, { showDiscount: true })}
                          className="text-xs text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#064E3B] dark:hover:text-[#10B981]"
                        >
                          + Add discount
                        </button>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-[#6B7280]">Discount:</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={item.discount}
                            onChange={(e) => updateItem(item.id, { discount: e.target.value })}
                            placeholder="0"
                            className="w-24 rounded-lg border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-2.5 py-1.5 font-mono-num text-xs min-h-[36px]"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setKeypad({
                                open: true,
                                title: `Discount · Item ${idx + 1}`,
                                value: item.discount,
                                mode: 'currency',
                                onApply: (v) => updateItem(item.id, { discount: v }),
                              })
                            }
                            className="px-2.5 rounded-lg border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] text-[11px] font-medium min-h-[36px]"
                          >
                            Pad
                          </button>
                        </div>
                      )}
                      <span className="font-mono-num text-sm font-semibold">
                        {formatKobo(totals.items[idx]?.lineTotalKobo || 0, business.currency)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Payment & Details */}
          <section className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-4 sm:p-5 space-y-4">
            <div>
              <label className="block label-caps text-[#6B7280] dark:text-[#9CA3AF] mb-2">
                Payment Method
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {(['Cash', 'Transfer', 'POS', 'Card', 'Other'] as PaymentMethod[]).map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, paymentMethod: method }))}
                    className={`min-h-[44px] rounded-[10px] border text-xs font-semibold transition-colors ${
                      draft.paymentMethod === method
                        ? 'border-[#064E3B] bg-[#064E3B] text-white'
                        : 'border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] text-[#111827] dark:text-[#F3F4F6]'
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-gray-100 dark:border-[#1F2925]">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="label-caps text-[#6B7280] dark:text-[#9CA3AF]">
                    Amount Paid
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        amountPaidTouched: false,
                        amountPaid: formatKoboPlainInput(totals.totalKobo),
                      }))
                    }
                    className="text-xs font-medium text-[#064E3B] dark:text-[#6EE7B7] hover:underline"
                  >
                    Full ({formatKobo(totals.totalKobo, business.currency)})
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={
                      draft.amountPaidTouched
                        ? draft.amountPaid
                        : formatKoboPlainInput(totals.totalKobo)
                    }
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        amountPaidTouched: true,
                        amountPaid: e.target.value,
                      }))
                    }
                    className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] px-3.5 py-2.5 font-mono-num text-base font-semibold min-h-[44px]"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setKeypad({
                        open: true,
                        title: 'Amount paid by customer',
                        value: draft.amountPaidTouched
                          ? draft.amountPaid
                          : formatKoboPlainInput(totals.totalKobo),
                        mode: 'currency',
                        onApply: (v) =>
                          setDraft((d) => ({
                            ...d,
                            amountPaidTouched: true,
                            amountPaid: v,
                          })),
                      })
                    }
                    className="px-3 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] text-xs font-medium min-h-[44px]"
                  >
                    Keypad
                  </button>
                </div>
                {balanceDueKobo > 0 && (
                  <p className="mt-1.5 text-xs font-medium text-[#B45309] dark:text-amber-400 font-mono-num">
                    Balance due: {formatKobo(balanceDueKobo, business.currency)} (Part Paid)
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="rct-date" className="block label-caps text-[#6B7280] dark:text-[#9CA3AF] mb-1.5">
                  Date (Africa/Lagos)
                </label>
                <input
                  id="rct-date"
                  type="date"
                  value={draft.issuedDateLagos}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, issuedDateLagos: e.target.value }))
                  }
                  className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] px-3.5 py-2.5 font-mono-num text-sm min-h-[44px]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block label-caps text-[#6B7280] dark:text-[#9CA3AF] mb-1.5">
                  Sold by (optional)
                </label>
                <SpeechInput
                  value={draft.soldBy}
                  onChangeValue={(val) => setDraft((d) => ({ ...d, soldBy: val }))}
                  onDictated={() => setDraft((d) => ({ ...d, source: 'voice' }))}
                  placeholder="Staff or your name"
                  micLabel="Dictate seller name"
                />
              </div>
              <div>
                <label className="block label-caps text-[#6B7280] dark:text-[#9CA3AF] mb-1.5">
                  Template
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['modern', 'classic', 'compact'] as ReceiptTemplate[]).map((tpl) => (
                    <button
                      key={tpl}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, template: tpl }))}
                      className={`min-h-[44px] rounded-[10px] border text-xs font-medium capitalize ${
                        draft.template === tpl
                          ? 'border-[#064E3B] bg-[#064E3B] text-white'
                          : 'border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715]'
                      }`}
                    >
                      {tpl === 'compact' ? '80mm' : tpl}
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
                value={draft.note}
                onChangeValue={(val) => setDraft((d) => ({ ...d, note: val }))}
                onDictated={() => setDraft((d) => ({ ...d, source: 'voice' }))}
                placeholder="Delivery note, warranty, or payment reference"
                micLabel="Dictate note"
              />
            </div>
          </section>

          {error && (
            <div className="rounded-[10px] border border-[#B91C1C]/30 bg-[#FEF2F2] dark:bg-red-950/30 p-3.5 text-sm text-[#B91C1C] dark:text-red-300 flex items-center justify-between gap-3">
              <span>{error}</span>
              <button
                type="submit"
                disabled={submitting}
                className="shrink-0 min-h-[34px] rounded-lg bg-[#B91C1C] px-3 text-xs font-semibold text-white hover:bg-[#991B1B] disabled:opacity-60"
              >
                Retry
              </button>
            </div>
          )}

          {/* Summary & Submit Bar */}
          <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="label-caps text-[#6B7280] dark:text-[#9CA3AF]">
                Total · {balanceDueKobo === 0 ? 'Paid in full' : 'Part payment'}
              </p>
              <p className="mt-0.5 font-mono-num text-2xl font-semibold text-[#111827] dark:text-[#F3F4F6]">
                {formatKobo(totals.totalKobo, business.currency)}
              </p>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full sm:w-auto min-h-[48px] rounded-[10px] bg-[#064E3B] px-7 py-3 text-sm font-semibold text-white hover:bg-[#04392B] transition-colors disabled:opacity-60"
            >
              {submitting ? 'Issuing Receipt…' : 'Issue Receipt'}
            </button>
          </div>
          {!business.signatureDataUrl && (
            <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              Want your authorized signature on every receipt?{' '}
              <Link
                to="/app/settings"
                className="font-semibold text-[#064E3B] dark:text-[#6EE7B7] hover:underline"
              >
                Upload your signature in Settings →
              </Link>
            </p>
          )}
        </form>

        {/* Live Desktop Preview Column */}
        <aside className="hidden lg:block lg:col-span-5 sticky top-20 space-y-3">
          <div className="flex items-center justify-between">
            <p className="label-caps text-[#6B7280] dark:text-[#9CA3AF]">Live Preview</p>
            <span className="text-xs text-[#6B7280] dark:text-[#9CA3AF] capitalize">
              {draft.template === 'compact' ? 'Compact 80mm' : draft.template}
            </span>
          </div>
          <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-[#F4F6F8]/70 dark:bg-[#111715] p-4 max-h-[calc(100vh-140px)] overflow-y-auto">
            <ReceiptTemplateView receipt={previewRecord} />
          </div>
        </aside>
      </div>

      {/* Mobile Preview Drawer */}
      {mobilePreviewOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex flex-col justify-end lg:hidden">
          <div className="max-h-[90vh] overflow-y-auto rounded-t-3xl bg-[#F6F7F8] dark:bg-[#131917] p-4 pb-8">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-gray-200/70 dark:border-[#1F2925]">
              <span className="label-caps text-[#6B7280]">Live Receipt Preview</span>
              <button
                type="button"
                onClick={() => setMobilePreviewOpen(false)}
                className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-[10px] border border-gray-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <ReceiptTemplateView receipt={previewRecord} />
          </div>
        </div>
      )}

      <NumericKeypad
        open={keypad.open}
        title={keypad.title}
        initialValue={keypad.value}
        mode={keypad.mode}
        currency={business.currency}
        onApply={keypad.onApply}
        onClose={() => setKeypad((k) => ({ ...k, open: false }))}
      />
    </div>
  );
}
