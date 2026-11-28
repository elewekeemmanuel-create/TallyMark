import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Download,
  FilePlus2,
  Lock,
  MessageCircle,
  Mic,
  PlusCircle,
  Search,
} from 'lucide-react';
import {
  CloseDayModal,
  CorrectionEntryModal,
  buildDailySummaryWhatsAppUrl,
} from '../components/CloseDayModal';
import { api } from '../lib/api';
import { downloadDailySummaryPdf } from '../lib/pdf';
import { Link } from '../lib/router';
import { shiftLagosDate } from '../shared/cashbook';
import { formatKobo, formatLagosDateOnly, getLagosDateString } from '../shared/money';
import type { BusinessProfile, CashBookDayView, CashBookRow } from '../shared/types';

export function CashBookPage({ business }: { business: BusinessProfile }) {
  const [date, setDate] = useState(() => getLagosDateString());
  const [dayView, setDayView] = useState<CashBookDayView | null>(null);
  const [todayDateLagos, setTodayDateLagos] = useState(() => getLagosDateString());
  const [yesterdayDateLagos, setYesterdayDateLagos] = useState(() =>
    shiftLagosDate(getLagosDateString(), -1)
  );
  const [yesterdayClosed, setYesterdayClosed] = useState(true);
  const [yesterdayHasActivity, setYesterdayHasActivity] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filterType, setFilterType] = useState('ALL');
  const [filterMethod, setFilterMethod] = useState('ALL');
  const [issuingEntryId, setIssuingEntryId] = useState<string | null>(null);
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getCashBook(date);
      setDayView(res.dayView);
      setTodayDateLagos(res.todayDateLagos);
      setYesterdayDateLagos(res.yesterdayDateLagos);
      setYesterdayClosed(res.yesterdayClosed);
      setYesterdayHasActivity(res.yesterdayHasActivity);
    } catch (err: any) {
      setError(err?.message || 'Unable to load cash book');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  const handleIssueReceipt = async (row: CashBookRow) => {
    setIssuingEntryId(row.entry.id);
    setError(null);
    try {
      await api.issueReceiptFromQuickSale(row.entry.id);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Unable to issue receipt for entry');
    } finally {
      setIssuingEntryId(null);
    }
  };

  const handleDownloadDailyPdf = async () => {
    if (!dayView) return;
    setPdfBusy(true);
    try {
      await downloadDailySummaryPdf(business, dayView);
    } catch {
      setError('Unable to generate Daily Summary PDF');
    } finally {
      setPdfBusy(false);
    }
  };

  const filteredRows = (dayView?.rows || []).filter((row) => {
    const e = row.entry;
    if (filterType !== 'ALL' && e.entryType !== filterType) return false;
    if (filterMethod !== 'ALL' && (e.paymentMethod || 'Cash') !== filterMethod) return false;
    if (q.trim()) {
      const term = q.toLowerCase();
      const hay = `${e.note} ${e.customerName} ${e.soldBy} ${e.receiptNumber || ''} ${e.entryKind}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-5">
      {/* Unclosed Previous-Day Alert Banner */}
      {!yesterdayClosed && yesterdayHasActivity && date !== yesterdayDateLagos && (
        <div className="rounded-[20px] border border-[#B45309]/40 bg-[#FEF3C7]/70 dark:bg-amber-950/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-sm text-[#92400E] dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Yesterday (<strong>{formatLagosDateOnly(yesterdayDateLagos)}</strong>) isn’t closed yet
              (daily close reminder: {business.closeDayReminderTime || '19:00'}).
            </span>
          </div>
          <button
            type="button"
            onClick={() => setDate(yesterdayDateLagos)}
            className="shrink-0 min-h-[38px] rounded-[10px] bg-[#B45309] px-3.5 text-xs font-semibold text-white hover:bg-[#92400E]"
          >
            Review &amp; Close Yesterday
          </button>
        </div>
      )}

      {/* Header & Date Stepper */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <p className="text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">Daily Cash Book</p>
            {dayView?.isClosed && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#ECFDF5] dark:bg-[#064E3B]/40 px-2.5 py-0.5 text-[11px] font-semibold text-[#064E3B] dark:text-[#6EE7B7]">
                <Lock className="w-3 h-3" />
                <span>Closed</span>
              </span>
            )}
          </div>
          <h1 className="mt-1 font-display text-2xl sm:text-3xl font-semibold tracking-tight text-[#111827] dark:text-[#F3F4F6]">
            {formatLagosDateOnly(date)}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] p-1">
            <button
              type="button"
              onClick={() => setDate((d) => shiftLagosDate(d, -1))}
              aria-label="Previous day"
              className="min-w-[38px] min-h-[38px] inline-flex items-center justify-center rounded-lg hover:bg-[#F4F6F8] dark:hover:bg-[#1F2925]"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="bg-transparent px-2 text-xs font-mono-num font-semibold focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setDate((d) => shiftLagosDate(d, 1))}
              aria-label="Next day"
              className="min-w-[38px] min-h-[38px] inline-flex items-center justify-center rounded-lg hover:bg-[#F4F6F8] dark:hover:bg-[#1F2925]"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          {date !== todayDateLagos && (
            <button
              type="button"
              onClick={() => setDate(todayDateLagos)}
              className="min-h-[42px] rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3 text-xs font-semibold"
            >
              Today
            </button>
          )}
          <button
            type="button"
            onClick={() => setCorrectionOpen(true)}
            className="min-h-[42px] inline-flex items-center gap-1.5 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3.5 text-xs font-semibold"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Correction</span>
          </button>
          {dayView && (
            <button
              type="button"
              onClick={() => setCloseModalOpen(true)}
              className="min-h-[42px] inline-flex items-center gap-1.5 rounded-[10px] bg-[#064E3B] px-4 text-xs font-semibold text-white hover:bg-[#04392B]"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{dayView.isClosed ? 'Daily Summary' : 'Close Day'}</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-[10px] border border-[#B91C1C]/30 bg-[#FEF2F2] dark:bg-red-950/30 p-4 text-sm text-[#B91C1C] dark:text-red-300">
          {error}
        </div>
      )}

      {/* Balances Strip — Cash in Hand separated from Transfer & POS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-[24px] bg-[#064E3B] p-5 text-white shadow-sm shadow-[#064E3B]/15">
          <p className="text-xs font-medium text-white/75">Cash in Hand</p>
          <p className="mt-2 font-mono-num text-xl sm:text-2xl font-semibold text-[#6EE7B7]">
            {loading || !dayView ? '—' : formatKobo(dayView.closingCashInHandKobo, business.currency)}
          </p>
          <p className="mt-1.5 text-[11px] text-white/70 font-mono-num">
            {dayView
              ? `+${formatKobo(dayView.cashInKobo, business.currency)} / -${formatKobo(dayView.cashOutKobo, business.currency)}`
              : 'Drawer balance'}
          </p>
        </div>

        <div className="rounded-[24px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 shadow-xs">
          <p className="text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">Opening Cash</p>
          <p className="mt-2 font-mono-num text-xl sm:text-2xl font-semibold text-[#111827] dark:text-[#F3F4F6]">
            {loading || !dayView ? '—' : formatKobo(dayView.openingCashKobo, business.currency)}
          </p>
          <p className="mt-1.5 text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
            Carried forward
          </p>
        </div>

        <div className="rounded-[24px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 shadow-xs">
          <p className="text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">Transfer &amp; POS</p>
          <p className="mt-2 font-mono-num text-xl sm:text-2xl font-semibold text-[#111827] dark:text-[#F3F4F6]">
            {loading || !dayView
              ? '—'
              : formatKobo(
                  dayView.transferInKobo - dayView.transferOutKobo + (dayView.posInKobo - dayView.posOutKobo),
                  business.currency
                )}
          </p>
          <p className="mt-1.5 text-[11px] text-[#6B7280] dark:text-[#9CA3AF] font-mono-num">
            {dayView
              ? `Trf ${formatKobo(dayView.transferInKobo - dayView.transferOutKobo, business.currency)} · POS ${formatKobo(dayView.posInKobo - dayView.posOutKobo, business.currency)}`
              : ''}
          </p>
        </div>

        <div className="rounded-[24px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 shadow-xs">
          <p className="text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">
            Net (money in minus out)
          </p>
          <p
            className={`mt-2 font-mono-num text-xl sm:text-2xl font-semibold ${
              (dayView?.netKobo ?? 0) >= 0
                ? 'text-[#064E3B] dark:text-[#6EE7B7]'
                : 'text-[#B91C1C] dark:text-red-400'
            }`}
          >
            {loading || !dayView ? '—' : formatKobo(dayView.netKobo, business.currency)}
          </p>
          <p className="mt-1.5 text-[11px] text-[#6B7280] dark:text-[#9CA3AF] font-mono-num">
            {dayView
              ? `In ${formatKobo(dayView.moneyInTotalKobo, business.currency)} · Out ${formatKobo(dayView.moneyOutTotalKobo, business.currency)}`
              : ''}
          </p>
        </div>
      </div>

      {/* Quick Share & Filter Bar */}
      <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search entries on this day…"
              className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] pl-9 pr-3 py-2 text-xs min-h-[40px]"
            />
          </div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] px-3 py-2 text-xs min-h-[40px]"
          >
            <option value="ALL">All Types</option>
            <option value="SALE">Sales</option>
            <option value="PAYMENT_RECEIVED">Debt Payments</option>
            <option value="EXPENSE">Expenses</option>
            <option value="ADJUSTMENT">Corrections / Voids</option>
          </select>
          <select
            value={filterMethod}
            onChange={(e) => setFilterMethod(e.target.value)}
            className="rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#111715] px-3 py-2 text-xs min-h-[40px]"
          >
            <option value="ALL">All Methods</option>
            <option value="Cash">Cash</option>
            <option value="Transfer">Transfer</option>
            <option value="POS">POS</option>
            <option value="Card">Card</option>
            <option value="Other">Other</option>
          </select>
        </div>

        {dayView && (
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={buildDailySummaryWhatsAppUrl(business, dayView)}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-[10px] border border-gray-200 dark:border-[#232D29] px-3 text-xs font-medium"
            >
              <MessageCircle className="w-3.5 h-3.5 text-[#064E3B] dark:text-[#6EE7B7]" />
              <span>WhatsApp</span>
            </a>
            <button
              type="button"
              onClick={handleDownloadDailyPdf}
              disabled={pdfBusy}
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-[10px] border border-gray-200 dark:border-[#232D29] px-3 text-xs font-medium"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{pdfBusy ? 'PDF…' : 'Daily PDF'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Chronological Ledger */}
      <section className="rounded-[24px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-gray-100 dark:border-[#1F2925] flex items-center justify-between text-xs text-[#6B7280] dark:text-[#9CA3AF]">
          <span className="font-medium">Chronological Ledger ({filteredRows.length} entries)</span>
          <span className="font-mono-num font-semibold text-[#111827] dark:text-[#F3F4F6]">
            Closing Balance: {dayView ? formatKobo(dayView.closingTotalBalanceKobo, business.currency) : '—'}
          </span>
        </div>

        {loading ? (
          <div className="p-5 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 rounded-[10px] bg-[#F4F6F8] dark:bg-[#1A221F] animate-pulse" />
            ))}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-8 text-center space-y-3">
            <p className="font-display text-2xl">No entries on {formatLagosDateOnly(date)}</p>
            <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF]">
              Receipts, quick sales, credit sales, debt payments, and expenses for this day appear here in time order.
            </p>
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <Link
                to="/app/quick-sale"
                className="min-h-[40px] inline-flex items-center rounded-[10px] bg-[#064E3B] px-4 text-xs font-semibold text-white"
              >
                Quick Sale
              </Link>
              <Link
                to="/app/expenses?new=1"
                className="min-h-[40px] inline-flex items-center rounded-[10px] border border-gray-200 dark:border-[#232D29] px-4 text-xs font-semibold"
              >
                Add Expense
              </Link>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-[#1F2925]">
            {filteredRows.map((row) => {
              const e = row.entry;
              const isCreditPending = e.entryKind === 'CREDIT_SALE' && e.cashReceivedKobo === 0;
              return (
                <div
                  key={e.id}
                  className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#F6F7F8] dark:hover:bg-[#1A221F]"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`mt-0.5 w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 ${
                        row.moneyInKobo > 0
                          ? 'bg-[#064E3B]/10 text-[#064E3B] dark:text-[#6EE7B7]'
                          : row.moneyOutKobo > 0
                          ? 'bg-[#B91C1C]/10 text-[#B91C1C] dark:text-red-400'
                          : 'bg-[#B45309]/10 text-[#B45309] dark:text-amber-400'
                      }`}
                    >
                      {row.moneyOutKobo > 0 ? (
                        <ArrowUpRight className="w-4 h-4" />
                      ) : (
                        <ArrowDownLeft className="w-4 h-4" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-semibold truncate">
                          {e.note || e.entryKind.replace('_', ' ')}
                        </span>
                        {e.receiptNumber && e.receiptId && (
                          <Link
                            to={`/app/receipts/${e.receiptId}`}
                            className="font-mono-num text-xs text-[#064E3B] dark:text-[#6EE7B7] hover:underline"
                          >
                            {e.receiptNumber}
                          </Link>
                        )}
                        {e.isCorrection && (
                          <span className="text-[11px] font-semibold uppercase text-[#B45309] dark:text-amber-400">
                            Correction
                          </span>
                        )}
                        {e.source === 'voice' && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#064E3B] dark:text-[#6EE7B7]">
                            <Mic className="w-3 h-3" />
                            <span>Voice</span>
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mt-0.5">
                        {e.paymentMethod || 'Cash'}
                        {e.customerName ? ` · ${e.customerName}` : ''}
                        {e.soldBy ? ` · Sold by ${e.soldBy}` : ''}
                        {isCreditPending
                          ? ` · Borrowed ${formatKobo(e.amountKobo, business.currency)} (₦0 received yet)`
                          : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                    {e.entryKind === 'QUICK_SALE' && !e.receiptId && (
                      <button
                        type="button"
                        onClick={() => handleIssueReceipt(row)}
                        disabled={issuingEntryId === e.id}
                        className="min-h-[34px] inline-flex items-center gap-1 rounded-lg border border-[#064E3B] dark:border-[#10B981] px-2.5 text-[11px] font-semibold text-[#064E3B] dark:text-[#6EE7B7] hover:bg-[#064E3B] hover:text-white"
                      >
                        <FilePlus2 className="w-3.5 h-3.5" />
                        <span>{issuingEntryId === e.id ? 'Issuing…' : 'Issue Receipt'}</span>
                      </button>
                    )}

                    <div className="text-right">
                      <p
                        className={`font-mono-num text-sm font-semibold ${
                          row.moneyInKobo > 0
                            ? 'text-[#064E3B] dark:text-[#6EE7B7]'
                            : row.moneyOutKobo > 0
                            ? 'text-[#B91C1C] dark:text-red-400'
                            : 'text-[#B45309] dark:text-amber-400'
                        }`}
                      >
                        {row.moneyInKobo > 0
                          ? `+${formatKobo(row.moneyInKobo, business.currency)}`
                          : row.moneyOutKobo > 0
                          ? `-${formatKobo(row.moneyOutKobo, business.currency)}`
                          : formatKobo(e.amountKobo, business.currency)}
                      </p>
                      <p className="font-mono-num text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
                        Bal {formatKobo(row.runningBalanceKobo, business.currency)} · Cash{' '}
                        {formatKobo(row.runningCashInHandKobo, business.currency)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {closeModalOpen && dayView && (
        <CloseDayModal
          business={business}
          dayView={dayView}
          onClose={() => setCloseModalOpen(false)}
          onClosed={(updated) => {
            setDayView(updated);
            load();
          }}
        />
      )}

      {correctionOpen && (
        <CorrectionEntryModal
          business={business}
          defaultDate={date}
          onClose={() => setCorrectionOpen(false)}
          onCreated={load}
        />
      )}
    </div>
  );
}
