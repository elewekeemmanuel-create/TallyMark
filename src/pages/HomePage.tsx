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

  const statusText = (r: ReceiptRecord) => {
    if (r.status === 'VOID') return <span className="text-[#B91C1C] font-medium">Void</span>;
    if (r.status === 'PART_PAID') {
      return (
        <span className="text-[#B45309] dark:text-amber-400 font-medium">
          Part paid · Due {formatKobo(r.balanceDueKobo, business.currency)}
        </span>
      );
    }
    return <span className="text-[#064E3B] dark:text-[#10B981] font-medium">Paid</span>;
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
        <div className="rounded-2xl border border-[#B45309]/40 bg-[#FEF3C7]/70 dark:bg-amber-950/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-sm text-[#92400E] dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Yesterday ({formatLagosDateOnly(summary.yesterdayDateLagos)}) has unclosed entries. Close your day to lock the cash count (reminder set for {business.closeDayReminderTime || '19:00'}).
            </span>
          </div>
          <Link
            to="/app/cashbook"
            className="shrink-0 min-h-[38px] inline-flex items-center justify-center rounded-xl bg-[#B45309] px-4 text-xs font-semibold text-white hover:bg-[#92400E]"
          >
            Close Yesterday
          </Link>
        </div>
      )}

      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">
            {summary ? formatLagosDateOnly(summary.todayDateLagos) : 'Today'} · Africa/Lagos
          </p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl text-[#121513] dark:text-[#F4F1EA]">
            {business.name}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/app/cashbook"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] px-4 py-2.5 text-xs font-semibold min-h-[44px]"
          >
            <BookOpen className="w-4 h-4 text-[#064E3B] dark:text-[#10B981]" />
            <span>Open Cash Book</span>
          </Link>
          <Link
            to="/app/new"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#064E3B] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#04392B] transition-colors min-h-[44px] whitespace-nowrap"
          >
            <PlusCircle className="w-4 h-4" />
            <span>New Receipt</span>
          </Link>
        </div>
      </div>

      {/* Large Speak Your Day Mic CTA */}
      <Link
        to="/app/speak"
        aria-label="Speak your day"
        className="group rounded-2xl border border-[#064E3B]/25 dark:border-[#10B981]/30 bg-white dark:bg-[#151B18] p-4 sm:p-5 flex items-center justify-between gap-4 hover:border-[#064E3B] dark:hover:border-[#10B981] transition-colors"
      >
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-[#064E3B] text-white flex items-center justify-center shrink-0 shadow-sm group-hover:bg-[#04392B] transition-colors">
            <Mic className="w-7 h-7" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-display text-2xl text-[#121513] dark:text-[#F4F1EA]">
                Speak your day
              </p>
              <span className="label-caps text-[#064E3B] dark:text-[#10B981]">Voice Draft</span>
            </div>
            <p className="mt-0.5 text-xs sm:text-sm text-[#5C635D] dark:text-[#9BA39D] truncate">
              “I spent five thousand on transport, Mama Ngozi owes me eight thousand…”
            </p>
          </div>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 rounded-xl bg-[#064E3B]/10 dark:bg-[#10B981]/15 px-3.5 py-2 text-xs font-semibold text-[#064E3B] dark:text-[#10B981] shrink-0">
          <span>Tap &amp; Speak</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </span>
      </Link>

      {/* Fast Entry Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Link
          to="/app/new"
          className="rounded-xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-3.5 flex items-center gap-2.5 hover:bg-[#F5F1E7] dark:hover:bg-[#1B231F] min-h-[52px]"
        >
          <ReceiptText className="w-4 h-4 text-[#064E3B] dark:text-[#10B981] shrink-0" />
          <span className="text-xs font-semibold">New Receipt</span>
        </Link>
        <Link
          to="/app/quick-sale"
          className="rounded-xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-3.5 flex items-center gap-2.5 hover:bg-[#F5F1E7] dark:hover:bg-[#1B231F] min-h-[52px]"
        >
          <Zap className="w-4 h-4 text-[#064E3B] dark:text-[#10B981] shrink-0" />
          <span className="text-xs font-semibold">Quick Sale</span>
        </Link>
        <Link
          to="/app/credit-sale"
          className="rounded-xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-3.5 flex items-center gap-2.5 hover:bg-[#F5F1E7] dark:hover:bg-[#1B231F] min-h-[52px]"
        >
          <CreditCard className="w-4 h-4 text-[#B45309] dark:text-amber-400 shrink-0" />
          <span className="text-xs font-semibold">Credit Sale</span>
        </Link>
        <Link
          to="/app/expenses?new=1"
          className="rounded-xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-3.5 flex items-center gap-2.5 hover:bg-[#F5F1E7] dark:hover:bg-[#1B231F] min-h-[52px]"
        >
          <Wallet className="w-4 h-4 text-[#B91C1C] dark:text-red-400 shrink-0" />
          <span className="text-xs font-semibold">Add Expense</span>
        </Link>
      </div>

      {error && (
        <div className="rounded-xl border border-[#B91C1C]/30 bg-[#FEF2F2] dark:bg-red-950/30 p-4 flex items-center justify-between gap-4 text-sm text-[#B91C1C] dark:text-red-300">
          <span>{error}</span>
          <button type="button" onClick={load} className="font-semibold underline">
            Retry
          </button>
        </div>
      )}

      {/* Phase 2 KPI Strip: Today's Sales, Expenses, Net, Cash in Hand, Debts Owed */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-4">
          <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Today’s Sales</p>
          <p className="mt-1.5 font-mono-num text-xl sm:text-2xl font-semibold text-[#121513] dark:text-[#F4F1EA]">
            {loading ? '—' : formatKobo(summary?.todaySalesTotalKobo || 0, business.currency)}
          </p>
          <p className="mt-1 text-[11px] text-[#5C635D] dark:text-[#9BA39D] tabular-nums-ui">
            {loading ? '' : `${summary?.todayReceiptsCount || 0} receipt${summary?.todayReceiptsCount === 1 ? '' : 's'} today`}
          </p>
        </div>

        <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-4">
          <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Today’s Expenses</p>
          <p className="mt-1.5 font-mono-num text-xl sm:text-2xl font-semibold text-[#B91C1C] dark:text-red-400">
            {loading ? '—' : formatKobo(summary?.todayExpensesKobo || 0, business.currency)}
          </p>
          <p className="mt-1 text-[11px] text-[#5C635D] dark:text-[#9BA39D]">
            Money out today
          </p>
        </div>

        <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-4">
          <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">
            Net (money in − out)
          </p>
          <p
            className={`mt-1.5 font-mono-num text-xl sm:text-2xl font-semibold ${
              (summary?.todayNetKobo ?? 0) >= 0
                ? 'text-[#064E3B] dark:text-[#10B981]'
                : 'text-[#B91C1C] dark:text-red-400'
            }`}
          >
            {loading ? '—' : formatKobo(summary?.todayNetKobo || 0, business.currency)}
          </p>
          <p className="mt-1 text-[11px] text-[#5C635D] dark:text-[#9BA39D] font-mono-num">
            {loading ? '' : `In ${formatKobo(summary?.todayMoneyReceivedKobo || 0, business.currency)}`}
          </p>
        </div>

        <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-4">
          <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Cash in Hand</p>
          <p className="mt-1.5 font-mono-num text-xl sm:text-2xl font-semibold text-[#064E3B] dark:text-[#10B981]">
            {loading ? '—' : formatKobo(summary?.cashInHandKobo || 0, business.currency)}
          </p>
          <p className="mt-1 text-[11px] text-[#5C635D] dark:text-[#9BA39D]">
            Physical cash drawer
          </p>
        </div>

        <Link
          to="/app/debtors"
          className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-4 hover:bg-[#FAF8F3] dark:hover:bg-[#1B231F]"
        >
          <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Debts Owed to You</p>
          <p className="mt-1.5 font-mono-num text-xl sm:text-2xl font-semibold text-[#B45309] dark:text-amber-400">
            {loading ? '—' : formatKobo(summary?.outstandingTotalKobo || 0, business.currency)}
          </p>
          <p className="mt-1 text-[11px] text-[#5C635D] dark:text-[#9BA39D] tabular-nums-ui">
            {loading
              ? ''
              : `${summary?.outstandingCount || 0} open debt${summary?.outstandingCount === 1 ? '' : 's'} · View`}
          </p>
        </Link>
      </div>

      {/* Optional Invoices & Quotes Module: one dismissible card when OFF; summary cards when ON */}
      {!v2Enabled && !business.v2PromoDismissed && (
        <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#F3EFE6] dark:bg-[#1B231F] text-[#064E3B] dark:text-[#10B981] flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#121513] dark:text-[#F4F1EA]">
                Invoices &amp; Quotes
              </p>
              <p className="mt-0.5 text-xs text-[#5C635D] dark:text-[#9BA39D]">
                Send company-grade invoices with bank transfer details and issue receipts when paid. You can turn this off anytime in Settings.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={moduleBusy}
              onClick={handleEnableV2}
              className="min-h-[40px] rounded-xl bg-[#064E3B] px-4 py-2 text-xs font-semibold text-white hover:bg-[#04392B] disabled:opacity-60"
            >
              {moduleBusy ? 'Turning on…' : 'Turn on'}
            </button>
            <button
              type="button"
              disabled={moduleBusy}
              onClick={handleDismissPromo}
              aria-label="Dismiss"
              className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-xl border border-[#DED6C2] dark:border-[#2B352F] text-[#5C635D] hover:bg-[#F5F1E7] dark:hover:bg-[#1B231F]"
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
        <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-8 sm:p-12 text-center max-w-2xl mx-auto">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-[#F3EFE6] dark:bg-[#1B231F] flex items-center justify-center text-[#064E3B] dark:text-[#10B981]">
            <ReceiptText className="w-6 h-6" />
          </div>
          <h2 className="mt-4 font-display text-3xl text-[#121513] dark:text-[#F4F1EA]">
            Your receipt book &amp; cash book are ready
          </h2>
          <p className="mt-2 text-sm text-[#5C635D] dark:text-[#9BA39D] max-w-md mx-auto">
            Issue your first receipt starting at{' '}
            <span className="font-mono-num font-semibold text-[#121513] dark:text-[#F4F1EA]">
              {business.receiptPrefix}0001
            </span>
            , log a 5-second quick sale, or record today’s expenses.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              to="/app/new"
              className="inline-flex items-center gap-2 rounded-xl bg-[#064E3B] px-6 py-3 text-sm font-semibold text-white hover:bg-[#04392B] min-h-[48px]"
            >
              <span>Issue First Receipt</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/app/quick-sale"
              className="inline-flex items-center gap-2 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] px-5 py-3 text-sm font-semibold min-h-[48px]"
            >
              <span>Record Quick Sale</span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Recent Receipts & Today's Cash Book */}
          <div className="lg:col-span-7 space-y-6">
            <section className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] overflow-hidden">
              <div className="px-5 py-4 border-b border-[#ECE6D8] dark:border-[#242D28] flex items-center justify-between gap-4">
                <h2 className="text-sm font-semibold text-[#121513] dark:text-[#F4F1EA]">
                  Today’s Cash Book Activity
                </h2>
                <Link
                  to="/app/cashbook"
                  className="text-xs font-medium text-[#064E3B] dark:text-[#10B981] hover:underline"
                >
                  Open Cash Book
                </Link>
              </div>
              {loading ? (
                <div className="p-5 space-y-3">
                  {[1, 2].map((n) => (
                    <div key={n} className="h-12 rounded-xl bg-[#F3EFE6] dark:bg-[#1B231F] animate-pulse" />
                  ))}
                </div>
              ) : todayEntries.length === 0 ? (
                <div className="p-5 text-sm text-[#5C635D] dark:text-[#9BA39D]">
                  No entries recorded for today yet.
                </div>
              ) : (
                <div className="divide-y divide-[#ECE6D8] dark:divide-[#242D28]">
                  {todayEntries.map((row) => (
                    <div key={row.entry.id} className="px-5 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {row.entry.note || row.entry.entryKind}
                        </p>
                        <p className="text-xs text-[#5C635D] dark:text-[#9BA39D]">
                          {row.entry.paymentMethod || 'Cash'}
                          {row.entry.customerName ? ` · ${row.entry.customerName}` : ''}
                          {row.entry.source === 'voice' ? ' · Voice' : ''}
                        </p>
                      </div>
                      <span
                        className={`font-mono-num text-sm font-semibold shrink-0 ${
                          row.moneyInKobo > 0
                            ? 'text-[#064E3B] dark:text-[#10B981]'
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

            <section className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] overflow-hidden">
              <div className="px-5 py-4 border-b border-[#ECE6D8] dark:border-[#242D28] flex items-center justify-between gap-4">
                <h2 className="text-sm font-semibold text-[#121513] dark:text-[#F4F1EA]">
                  Recent Receipts
                </h2>
                <Link
                  to="/app/receipts"
                  className="text-xs font-medium text-[#064E3B] dark:text-[#10B981] hover:underline"
                >
                  View all
                </Link>
              </div>
              {recentReceipts.length === 0 ? (
                <div className="p-5 text-sm text-[#5C635D] dark:text-[#9BA39D]">
                  No receipts issued yet.
                </div>
              ) : (
                <div className="divide-y divide-[#ECE6D8] dark:divide-[#242D28]">
                  {recentReceipts.map((r) => (
                    <Link
                      key={r.id}
                      to={`/app/receipts/${r.id}`}
                      className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-[#FAF8F3] dark:hover:bg-[#1B231F] transition-colors min-h-[60px]"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-mono-num font-semibold text-[#121513] dark:text-[#F4F1EA]">
                            {r.receiptNumber}
                          </span>
                          <span aria-hidden="true" className="text-[#8B918B]">·</span>
                          <span className="font-medium truncate">
                            {r.customerName || 'Walk-in Customer'}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-[#5C635D] dark:text-[#9BA39D]">
                          <span>{formatLagosDateOnly(r.issuedDateLagos)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{r.paymentMethod}</span>
                          <span aria-hidden="true">·</span>
                          {statusText(r)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p
                          className={`font-mono-num text-sm font-semibold ${
                            r.status === 'VOID'
                              ? 'line-through text-[#8B918B]'
                              : 'text-[#121513] dark:text-[#F4F1EA]'
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

          {/* Customers Owing (Receipt Part-Paid + Credit Sales) */}
          <section className="lg:col-span-5 rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] overflow-hidden h-fit">
            <div className="px-5 py-4 border-b border-[#ECE6D8] dark:border-[#242D28] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#121513] dark:text-[#F4F1EA]">
                Customers Owing
              </h2>
              <Link
                to="/app/debtors"
                className="text-xs font-medium text-[#064E3B] dark:text-[#10B981] hover:underline"
              >
                Manage Debtors
              </Link>
            </div>

            {loading ? (
              <div className="p-5 space-y-3">
                {[1, 2].map((n) => (
                  <div key={n} className="h-12 rounded-xl bg-[#F3EFE6] dark:bg-[#1B231F] animate-pulse" />
                ))}
              </div>
            ) : debtorsPreview.length === 0 && outstandingReceipts.length === 0 ? (
              <div className="p-6 text-sm text-[#5C635D] dark:text-[#9BA39D]">
                No outstanding debts right now. Every sale is settled.
              </div>
            ) : (
              <div className="divide-y divide-[#ECE6D8] dark:divide-[#242D28]">
                {debtorsPreview.map((g) => {
                  const firstReceipt =
                    g.debts.find((d) => d.debtKind === 'RECEIPT') &&
                    outstandingReceipts.find((r) => r.customerName === g.customerName);
                  return (
                    <div key={g.customerKey} className="px-5 py-3.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <Link to="/app/debtors" className="text-sm font-semibold hover:underline block truncate">
                          {g.customerName}
                        </Link>
                        <p className="text-xs text-[#5C635D] dark:text-[#9BA39D] font-mono-num">
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
                            className="min-h-[36px] rounded-xl border border-[#064E3B] dark:border-[#10B981] px-2.5 text-xs font-semibold text-[#064E3B] dark:text-[#10B981]"
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
