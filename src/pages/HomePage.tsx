import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CreditCard,
  FileText,
  Mic,
  PlusCircle,
  ReceiptText,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import { ReceiveBalanceModal } from '../components/ReceiptActionsModal';
import { api } from '../lib/api';
import { Link } from '../lib/router';
import { toggleInvoicesQuotesModule } from '../lib/v2ModuleToggle';
import { formatKobo, formatLagosDateOnly } from '../shared/money';
import type {
  BusinessProfile,
  CashBookRow,
  DebtorCustomerGroup,
  HomeSummary,
  ReceiptRecord,
} from '../shared/types';
import { isInvoicesQuotesModuleEnabled } from '../shared/v2/entitlements';

const V2HomeSummaryCards = lazy(() =>
  import('../v2/components/V2HomeSummaryCards').then((m) => ({ default: m.V2HomeSummaryCards }))
);

export function HomePage({
  business,
  onBusinessUpdated,
}: {
  business: BusinessProfile;
  onBusinessUpdated?: (biz: BusinessProfile) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [recentReceipts, setRecentReceipts] = useState<ReceiptRecord[]>([]);
  const [outstandingReceipts, setOutstandingReceipts] = useState<ReceiptRecord[]>([]);
  const [debtorsPreview, setDebtorsPreview] = useState<DebtorCustomerGroup[]>([]);
  const [todayEntries, setTodayEntries] = useState<CashBookRow[]>([]);
  const [balanceTarget, setBalanceTarget] = useState<ReceiptRecord | null>(null);
  const [moduleBusy, setModuleBusy] = useState(false);

  const v2Enabled = isInvoicesQuotesModuleEnabled(business);

  const handleEnableV2 = async () => {
    setModuleBusy(true);
    setError(null);
    try {
      const res = await toggleInvoicesQuotesModule({ enabled: true });
      onBusinessUpdated?.(res.business);
    } catch (err: any) {
      setError(err?.message || 'Unable to turn on Invoices & Quotes');
    } finally {
      setModuleBusy(false);
    }
  };

  const handleDismissPromo = async () => {
    setModuleBusy(true);
    try {
      const res = await toggleInvoicesQuotesModule({ dismissPromo: true });
      onBusinessUpdated?.(res.business);
    } catch {
      // ignore
    } finally {
      setModuleBusy(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getHome();
      setSummary(res.summary);
      setRecentReceipts(res.recentReceipts);
      setOutstandingReceipts(res.outstandingReceipts);
      setDebtorsPreview(res.debtorsPreview || []);
      setTodayEntries(res.todayEntries || []);
    } catch (err: any) {
      setError(err?.message || 'Unable to load home summary');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const statusBadge = (r: ReceiptRecord) => {
    if (r.status === 'VOID') {
      return (
        <span className="inline-flex items-center rounded-full bg-[#FEF2F2] dark:bg-red-950/50 px-2 py-0.5 text-[11px] font-medium text-[#B91C1C] dark:text-red-300">
          Void
        </span>
      );
    }
    if (r.status === 'PART_PAID') {
      return (
        <span className="inline-flex items-center rounded-full bg-[#FFFBEB] dark:bg-amber-950/50 px-2 py-0.5 text-[11px] font-medium text-[#B45309] dark:text-amber-300">
          Part paid · Due {formatKobo(r.balanceDueKobo, business.currency)}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-full bg-[#ECFDF5] dark:bg-emerald-950/50 px-2 py-0.5 text-[11px] font-medium text-[#047857] dark:text-[#6EE7B7]">
        Paid
      </span>
    );
  };

  const hasAnyActivity =
    Boolean(summary) &&
    (summary!.totalReceiptsCount > 0 ||
      todayEntries.length > 0 ||
      summary!.outstandingCount > 0 ||
      summary!.todayExpensesKobo > 0);

  return (
    <div className="space-y-6">
      {/* Unclosed Previous Day Banner */}
      {!loading && summary && !summary.yesterdayClosed && summary.yesterdayHasActivity && (
        <div className="rounded-[20px] bg-[#FFFBEB] dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-sm text-[#92400E] dark:text-amber-200">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Yesterday ({formatLagosDateOnly(summary.yesterdayDateLagos)}) has unclosed entries. Close your day to lock the cash count (reminder set for {business.closeDayReminderTime || '19:00'}).
            </span>
          </div>
          <Link
            to="/app/cashbook"
            className="shrink-0 min-h-[40px] inline-flex items-center justify-center rounded-[10px] bg-[#B45309] px-4 text-xs font-semibold text-white hover:bg-[#92400E] transition-colors"
          >
            Close Yesterday
          </Link>
        </div>
      )}

      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">
            {summary ? formatLagosDateOnly(summary.todayDateLagos) : 'Today'} · Africa/Lagos
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-semibold tracking-[-0.025em] text-[#111827] dark:text-[#F3F4F6]">
            {business.name}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            to="/app/cashbook"
            className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-white dark:bg-[#131917] border border-gray-200/80 dark:border-[#232D29] px-4 py-2.5 text-xs font-semibold text-[#111827] dark:text-[#F3F4F6] hover:bg-gray-50 dark:hover:bg-[#1A221F] transition-colors min-h-[44px]"
          >
            <BookOpen className="w-4 h-4 text-[#047857] dark:text-[#6EE7B7]" />
            <span>Open Cash Book</span>
          </Link>
          <Link
            to="/app/new"
            className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-[#064E3B] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#04392B] active:scale-[0.98] transition-all min-h-[44px] whitespace-nowrap"
          >
            <PlusCircle className="w-4 h-4 text-[#6EE7B7]" />
            <span>New Receipt</span>
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-[20px] bg-[#FEF2F2] dark:bg-red-950/30 border border-red-200/80 dark:border-red-900/50 p-4 flex items-center justify-between gap-4 text-sm text-[#B91C1C] dark:text-red-300">
          <span>{error}</span>
          <button type="button" onClick={load} className="font-semibold underline">
            Retry
          </button>
        </div>
      )}

      {/* Hero Row: Dark Emerald Today Balance Card + Soft Mint Speak Your Day Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 rounded-[24px] bg-[#064E3B] text-white p-6 sm:p-7 flex flex-col justify-between gap-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-[#A7F3D0]">Today’s Net Balance</p>
              <p
                className={`mt-2 font-mono-num text-3xl sm:text-4xl font-semibold tracking-[-0.02em] ${
                  (summary?.todayNetKobo ?? 0) >= 0 ? 'text-white' : 'text-red-200'
                }`}
              >
                {loading ? '—' : formatKobo(summary?.todayNetKobo || 0, business.currency)}
              </p>
              <p className="mt-1.5 text-xs text-[#D1FAE5] font-mono-num">
                {loading
                  ? 'Loading today’s totals…'
                  : `Money in ${formatKobo(summary?.todayMoneyReceivedKobo || 0, business.currency)} · ${summary?.todayReceiptsCount || 0} receipt${summary?.todayReceiptsCount === 1 ? '' : 's'}`}
              </p>
            </div>
            <span className="inline-flex items-center rounded-full bg-white/12 px-3 py-1 text-xs font-medium text-[#6EE7B7] shrink-0">
              Live Day
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-4 border-t border-white/12">
            <div>
              <p className="text-[11px] text-[#A7F3D0]">Sales</p>
              <p className="mt-1 font-mono-num text-sm sm:text-base font-semibold text-white">
                {loading ? '—' : formatKobo(summary?.todaySalesTotalKobo || 0, business.currency)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[#A7F3D0]">Expenses</p>
              <p className="mt-1 font-mono-num text-sm sm:text-base font-semibold text-red-200">
                {loading ? '—' : formatKobo(summary?.todayExpensesKobo || 0, business.currency)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[#A7F3D0]">Cash in hand</p>
              <p className="mt-1 font-mono-num text-sm sm:text-base font-semibold text-[#6EE7B7]">
                {loading ? '—' : formatKobo(summary?.cashInHandKobo || 0, business.currency)}
              </p>
            </div>
          </div>
        </div>

        {/* Speak Your Day Voice CTA */}
        <Link
          to="/app/speak"
          aria-label="Speak your day"
          className="group lg:col-span-5 rounded-[24px] bg-[#ECFDF5] dark:bg-[#13221C] p-6 sm:p-7 flex flex-col justify-between gap-5 hover:bg-[#D1FAE5]/70 dark:hover:bg-[#182C24] transition-colors"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="w-12 h-12 rounded-[14px] bg-[#064E3B] text-[#6EE7B7] flex items-center justify-center shrink-0 group-hover:bg-[#04392B] transition-colors">
              <Mic className="w-6 h-6" />
            </div>
            <span className="inline-flex items-center rounded-full bg-white dark:bg-[#0B0F0E]/60 px-3 py-1 text-xs font-medium text-[#047857] dark:text-[#6EE7B7]">
              Voice Draft
            </span>
          </div>

          <div>
            <p className="text-xl font-semibold tracking-[-0.02em] text-[#111827] dark:text-[#F3F4F6]">
              Speak your day
            </p>
            <p className="mt-1.5 text-sm text-[#4B5563] dark:text-[#D1D5DB] leading-relaxed">
              “Spent five thousand on transport, Mama Ngozi owes me eight thousand…”
            </p>
          </div>

          <div className="inline-flex items-center gap-2 text-sm font-semibold text-[#064E3B] dark:text-[#6EE7B7]">
            <span>Tap &amp; Speak</span>
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
          </div>
        </Link>
      </div>

      {/* Fast Entry Bar + Debtors Highlight */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Link
          to="/app/new"
          className="rounded-[18px] bg-white dark:bg-[#131917] p-4 flex items-center gap-3 hover:bg-[#ECFDF5]/60 dark:hover:bg-[#1A221F] transition-colors min-h-[60px]"
        >
          <span className="w-9 h-9 rounded-[10px] bg-[#ECFDF5] dark:bg-[#064E3B]/40 text-[#064E3B] dark:text-[#6EE7B7] flex items-center justify-center shrink-0">
            <ReceiptText className="w-4 h-4" />
          </span>
          <span className="text-sm font-semibold text-[#111827] dark:text-[#F3F4F6]">
            New Receipt
          </span>
        </Link>
        <Link
          to="/app/quick-sale"
          className="rounded-[18px] bg-white dark:bg-[#131917] p-4 flex items-center gap-3 hover:bg-[#ECFDF5]/60 dark:hover:bg-[#1A221F] transition-colors min-h-[60px]"
        >
          <span className="w-9 h-9 rounded-[10px] bg-[#EFF6FF] dark:bg-blue-950/40 text-[#1D4ED8] dark:text-blue-300 flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4" />
          </span>
          <span className="text-sm font-semibold text-[#111827] dark:text-[#F3F4F6]">
            Quick Sale
          </span>
        </Link>
        <Link
          to="/app/credit-sale"
          className="rounded-[18px] bg-white dark:bg-[#131917] p-4 flex items-center gap-3 hover:bg-[#FFFBEB] dark:hover:bg-[#1A221F] transition-colors min-h-[60px]"
        >
          <span className="w-9 h-9 rounded-[10px] bg-[#FFFBEB] dark:bg-amber-950/40 text-[#B45309] dark:text-amber-300 flex items-center justify-center shrink-0">
            <CreditCard className="w-4 h-4" />
          </span>
          <span className="text-sm font-semibold text-[#111827] dark:text-[#F3F4F6]">
            Credit Sale
          </span>
        </Link>
        <Link
          to="/app/expenses?new=1"
          className="rounded-[18px] bg-white dark:bg-[#131917] p-4 flex items-center gap-3 hover:bg-[#FEF2F2]/70 dark:hover:bg-[#1A221F] transition-colors min-h-[60px]"
        >
          <span className="w-9 h-9 rounded-[10px] bg-[#FEF2F2] dark:bg-red-950/40 text-[#B91C1C] dark:text-red-300 flex items-center justify-center shrink-0">
            <Wallet className="w-4 h-4" />
          </span>
          <span className="text-sm font-semibold text-[#111827] dark:text-[#F3F4F6]">
            Add Expense
          </span>
        </Link>
        <Link
          to="/app/debtors"
          className="col-span-2 lg:col-span-1 rounded-[18px] bg-white dark:bg-[#131917] p-4 flex items-center justify-between gap-2 hover:bg-[#FFFBEB]/70 dark:hover:bg-[#1A221F] transition-colors min-h-[60px]"
        >
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-[#6B7280] dark:text-[#9CA3AF]">
              Owed to you
            </p>
            <p className="font-mono-num text-base font-semibold text-[#B45309] dark:text-amber-400 truncate">
              {loading ? '—' : formatKobo(summary?.outstandingTotalKobo || 0, business.currency)}
            </p>
          </div>
          <span className="text-xs font-semibold text-[#064E3B] dark:text-[#6EE7B7] shrink-0">
            {loading ? '' : `${summary?.outstandingCount || 0} open`}
          </span>
        </Link>
      </div>

      {/* Optional Invoices & Quotes Module: one dismissible card when OFF; summary cards when ON */}
      {!v2Enabled && !business.v2PromoDismissed && (
        <div className="rounded-[24px] bg-white dark:bg-[#131917] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-[12px] bg-[#EFF6FF] dark:bg-blue-950/40 text-[#064E3B] dark:text-[#6EE7B7] flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#111827] dark:text-[#F3F4F6]">
                Invoices &amp; Quotes
              </p>
              <p className="mt-0.5 text-sm text-[#6B7280] dark:text-[#9CA3AF]">
                Send invoices with bank transfer details and issue receipts when paid. Turn off anytime in Settings.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={moduleBusy}
              onClick={handleEnableV2}
              className="min-h-[42px] rounded-[10px] bg-[#064E3B] px-4 py-2 text-xs font-semibold text-white hover:bg-[#04392B] disabled:opacity-60 transition-colors"
            >
              {moduleBusy ? 'Turning on…' : 'Turn on'}
            </button>
            <button
              type="button"
              disabled={moduleBusy}
              onClick={handleDismissPromo}
              aria-label="Dismiss"
              className="min-w-[42px] min-h-[42px] inline-flex items-center justify-center rounded-[10px] bg-[#F4F6F8] dark:bg-[#1A221F] text-[#6B7280] hover:text-[#111827] dark:hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {v2Enabled && (
        <Suspense fallback={null}>
          <V2HomeSummaryCards business={business} />
        </Suspense>
      )}

      {/* Empty State when 0 receipts/entries exist */}
      {!loading && summary && !hasAnyActivity ? (
        <div className="rounded-[24px] bg-white dark:bg-[#131917] p-8 sm:p-12 text-center max-w-2xl mx-auto">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-[#ECFDF5] dark:bg-[#064E3B]/40 flex items-center justify-center text-[#064E3B] dark:text-[#6EE7B7]">
            <ReceiptText className="w-7 h-7" />
          </div>
          <h2 className="mt-5 text-2xl font-semibold tracking-[-0.02em] text-[#111827] dark:text-[#F3F4F6]">
            Your receipt book &amp; cash book are ready
          </h2>
          <p className="mt-2 text-sm text-[#6B7280] dark:text-[#9CA3AF] max-w-md mx-auto leading-relaxed">
            Issue your first receipt starting at{' '}
            <span className="font-mono-num font-semibold text-[#111827] dark:text-[#F3F4F6]">
              {business.receiptPrefix}0001
            </span>
            , log a 5-second quick sale, or record today’s expenses.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              to="/app/new"
              className="inline-flex items-center gap-2 rounded-[10px] bg-[#064E3B] px-6 py-3 text-sm font-semibold text-white hover:bg-[#04392B] min-h-[48px] transition-colors"
            >
              <span>Issue First Receipt</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/app/quick-sale"
              className="inline-flex items-center gap-2 rounded-[10px] bg-[#F4F6F8] dark:bg-[#1A221F] px-5 py-3 text-sm font-semibold text-[#111827] dark:text-[#F3F4F6] hover:bg-gray-200/70 min-h-[48px] transition-colors"
            >
              <span>Record Quick Sale</span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Today's Cash Book & Recent Receipts */}
          <div className="lg:col-span-7 space-y-6">
            <section className="rounded-[24px] bg-white dark:bg-[#131917] overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-[#1F2925] flex items-center justify-between gap-4">
                <h2 className="text-base font-semibold text-[#111827] dark:text-[#F3F4F6]">
                  Today’s Cash Book Activity
                </h2>
                <Link
                  to="/app/cashbook"
                  className="text-xs font-semibold text-[#047857] dark:text-[#6EE7B7] hover:underline"
                >
                  Open Cash Book
                </Link>
              </div>
              {loading ? (
                <div className="p-6 space-y-3">
                  {[1, 2].map((n) => (
                    <div
                      key={n}
                      className="h-12 rounded-xl bg-[#F4F6F8] dark:bg-[#1A221F] animate-pulse"
                    />
                  ))}
                </div>
              ) : todayEntries.length === 0 ? (
                <div className="p-6 text-sm text-[#6B7280] dark:text-[#9CA3AF]">
                  No entries recorded for today yet.
                </div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-[#1F2925]">
                  {todayEntries.map((row) => (
                    <div
                      key={row.entry.id}
                      className="px-6 py-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#111827] dark:text-[#F3F4F6] truncate">
                          {row.entry.note || row.entry.entryKind}
                        </p>
                        <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                          {row.entry.paymentMethod || 'Cash'}
                          {row.entry.customerName ? ` · ${row.entry.customerName}` : ''}
                          {row.entry.source === 'voice' ? ' · Voice' : ''}
                        </p>
                      </div>
                      <span
                        className={`font-mono-num text-sm font-semibold shrink-0 ${
                          row.moneyInKobo > 0
                            ? 'text-[#047857] dark:text-[#6EE7B7]'
                            : row.moneyOutKobo > 0
                            ? 'text-[#B91C1C] dark:text-red-400'
                            : 'text-[#B45309] dark:text-amber-400'
                        }`}
                      >
                        {row.moneyInKobo > 0
                          ? `+${formatKobo(row.moneyInKobo, business.currency)}`
                          : row.moneyOutKobo > 0
                          ? `-${formatKobo(row.moneyOutKobo, business.currency)}`
                          : `${formatKobo(row.entry.amountKobo, business.currency)} credit`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-[24px] bg-white dark:bg-[#131917] overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-[#1F2925] flex items-center justify-between gap-4">
                <h2 className="text-base font-semibold text-[#111827] dark:text-[#F3F4F6]">
                  Recent Receipts
                </h2>
                <Link
                  to="/app/receipts"
                  className="text-xs font-semibold text-[#047857] dark:text-[#6EE7B7] hover:underline"
                >
                  View all
                </Link>
              </div>
              {recentReceipts.length === 0 ? (
                <div className="p-6 text-sm text-[#6B7280] dark:text-[#9CA3AF]">
                  No receipts issued yet.
                </div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-[#1F2925]">
                  {recentReceipts.map((r) => (
                    <Link
                      key={r.id}
                      to={`/app/receipts/${r.id}`}
                      className="flex items-center justify-between gap-4 px-6 py-3.5 hover:bg-[#F6F7F8] dark:hover:bg-[#1A221F] transition-colors min-h-[60px]"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-mono-num font-semibold text-[#111827] dark:text-[#F3F4F6]">
                            {r.receiptNumber}
                          </span>
                          <span aria-hidden="true" className="text-gray-300 dark:text-gray-600">
                            ·
                          </span>
                          <span className="font-medium text-[#111827] dark:text-[#F3F4F6] truncate">
                            {r.customerName || 'Walk-in Customer'}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                          <span>{formatLagosDateOnly(r.issuedDateLagos)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{r.paymentMethod}</span>
                          {statusBadge(r)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p
                          className={`font-mono-num text-sm font-semibold ${
                            r.status === 'VOID'
                              ? 'line-through text-gray-400'
                              : 'text-[#111827] dark:text-[#F3F4F6]'
                          }`}
                        >
                          {formatKobo(r.totalKobo, business.currency)}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Customers Owing */}
          <section className="lg:col-span-5 rounded-[24px] bg-white dark:bg-[#131917] overflow-hidden h-fit">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-[#1F2925] flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#111827] dark:text-[#F3F4F6]">
                Customers Owing
              </h2>
              <Link
                to="/app/debtors"
                className="text-xs font-semibold text-[#047857] dark:text-[#6EE7B7] hover:underline"
              >
                Manage Debtors
              </Link>
            </div>

            {loading ? (
              <div className="p-6 space-y-3">
                {[1, 2].map((n) => (
                  <div
                    key={n}
                    className="h-12 rounded-xl bg-[#F4F6F8] dark:bg-[#1A221F] animate-pulse"
                  />
                ))}
              </div>
            ) : debtorsPreview.length === 0 && outstandingReceipts.length === 0 ? (
              <div className="p-6 text-sm text-[#6B7280] dark:text-[#9CA3AF]">
                No outstanding debts right now. Every sale is settled.
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-[#1F2925]">
                {debtorsPreview.map((g) => {
                  const firstReceipt =
                    g.debts.find((d) => d.debtKind === 'RECEIPT') &&
                    outstandingReceipts.find((r) => r.customerName === g.customerName);
                  return (
                    <div
                      key={g.customerKey}
                      className="px-6 py-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <Link
                          to="/app/debtors"
                          className="text-sm font-semibold text-[#111827] dark:text-[#F3F4F6] hover:underline block truncate"
                        >
                          {g.customerName}
                        </Link>
                        <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] font-mono-num">
                          {g.openCount} item{g.openCount === 1 ? '' : 's'} ·{' '}
                          {g.oldestDebtAgeDays === 0 ? 'Today' : `${g.oldestDebtAgeDays}d old`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono-num text-sm font-semibold text-[#B45309] dark:text-amber-400">
                          {formatKobo(g.totalOwedKobo, business.currency)}
                        </span>
                        {firstReceipt && (
                          <button
                            type="button"
                            onClick={() => setBalanceTarget(firstReceipt)}
                            className="min-h-[36px] rounded-[10px] bg-[#ECFDF5] dark:bg-[#064E3B]/40 hover:bg-[#D1FAE5] px-3 text-xs font-semibold text-[#064E3B] dark:text-[#6EE7B7] transition-colors"
                          >
                            Receive
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {balanceTarget && (
        <ReceiveBalanceModal
          receipt={balanceTarget}
          business={business}
          onClose={() => setBalanceTarget(null)}
          onRecorded={() => {
            load();
          }}
        />
      )}
    </div>
  );
}
