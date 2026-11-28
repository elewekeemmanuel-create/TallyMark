import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { BarChart3, Download, FileSpreadsheet } from 'lucide-react';
import { api } from '../lib/api';
import { downloadReportSummaryPdf } from '../lib/pdf';
import { shiftLagosDate } from '../shared/cashbook';
import { formatKobo, getLagosDateString } from '../shared/money';
import type { BusinessProfile, ReportsSummary } from '../shared/types';
import { isInvoicesQuotesModuleEnabled } from '../shared/v2/entitlements';

const V2ReportsSection = lazy(() =>
  import('../v2/components/V2ReportsSection').then((m) => ({
    default: m.V2ReportsSection,
  }))
);

type PeriodPreset = 'today' | 'week' | 'month' | 'custom';

export function ReportsPage({ business }: { business: BusinessProfile }) {
  const v2Enabled = isInvoicesQuotesModuleEnabled(business);
  const today = getLagosDateString();
  const [preset, setPreset] = useState<PeriodPreset>('month');
  const [dateFrom, setDateFrom] = useState(`${today.slice(0, 7)}-01`);
  const [dateTo, setDateTo] = useState(today);

  const [report, setReport] = useState<ReportsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [csvBusy, setCsvBusy] = useState<string | null>(null);

  const applyPreset = (next: PeriodPreset) => {
    setPreset(next);
    const t = getLagosDateString();
    if (next === 'today') {
      setDateFrom(t);
      setDateTo(t);
    } else if (next === 'week') {
      setDateFrom(shiftLagosDate(t, -6));
      setDateTo(t);
    } else if (next === 'month') {
      setDateFrom(`${t.slice(0, 7)}-01`);
      setDateTo(t);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getReports(dateFrom, dateTo);
      setReport(res.report);
    } catch (err: any) {
      setError(err?.message || 'Unable to load reports');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCsv = async (type: 'receipts' | 'expenses' | 'ledger' | 'debtors') => {
    setCsvBusy(type);
    setError(null);
    try {
      await api.downloadCsv(type, dateFrom, dateTo, business.currency);
    } catch (err: any) {
      setError(err?.message || 'Unable to export CSV');
    } finally {
      setCsvBusy(null);
    }
  };

  const handlePdf = async () => {
    if (!report) return;
    setPdfBusy(true);
    setError(null);
    try {
      await downloadReportSummaryPdf(business, report);
    } catch {
      setError('Unable to generate summary PDF');
    } finally {
      setPdfBusy(false);
    }
  };

  const maxChartVal = Math.max(
    1,
    ...(report?.dailySeries.flatMap((d) => [d.moneyInKobo, d.expensesKobo]) || [1])
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">Period Analysis</p>
          <h1 className="mt-1 font-display text-2xl sm:text-3xl font-semibold tracking-tight text-[#111827] dark:text-[#F3F4F6]">
            Reports &amp; Exports
          </h1>
        </div>
        <button
          type="button"
          onClick={handlePdf}
          disabled={!report || pdfBusy}
          className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-[10px] bg-[#064E3B] px-4 py-2 text-xs font-semibold text-white hover:bg-[#04392B] disabled:opacity-60"
        >
          <Download className="w-4 h-4" />
          <span>{pdfBusy ? 'Preparing PDF…' : 'Download Summary PDF'}</span>
        </button>
      </div>

      {/* Period Selector */}
      <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {([
            ['today', 'Today'],
            ['week', 'Last 7 Days'],
            ['month', 'This Month'],
            ['custom', 'Custom'],
          ] as Array<[PeriodPreset, string]>).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => applyPreset(key)}
              className={`min-h-[40px] rounded-[10px] border px-3.5 text-xs font-semibold transition-colors ${
                preset === key
                  ? 'border-[#064E3B] bg-[#064E3B] text-white'
                  : 'border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setPreset('custom');
              setDateFrom(e.target.value);
            }}
            className="rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] px-3 py-2 font-mono-num"
          />
          <span className="text-[#6B7280]">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setPreset('custom');
              setDateTo(e.target.value);
            }}
            className="rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] px-3 py-2 font-mono-num"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-[10px] border border-[#B91C1C]/30 bg-[#FEF2F2] dark:bg-red-950/30 p-4 text-sm text-[#B91C1C] dark:text-red-300">
          {error}
        </div>
      )}

      {v2Enabled && (
        <Suspense
          fallback={
            <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              Loading invoices and quotes breakdown…
            </div>
          }
        >
          <V2ReportsSection business={business} dateFrom={dateFrom} dateTo={dateTo} />
        </Suspense>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        <div className="rounded-[24px] bg-[#064E3B] p-5 text-white shadow-sm shadow-[#064E3B]/15">
          <p className="text-xs font-medium text-white/75">
            Net (money in minus out)
          </p>
          <p
            className={`mt-2 font-mono-num text-xl font-semibold ${
              (report?.netMoneyInMinusOutKobo ?? 0) >= 0
                ? 'text-[#6EE7B7]'
                : 'text-red-300'
            }`}
          >
            {loading || !report
              ? '—'
              : formatKobo(report.netMoneyInMinusOutKobo, business.currency)}
          </p>
        </div>

        <div className="rounded-[24px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 shadow-xs">
          <p className="text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">Total Sales</p>
          <p className="mt-2 font-mono-num text-xl font-semibold text-[#111827] dark:text-[#F3F4F6]">
            {loading || !report ? '—' : formatKobo(report.salesTotalKobo, business.currency)}
          </p>
        </div>

        <div className="rounded-[24px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 shadow-xs">
          <p className="text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">Money In</p>
          <p className="mt-2 font-mono-num text-xl font-semibold text-[#064E3B] dark:text-[#6EE7B7]">
            {loading || !report ? '—' : formatKobo(report.moneyInTotalKobo, business.currency)}
          </p>
        </div>

        <div className="rounded-[24px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 shadow-xs">
          <p className="text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">Expenses (Money Out)</p>
          <p className="mt-2 font-mono-num text-xl font-semibold text-[#B91C1C] dark:text-red-400">
            {loading || !report ? '—' : formatKobo(report.expensesTotalKobo, business.currency)}
          </p>
        </div>

        <div className="rounded-[24px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 shadow-xs">
          <p className="text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">Outstanding Debts</p>
          <p className="mt-2 font-mono-num text-xl font-semibold text-[#B45309] dark:text-amber-400">
            {loading || !report ? '—' : formatKobo(report.outstandingDebtsKobo, business.currency)}
          </p>
        </div>
      </div>

      {/* Income vs Expenses Chart */}
      <section className="rounded-[24px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 sm:p-6 space-y-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#064E3B] dark:text-[#6EE7B7]" />
            <h2 className="text-sm font-semibold text-[#111827] dark:text-[#F3F4F6]">Income vs Expenses by Day</h2>
          </div>
          <div className="flex items-center gap-4 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#064E3B] dark:bg-[#6EE7B7]" /> Money In
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#DC2626] dark:bg-red-400" /> Expenses
            </span>
          </div>
        </div>

        {!report || report.dailySeries.length === 0 ? (
          <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF] py-6 text-center">
            No cash book entries in this date range yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[360px] flex items-end gap-2 h-44 pt-4 pb-2 border-b border-gray-100 dark:border-[#1F2925]">
              {report.dailySeries.map((pt) => {
                const inPct = Math.max(2, Math.round((pt.moneyInKobo / maxChartVal) * 100));
                const outPct = Math.max(2, Math.round((pt.expensesKobo / maxChartVal) * 100));
                return (
                  <div key={pt.date} className="flex-1 min-w-[38px] flex flex-col items-center gap-1.5 h-full justify-end">
                    <div className="w-full flex items-end justify-center gap-1 h-32">
                      <div
                        title={`${pt.date} Money In: ${formatKobo(pt.moneyInKobo, business.currency)}`}
                        style={{ height: `${pt.moneyInKobo > 0 ? inPct : 0}%` }}
                        className="w-3 sm:w-4 rounded-t-md bg-[#064E3B] dark:bg-[#6EE7B7] transition-all"
                      />
                      <div
                        title={`${pt.date} Expenses: ${formatKobo(pt.expensesKobo, business.currency)}`}
                        style={{ height: `${pt.expensesKobo > 0 ? outPct : 0}%` }}
                        className="w-3 sm:w-4 rounded-t-md bg-[#DC2626]/85 dark:bg-red-400/90 transition-all"
                      />
                    </div>
                    <span className="font-mono-num text-[10px] text-[#6B7280] dark:text-[#9CA3AF]">
                      {pt.date.slice(5)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Breakdown Grids */}
      {report && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <section className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 space-y-3">
            <h2 className="text-sm font-semibold">By Payment Method</h2>
            {report.byPaymentMethod.length === 0 ? (
              <p className="text-xs text-[#6B7280]">No entries in this period.</p>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-[#1F2925]">
                {report.byPaymentMethod.map((m) => (
                  <div key={m.method} className="py-2.5 flex items-center justify-between text-xs">
                    <span className="font-semibold">{m.method}</span>
                    <div className="font-mono-num text-right">
                      <span className="text-[#064E3B] dark:text-[#6EE7B7]">
                        +{formatKobo(m.inKobo, business.currency)}
                      </span>
                      {' · '}
                      <span className="text-[#B91C1C] dark:text-red-400">
                        -{formatKobo(m.outKobo, business.currency)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 space-y-3">
            <h2 className="text-sm font-semibold">By Expense Category</h2>
            {report.byExpenseCategory.length === 0 ? (
              <p className="text-xs text-[#6B7280]">No expenses recorded in this period.</p>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-[#1F2925]">
                {report.byExpenseCategory.map((c) => (
                  <div key={c.category} className="py-2.5 flex items-center justify-between text-xs">
                    <span>
                      <strong>{c.category}</strong> ({c.count})
                    </span>
                    <span className="font-mono-num font-semibold text-[#B91C1C] dark:text-red-400">
                      {formatKobo(c.totalKobo, business.currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 space-y-3">
            <h2 className="text-sm font-semibold">Sales by &ldquo;Sold by&rdquo; Name</h2>
            {report.bySoldBy.length === 0 ? (
              <p className="text-xs text-[#6B7280]">No sales in this period.</p>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-[#1F2925]">
                {report.bySoldBy.map((s) => (
                  <div key={s.soldBy} className="py-2.5 flex items-center justify-between text-xs">
                    <span>
                      <strong>{s.soldBy}</strong> ({s.count})
                    </span>
                    <span className="font-mono-num font-semibold">
                      {formatKobo(s.salesKobo, business.currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 space-y-3">
            <h2 className="text-sm font-semibold">Top Customers</h2>
            {report.topCustomers.length === 0 ? (
              <p className="text-xs text-[#6B7280]">No named customer sales in this period.</p>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-[#1F2925]">
                {report.topCustomers.map((c) => (
                  <div key={c.customerName} className="py-2.5 flex items-center justify-between text-xs">
                    <span>
                      <strong>{c.customerName}</strong> ({c.count})
                    </span>
                    <span className="font-mono-num font-semibold">
                      {formatKobo(c.totalKobo, business.currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* CSV Exports */}
      <section className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 space-y-3">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-[#064E3B] dark:text-[#6EE7B7]" />
          <h2 className="text-sm font-semibold">Export CSV Spreadsheets</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {([
            ['receipts', 'Receipts CSV'],
            ['expenses', 'Expenses CSV'],
            ['ledger', 'Cash Book Ledger CSV'],
            ['debtors', 'Debtors CSV'],
          ] as Array<['receipts' | 'expenses' | 'ledger' | 'debtors', string]>).map(([type, label]) => (
            <button
              key={type}
              type="button"
              onClick={() => handleCsv(type)}
              disabled={csvBusy === type}
              className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 text-xs font-semibold hover:bg-gray-200/70 dark:hover:bg-[#1A221F]"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{csvBusy === type ? 'Exporting…' : label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
