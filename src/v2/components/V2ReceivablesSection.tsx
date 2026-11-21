import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  MessageSquare,
  Search,
  User,
  Users,
  X,
} from 'lucide-react';
import { Link } from '../../lib/router';
import { formatKobo, formatLagosDateOnly } from '../../shared/money';
import type { BusinessProfile } from '../../shared/types';
import {
  buildReminderMessage,
  buildWhatsAppUrl,
} from '../../shared/v2/money';
import type {
  AgeingBucketFilter,
  AgeingBucketTotals,
  ReceivableItem,
  ReceivableSourceFilter,
} from '../../shared/v2/types';
import { v2Api } from '../api';

interface V2ReceivablesSectionProps {
  business: BusinessProfile;
  onRecordPayment?: (item: ReceivableItem) => void;
}

const SOURCE_TABS: Array<{ value: ReceivableSourceFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'INVOICE', label: 'Invoices' },
  { value: 'CREDIT_SALE', label: 'Quick credit' },
  { value: 'RECEIPT', label: 'Part-paid receipts' },
];

const BUCKET_CARDS: Array<{
  key: AgeingBucketFilter;
  label: string;
  sublabel: string;
}> = [
  { key: 'not_yet_due', label: 'Not yet due', sublabel: 'Current' },
  { key: '1_7', label: '1–7 days', sublabel: 'Overdue' },
  { key: '8_30', label: '8–30 days', sublabel: 'Overdue' },
  { key: '30_plus', label: '30+ days', sublabel: 'Overdue' },
];

function sourceLabel(src: ReceivableItem['sourceType']): string {
  if (src === 'INVOICE') return 'Invoice';
  if (src === 'CREDIT_SALE') return 'Quick credit';
  return 'Part-paid receipt';
}

function bucketBadge(item: ReceivableItem): { label: string; className: string } {
  if (item.ageingBucket === 'not_yet_due') {
    return {
      label: item.dueDate ? `Due ${formatLagosDateOnly(item.dueDate)}` : 'Current',
      className: 'bg-[#F3EFE6] dark:bg-[#1B231F] text-[#444A45] dark:text-[#C5CCC7]',
    };
  }
  if (item.ageingBucket === '1_7') {
    return {
      label: `${item.daysOverdue}d overdue`,
      className: 'bg-[#FEF3C7] dark:bg-[#3A2807] text-[#92400E] dark:text-[#FCD34D]',
    };
  }
  return {
    label: `${item.daysOverdue}d overdue`,
    className: 'bg-[#FEE2E2] dark:bg-[#3B1515] text-[#991B1B] dark:text-[#FCA5A5]',
  };
}

