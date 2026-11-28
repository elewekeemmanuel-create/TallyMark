import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  CopyPlus,
  PlusCircle,
  Search,
  Wallet,
} from 'lucide-react';
import { api } from '../lib/api';
import { Link, useRouter } from '../lib/router';
import { formatKobo, formatLagosDateOnly } from '../shared/money';
import type { ReceiptTemplate } from '../shared/schemas';
import type { BusinessProfile, ReceiptRecord } from '../shared/types';
import {
  ReceiptShareBar,
  ReceiveBalanceModal,
  VoidReceiptModal,
} from '../components/ReceiptActionsModal';
import { ReceiptTemplateView, receiptToPublicPreview } from '../components/ReceiptTemplates';

export function ReceiptsListPage({ business }: { business: BusinessProfile }) {
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'ALL' | 'PAID' | 'PART_PAID' | 'VOID'>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getReceipts({
        q: q.trim() || undefined,
        status,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        customer: customerFilter.trim() || undefined,
      });
      setReceipts(res.receipts);
    } catch (err: any) {
      setError(err?.message || 'Unable to load receipts');
    } finally {
      setLoading(false);
    }
  }, [q, status, dateFrom, dateTo, customerFilter]);

  useEffect(() => {
    const timer = setTimeout(load, 150);
    return () => clearTimeout(timer);
  }, [load]);

  const statusText = (r: ReceiptRecord) => {
    if (r.status === 'VOID') return <span className="text-[#B91C1C] font-semibold">Void</span>;
    if (r.status === 'PART_PAID') {
      return (
        <span className="text-[#B45309] dark:text-amber-400 font-semibold">
          Part paid · Due {formatKobo(r.balanceDueKobo, business.currency)}
        </span>
      );
    }
    return <span className="text-[#064E3B] dark:text-[#6EE7B7] font-semibold">Paid</span>;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="label-caps text-[#6B7280] dark:text-[#9CA3AF]">Receipt Register</p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl text-[#111827] dark:text-[#F3F4F6]">
            All Receipts
          </h1>
        </div>
        <Link
          to="/app/new"
          className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-[#064E3B] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#04392B] min-h-[44px]"
        >
          <PlusCircle className="w-4 h-4" />
          <span>New Receipt</span>
        </Link>
      </div>

      {/* Search & Filters */}
      <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-5 relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search receipt #, item, customer, sold by…"
              className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] pl-10 pr-3.5 py-2.5 text-sm min-h-[44px]"
            />
          </div>

          <div className="md:col-span-3">
            <input
              type="text"
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              placeholder="Filter customer…"
              className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3.5 py-2.5 text-sm min-h-[44px]"
            />
          </div>

          <div className="md:col-span-2">
            <input
              type="date"
              aria-label="From date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 py-2.5 font-mono-num text-xs min-h-[44px]"
            />
          </div>

          <div className="md:col-span-2">
            <input
              type="date"
              aria-label="To date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 py-2.5 font-mono-num text-xs min-h-[44px]"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 rounded-[10px] bg-[#F4F6F8] dark:bg-[#1A221F] p-1">
            {(
              [
                { key: 'ALL', label: 'All' },
                { key: 'PAID', label: 'Paid' },
                { key: 'PART_PAID', label: 'Part Paid' },
                { key: 'VOID', label: 'Void' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStatus(tab.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors min-h-[36px] ${
                  status === tab.key
                    ? 'bg-white dark:bg-[#111715] text-[#111827] dark:text-[#F3F4F6] shadow-xs'
                    : 'text-[#6B7280] dark:text-[#9CA3AF]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {(q || status !== 'ALL' || dateFrom || dateTo || customerFilter) && (
            <button
              type="button"
              onClick={() => {
                setQ('');
                setStatus('ALL');
                setDateFrom('');
                setDateTo('');
                setCustomerFilter('');
              }}
              className="text-xs font-medium text-[#064E3B] dark:text-[#6EE7B7] hover:underline"
            >
              Reset filters
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-[10px] border border-[#B91C1C]/30 bg-[#FEF2F2] p-4 text-sm text-[#B91C1C]">
          {error}
        </div>
      )}

      {/* Results */}
      <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-3">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="h-14 rounded-[10px] bg-[#F4F6F8] dark:bg-[#1A221F] animate-pulse" />
            ))}
          </div>
        ) : receipts.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-[#111827] dark:text-[#F3F4F6]">
              No matching receipts found
            </p>
            <p className="mt-1 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              Issue a receipt or clear your search filters to view all records.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-[#1F2925]">
            {receipts.map((r) => (
              <Link
                key={r.id}
                to={`/app/receipts/${r.id}`}
                className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-[#F6F7F8] dark:hover:bg-[#1A221F] transition-colors"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono-num font-semibold">{r.receiptNumber}</span>
                    <span aria-hidden="true" className="text-gray-400">·</span>
                    <span className="font-medium truncate">
                      {r.customerName || 'Walk-in Customer'}
                    </span>
                    {r.receiptKind === 'BALANCE_PAYMENT' && r.parentReceiptNumber && (
                      <>
                        <span aria-hidden="true" className="text-gray-400">·</span>
                        <span className="font-mono-num text-xs text-[#064E3B] dark:text-[#6EE7B7]">
                          Balance for {r.parentReceiptNumber}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                    <span className="font-mono-num">{formatLagosDateOnly(r.issuedDateLagos)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{r.paymentMethod}</span>
                    {r.soldBy && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Sold by {r.soldBy}</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    {statusText(r)}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <p
                    className={`font-mono-num text-sm sm:text-base font-semibold ${
                      r.status === 'VOID' ? 'line-through text-gray-400' : ''
                    }`}
                  >
                    {formatKobo(r.totalKobo, business.currency)}
                  </p>
                  <p className="font-mono-num text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
                    Paid {formatKobo(r.amountPaidKobo, business.currency)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ReceiptDetailPage({
  business,
  receiptId,
}: {
  business: BusinessProfile;
  receiptId: string;
}) {
  const { navigate } = useRouter();
  const [receipt, setReceipt] = useState<ReceiptRecord | null>(null);
  const [linkedPayments, setLinkedPayments] = useState<ReceiptRecord[]>([]);
  const [template, setTemplate] = useState<ReceiptTemplate>(business.defaultTemplate);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [balanceOpen, setBalanceOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getReceipt(receiptId);
      setReceipt(res.receipt);
      setLinkedPayments(res.linkedPayments);
      setTemplate(res.receipt.template || business.defaultTemplate);
    } catch (err: any) {
      setError(err?.message || 'Receipt not found');
    } finally {
      setLoading(false);
    }
  }, [receiptId, business.defaultTemplate]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-10 w-48 rounded-[10px] bg-[#F4F6F8] dark:bg-[#1A221F] animate-pulse" />
        <div className="h-96 rounded-[20px] bg-[#F4F6F8] dark:bg-[#1A221F] animate-pulse" />
      </div>
    );
  }

  if (error || !receipt) {
    return (
      <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-8 text-center space-y-4">
        <p className="font-display text-2xl">{error || 'Receipt not found'}</p>
        <Link
          to="/app/receipts"
          className="inline-flex items-center gap-2 rounded-[10px] bg-[#064E3B] px-4 py-2 text-xs font-semibold text-white"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Receipts</span>
        </Link>
      </div>
    );
  }

  const publicPreview = receiptToPublicPreview(receipt, business);

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to="/app/receipts"
            className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917]"
            aria-label="Back to receipts"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <p className="label-caps text-[#6B7280] dark:text-[#9CA3AF]">
              {receipt.receiptKind === 'BALANCE_PAYMENT' ? 'Balance Receipt' : 'Sale Receipt'}
            </p>
            <h1 className="font-display text-3xl text-[#111827] dark:text-[#F3F4F6]">
              {receipt.receiptNumber}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {receipt.status === 'PART_PAID' && receipt.receiptKind === 'SALE' && (
            <button
              type="button"
              onClick={() => setBalanceOpen(true)}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-[10px] bg-[#064E3B] px-4 py-2 text-xs font-semibold text-white hover:bg-[#04392B]"
            >
              <Wallet className="w-4 h-4" />
              <span>Receive Balance</span>
            </button>
          )}

          {receipt.receiptKind === 'SALE' && (
            <button
              type="button"
              onClick={() => navigate(`/app/new?duplicateFrom=${encodeURIComponent(receipt.id)}`)}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3.5 py-2 text-xs font-medium"
            >
              <CopyPlus className="w-4 h-4" />
              <span>Duplicate</span>
            </button>
          )}

          {receipt.status !== 'VOID' && (
            <button
              type="button"
              onClick={() => setVoidOpen(true)}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-[10px] border border-[#B91C1C]/40 bg-white dark:bg-[#131917] px-3.5 py-2 text-xs font-medium text-[#B91C1C] hover:bg-[#FEF2F2] dark:hover:bg-red-950/30"
            >
              <Ban className="w-4 h-4" />
              <span>Void</span>
            </button>
          )}
        </div>
      </div>

      {/* Template Switcher + Share Bar */}
      <div className="no-print rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="label-caps text-[#6B7280] dark:text-[#9CA3AF]">
            Preview &amp; Export Template
          </span>
          <div className="inline-flex items-center gap-1 rounded-[10px] bg-[#F4F6F8] dark:bg-[#1A221F] p-1">
            {(['modern', 'classic', 'compact'] as ReceiptTemplate[]).map((tpl) => (
              <button
                key={tpl}
                type="button"
                onClick={() => setTemplate(tpl)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize ${
                  template === tpl
                    ? 'bg-white dark:bg-[#111715] text-[#111827] dark:text-[#F3F4F6] shadow-xs'
                    : 'text-[#6B7280] dark:text-[#9CA3AF]'
                }`}
              >
                {tpl === 'compact' ? '80mm Thermal' : tpl}
              </button>
            ))}
          </div>
        </div>

        <ReceiptShareBar receipt={publicPreview} activeTemplate={template} />
      </div>

      {/* Linked Receipts (parent or balance payments) */}
      {(receipt.parentReceiptId || linkedPayments.length > 0) && (
        <div className="no-print rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-4 space-y-2">
          <p className="label-caps text-[#6B7280] dark:text-[#9CA3AF]">Linked Receipts</p>
          {receipt.parentReceiptId && receipt.parentReceiptNumber && (
            <Link
              to={`/app/receipts/${receipt.parentReceiptId}`}
              className="text-xs font-semibold text-[#064E3B] dark:text-[#6EE7B7] hover:underline"
            >
              View original sale receipt {receipt.parentReceiptNumber} →
            </Link>
          )}
          {linkedPayments.map((lp) => (
            <Link
              key={lp.id}
              to={`/app/receipts/${lp.id}`}
              className="flex items-center justify-between text-xs py-1.5 border-t border-gray-100 dark:border-[#1F2925] hover:underline"
            >
              <span className="font-mono-num font-semibold">
                {lp.receiptNumber} ({formatLagosDateOnly(lp.issuedDateLagos)})
              </span>
              <span className="font-mono-num">
                {formatKobo(lp.totalKobo, business.currency)} · {lp.status === 'VOID' ? 'VOID' : lp.paymentMethod}
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* Printable Receipt View */}
      <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-[#F4F6F8]/60 dark:bg-[#111715] p-4 sm:p-6">
        <ReceiptTemplateView receipt={publicPreview} templateOverride={template} />
      </div>

      {voidOpen && (
        <VoidReceiptModal
          receipt={receipt}
          onClose={() => setVoidOpen(false)}
          onVoided={(updated) => {
            setReceipt(updated);
            load();
          }}
        />
      )}

      {balanceOpen && (
        <ReceiveBalanceModal
          receipt={receipt}
          business={business}
          onClose={() => setBalanceOpen(false)}
          onRecorded={(child) => {
            navigate(`/app/receipts/${child.id}`);
          }}
        />
      )}
    </div>
  );
}