export function V2ReceivablesSection({ business, onRecordPayment }: V2ReceivablesSectionProps) {
  const [source, setSource] = useState<ReceivableSourceFilter>('ALL');
  const [bucket, setBucket] = useState<AgeingBucketFilter>('ALL');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<ReceivableItem[]>([]);
  const [summary, setSummary] = useState<AgeingBucketTotals>({
    notYetDueKobo: 0,
    notYetDueCount: 0,
    days1To7Kobo: 0,
    days1To7Count: 0,
    days8To30Kobo: 0,
    days8To30Count: 0,
    days30PlusKobo: 0,
    days30PlusCount: 0,
    totalOutstandingKobo: 0,
    totalOpenCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reminder modal state
  const [remindTarget, setRemindTarget] = useState<ReceivableItem | null>(null);
  const [remindTone, setRemindTone] = useState<'gentle' | 'firm'>('gentle');
  const [remindText, setRemindText] = useState('');
  const [loggingReminder, setLoggingReminder] = useState(false);
  const [remindNotice, setRemindNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await v2Api.getReceivables({
        source,
        bucket,
        q: search.trim() || undefined,
      });
      setItems(res.items);
      setSummary(res.summary);
    } catch (err: any) {
      setError(err?.message || 'Unable to load unpaid balances');
    } finally {
      setLoading(false);
    }
  }, [source, bucket, search]);

  useEffect(() => {
    load();
  }, [load]);

  const openReminderModal = (item: ReceivableItem) => {
    const initialTone: 'gentle' | 'firm' = item.daysOverdue > 7 ? 'firm' : 'gentle';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const publicUrl = item.publicPath && origin ? `${origin}${item.publicPath}` : null;
    setRemindTarget(item);
    setRemindTone(initialTone);
    setRemindNotice(null);
    setRemindText(
      buildReminderMessage({
        tone: initialTone,
        businessName: business.name,
        customerName: item.customerName,
        amountFormatted: formatKobo(item.balanceDueKobo, business.currency),
        referenceNumber: item.referenceNumber,
        dueDate: item.dueDate ? formatLagosDateOnly(item.dueDate) : null,
        publicUrl,
      })
    );
  };

  const switchTone = (nextTone: 'gentle' | 'firm') => {
    setRemindTone(nextTone);
    if (!remindTarget) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const publicUrl = remindTarget.publicPath && origin ? `${origin}${remindTarget.publicPath}` : null;
    setRemindText(
      buildReminderMessage({
        tone: nextTone,
        businessName: business.name,
        customerName: remindTarget.customerName,
        amountFormatted: formatKobo(remindTarget.balanceDueKobo, business.currency),
        referenceNumber: remindTarget.referenceNumber,
        dueDate: remindTarget.dueDate ? formatLagosDateOnly(remindTarget.dueDate) : null,
        publicUrl,
      })
    );
  };

  const handleLogReminder = async () => {
    if (!remindTarget) return;
    setLoggingReminder(true);
    setRemindNotice(null);
    try {
      await v2Api.logReminder({
        debtId: remindTarget.debtId,
        tone: remindTone,
        channel: 'whatsapp',
      });
      setRemindNotice('Reminder logged.');
      await load();
    } catch (err: any) {
      setRemindNotice(err?.message || 'Could not log reminder');
    } finally {
      setLoggingReminder(false);
    }
  };

  const getBucketAmount = (key: AgeingBucketFilter): { kobo: number; count: number } => {
    if (key === 'not_yet_due') return { kobo: summary.notYetDueKobo, count: summary.notYetDueCount };
    if (key === '1_7') return { kobo: summary.days1To7Kobo, count: summary.days1To7Count };
    if (key === '8_30') return { kobo: summary.days8To30Kobo, count: summary.days8To30Count };
    return { kobo: summary.days30PlusKobo, count: summary.days30PlusCount };
  };

  const waHref = remindTarget ? buildWhatsAppUrl(remindTarget.customerPhone, remindText) : '#';

  return (
    <div className="space-y-4">
      {/* Header summary & Customers Directory shortcut */}
      <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Total owed to you</p>
          <p className="mt-1 font-mono-num text-2xl sm:text-3xl font-bold text-[#121513] dark:text-[#F4F1EA]">
            {formatKobo(summary.totalOutstandingKobo, business.currency)}
          </p>
          <p className="text-xs text-[#5C635D] dark:text-[#9BA39D] mt-0.5">
            {summary.totalOpenCount} unpaid {summary.totalOpenCount === 1 ? 'item' : 'items'} across invoices, quick credit, and part-paid receipts
          </p>
        </div>
        <Link
          to="/app/customers"
          className="inline-flex items-center gap-2 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#111714] px-3.5 py-2.5 text-xs font-semibold text-[#121513] dark:text-[#F4F1EA] hover:bg-[#F3EFE6] dark:hover:bg-[#1B231F] min-h-[42px]"
        >
          <Users className="w-4 h-4 text-[#064E3B] dark:text-[#10B981]" />
          <span>Customers &amp; Statements</span>
        </Link>
      </div>

      {/* Ageing bucket selector cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {BUCKET_CARDS.map((card) => {
          const stats = getBucketAmount(card.key);
          const active = bucket === card.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => setBucket(active ? 'ALL' : card.key)}
              className={`text-left rounded-2xl border p-3.5 transition-colors ${
                active
                  ? 'border-[#064E3B] bg-[#064E3B] text-white'
                  : 'border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] hover:bg-[#FAF8F3] dark:hover:bg-[#1B231F]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p
                  className={`text-[11px] font-semibold uppercase tracking-wide ${
                    active ? 'text-white/80' : 'text-[#5C635D] dark:text-[#9BA39D]'
                  }`}
                >
                  {card.label}
                </p>
                <span
                  className={`font-mono-num text-[11px] font-semibold ${
                    active ? 'text-white/85' : 'text-[#5C635D] dark:text-[#9BA39D]'
                  }`}
                >
                  {stats.count}
                </span>
              </div>
              <p className="mt-1.5 font-mono-num text-base sm:text-lg font-bold">
                {formatKobo(stats.kobo, business.currency)}
              </p>
              <p
                className={`text-[11px] mt-0.5 ${
                  active ? 'text-white/75' : 'text-[#5C635D] dark:text-[#9BA39D]'
                }`}
              >
                {card.sublabel}
              </p>
            </button>
          );
        })}
      </div>

      {/* Source filter bar & search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex flex-wrap gap-1.5">
          {SOURCE_TABS.map((tab) => {
            const active = source === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setSource(tab.value)}
                className={`rounded-xl px-3 py-2 text-xs font-semibold min-h-[38px] transition-colors ${
                  active
                    ? 'bg-[#064E3B] text-white'
                    : 'border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] text-[#444A45] dark:text-[#C5CCC7]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
          {bucket !== 'ALL' && (
            <button
              type="button"
              onClick={() => setBucket('ALL')}
              className="rounded-xl border border-[#DED6C2] dark:border-[#2B352F] px-3 py-2 text-xs font-medium text-[#5C635D] dark:text-[#9BA39D] min-h-[38px]"
            >
              Clear ageing filter
            </button>
          )}
        </div>

        <div className="relative sm:w-64">
          <Search className="w-4 h-4 text-[#5C635D] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer or ref..."
            className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] pl-9 pr-3 py-2 text-xs min-h-[38px]"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] dark:bg-[#2B1414] px-4 py-3 text-xs text-[#991B1B] dark:text-[#FCA5A5]">
          {error}
        </div>
      )}

      {/* Receivables list */}
      {loading ? (
        <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-8 text-center text-xs text-[#5C635D] dark:text-[#9BA39D]">
          Loading unpaid balances…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-8 text-center space-y-3">
          <p className="text-sm font-semibold">No unpaid balances match this filter</p>
          <p className="text-xs text-[#5C635D] dark:text-[#9BA39D]">
            {source !== 'ALL' || bucket !== 'ALL' || search
              ? 'Try clearing your filters to view all customers who owe you.'
              : 'All customer balances are settled. Issue a new invoice or record a credit sale when needed.'}
          </p>
          {source !== 'ALL' || bucket !== 'ALL' || search ? (
            <button
              type="button"
              onClick={() => {
                setSource('ALL');
                setBucket('ALL');
                setSearch('');
              }}
              className="inline-flex items-center rounded-xl bg-[#064E3B] px-4 py-2 text-xs font-semibold text-white min-h-[40px]"
            >
              Show all balances
            </button>
          ) : (
            <Link
              to="/app/invoices/new"
              className="inline-flex items-center rounded-xl bg-[#064E3B] px-4 py-2 text-xs font-semibold text-white min-h-[40px]"
            >
              New Invoice
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((item) => {
            const badge = bucketBadge(item);
            const detailLink =
              item.sourceType === 'INVOICE'
                ? `/app/invoices/${item.sourceId}`
                : item.sourceType === 'RECEIPT'
                ? `/app/receipts/${item.sourceId}`
                : null;

            return (
              <div
                key={item.debtId}
                className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-4 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {item.customerId ? (
                        <Link
                          to={`/app/customers/${item.customerId}`}
                          className="text-sm font-semibold text-[#121513] dark:text-[#F4F1EA] hover:underline inline-flex items-center gap-1"
                        >
                          <User className="w-3.5 h-3.5 text-[#5C635D]" />
                          <span>{item.customerName}</span>
                        </Link>
                      ) : (
                        <p className="text-sm font-semibold text-[#121513] dark:text-[#F4F1EA]">
                          {item.customerName}
                        </p>
                      )}
                      <span className="rounded-md border border-[#E5DEC9] dark:border-[#2B352F] px-2 py-0.5 text-[11px] font-medium text-[#5C635D] dark:text-[#9BA39D]">
                        {sourceLabel(item.sourceType)}
                      </span>
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>
                    <p className="text-xs text-[#5C635D] dark:text-[#9BA39D]">
                      {item.referenceNumber}
                      {item.customerPhone ? ` · ${item.customerPhone}` : ''}
                      {' · Issued '}
                      {formatLagosDateOnly(item.issueDate)}
                    </p>
                    {item.lastReminderAt && (
                      <p className="text-[11px] text-[#5C635D] dark:text-[#9BA39D]">
                        Last reminded {formatLagosDateOnly(item.lastReminderAt.slice(0, 10))} ({item.lastReminderTone || 'gentle'})
                        {item.remindedWithin3Days ? ' · sent within last 3 days' : ''}
                      </p>
                    )}
                  </div>

                  <div className="text-right">
                    <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">What&apos;s left</p>
                    <p className="font-mono-num text-lg font-bold text-[#121513] dark:text-[#F4F1EA]">
                      {formatKobo(item.balanceDueKobo, business.currency)}
                    </p>
                    {item.amountPaidKobo > 0 && (
                      <p className="text-[11px] text-[#5C635D] dark:text-[#9BA39D]">
                        Paid {formatKobo(item.amountPaidKobo, business.currency)} of{' '}
                        {formatKobo(item.totalKobo, business.currency)}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#EFE9DA] dark:border-[#202924]">
                  <button
                    type="button"
                    onClick={() => openReminderModal(item)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#064E3B] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#04392B] min-h-[38px]"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Remind on WhatsApp</span>
                  </button>

                  {detailLink ? (
                    <Link
                      to={detailLink}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] px-3.5 py-2 text-xs font-semibold text-[#121513] dark:text-[#F4F1EA] min-h-[38px]"
                    >
                      <span>Open {item.sourceType === 'INVOICE' ? 'Invoice' : 'Receipt'}</span>
                    </Link>
                  ) : (
                    onRecordPayment && (
                      <button
                        type="button"
                        onClick={() => onRecordPayment(item)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] px-3.5 py-2 text-xs font-semibold text-[#121513] dark:text-[#F4F1EA] min-h-[38px]"
                      >
                        <span>Record payment</span>
                      </button>
                    )
                  )}

                  {item.customerId && (
                    <Link
                      to={`/app/customers/${item.customerId}`}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] px-3 py-2 text-xs font-medium text-[#5C635D] dark:text-[#9BA39D] min-h-[38px]"
                    >
                      <span>Statement</span>
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* WhatsApp Reminder Modal */}
      {remindTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
          onClick={() => setRemindTarget(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Send WhatsApp payment reminder"
        >
          <div
            className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl border border-[#E5DEC9] dark:border-[#26302B] bg-[#FAF8F3] dark:bg-[#151B18] p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">WhatsApp Reminder</p>
                <h2 className="font-display text-2xl mt-0.5">{remindTarget.customerName}</h2>
                <p className="text-xs text-[#5C635D] dark:text-[#9BA39D]">
                  Balance: {formatKobo(remindTarget.balanceDueKobo, business.currency)} · {remindTarget.referenceNumber}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRemindTarget(null)}
                aria-label="Close"
                className="min-w-[38px] min-h-[38px] inline-flex items-center justify-center rounded-xl border border-[#DED6C2] dark:border-[#2B352F]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {remindTarget.remindedWithin3Days && (
              <div className="rounded-xl border border-[#F59E0B] bg-[#FFFBEB] dark:bg-[#332409] px-3.5 py-2.5 flex items-start gap-2.5 text-xs text-[#92400E] dark:text-[#FCD34D]">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Already reminded within the last 3 days</p>
                  <p className="mt-0.5">
                    A {remindTarget.lastReminderTone || 'gentle'} reminder was logged on{' '}
                    {remindTarget.lastReminderAt
                      ? formatLagosDateOnly(remindTarget.lastReminderAt.slice(0, 10))
                      : 'recently'}
                    . You can still send another if needed.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-xs font-semibold">Wording tone</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => switchTone('gentle')}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold min-h-[40px] ${
                    remindTone === 'gentle'
                      ? 'bg-[#064E3B] text-white'
                      : 'border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714]'
                  }`}
                >
                  Gentle reminder
                </button>
                <button
                  type="button"
                  onClick={() => switchTone('firm')}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold min-h-[40px] ${
                    remindTone === 'firm'
                      ? 'bg-[#064E3B] text-white'
                      : 'border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714]'
                  }`}
                >
                  Firm follow-up
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="reminder-message" className="text-xs font-semibold block">
                Message (editable)
              </label>
              <textarea
                id="reminder-message"
                rows={4}
                value={remindText}
                onChange={(e) => setRemindText(e.target.value)}
                className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] p-3 text-xs leading-relaxed"
              />
            </div>

            {remindNotice && (
              <p className="text-xs font-medium text-[#064E3B] dark:text-[#10B981]">{remindNotice}</p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setRemindTarget(null)}
                className="rounded-xl border border-[#DED6C2] dark:border-[#2B352F] px-4 py-2.5 text-xs font-semibold min-h-[42px]"
              >
                Close
              </button>
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  if (!loggingReminder) {
                    void handleLogReminder();
                  }
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-[#064E3B] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#04392B] min-h-[42px]"
              >
                <span>Open WhatsApp &amp; Log</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
