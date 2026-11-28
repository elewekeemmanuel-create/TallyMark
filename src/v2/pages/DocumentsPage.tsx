import React, { useCallback, useEffect, useState } from 'react';
import { Download, FileText, PlusCircle, ReceiptText, Search } from 'lucide-react';
import { Link } from '../../lib/router';
import { ReceiptsListPage } from '../../pages/ReceiptsPage';
import { formatKobo, formatLagosDateOnly } from '../../shared/money';
import type { BusinessProfile } from '../../shared/types';
import type { InvoiceRecord, QuoteRecord } from '../../shared/v2/types';
import { v2Api } from '../api';
import { buildPublicInvoicePreview, downloadInvoicePdf } from '../pdf';

type DocTab = 'invoices' | 'receipts' | 'quotes';
type InvoiceFilter = 'ALL' | 'SENT' | 'OVERDUE' | 'PART_PAID' | 'PAID' | 'DRAFT';
type QuoteFilter = 'ALL' | 'SENT' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CONVERTED' | 'DRAFT';

function invoiceStatusBadge(inv: InvoiceRecord) {
  if (inv.status === 'VOID') {
    return <span className="text-xs font-medium text-[#B91C1C]">Void</span>;
  }
  if (inv.status === 'DRAFT') {
    return <span className="text-xs font-medium text-[#6B7280]">Draft</span>;
  }
  if (inv.status === 'PAID') {
    return <span className="text-xs font-medium text-[#064E3B] dark:text-[#6EE7B7]">Paid</span>;
  }
  if (inv.status === 'SETTLED') {
    return <span className="text-xs font-medium text-[#064E3B] dark:text-[#6EE7B7]">Settled</span>;
  }
  if (inv.isOverdue) {
    return <span className="text-xs font-medium text-[#B91C1C]">Overdue</span>;
  }
  if (inv.status === 'PART_PAID') {
    return <span className="text-xs font-medium text-[#B45309] dark:text-amber-400">Part paid</span>;
  }
  return <span className="text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">Sent</span>;
}

function quoteStatusBadge(q: QuoteRecord) {
  if (q.status === 'VOID') {
    return <span className="text-xs font-medium text-[#B91C1C]">Void</span>;
  }
  if (q.status === 'DRAFT') {
    return <span className="text-xs font-medium text-[#6B7280]">Draft</span>;
  }
  if (q.status === 'CONVERTED') {
    return <span className="text-xs font-medium text-[#064E3B] dark:text-[#6EE7B7]">Converted</span>;
  }
  if (q.status === 'ACCEPTED') {
    return <span className="text-xs font-medium text-[#064E3B] dark:text-[#6EE7B7]">Accepted</span>;
  }
  if (q.status === 'DECLINED') {
    return <span className="text-xs font-medium text-[#B91C1C]">Declined</span>;
  }
  if (q.isExpired) {
    return <span className="text-xs font-medium text-[#B45309] dark:text-amber-400">Expired</span>;
  }
  return <span className="text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">Sent</span>;
}

export function DocumentsPage({ business }: { business: BusinessProfile }) {
  const [tab, setTab] = useState<DocTab>(() => {
    if (typeof window !== 'undefined') {
      const t = new URLSearchParams(window.location.search).get('tab');
      if (t === 'quotes' || t === 'receipts' || t === 'invoices') return t;
    }
    return 'invoices';
  });
  const [filter, setFilter] = useState<InvoiceFilter>('ALL');
  const [search, setSearch] = useState('');
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<string | null>(null);

  const [quoteFilter, setQuoteFilter] = useState<QuoteFilter>('ALL');
  const [quoteSearch, setQuoteSearch] = useState('');
  const [quotes, setQuotes] = useState<QuoteRecord[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quotesError, setQuotesError] = useState<string | null>(null);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await v2Api.listInvoices({ status: filter, q: search });
      setInvoices(res.invoices);
    } catch (err: any) {
      setError(err?.message || 'Unable to load invoices');
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  const loadQuotes = useCallback(async () => {
    setQuotesLoading(true);
    setQuotesError(null);
    try {
      const res = await v2Api.listQuotes({ status: quoteFilter, q: quoteSearch });
      setQuotes(res.quotes);
    } catch (err: any) {
      setQuotesError(err?.message || 'Unable to load quotes');
    } finally {
      setQuotesLoading(false);
    }
  }, [quoteFilter, quoteSearch]);

  const handleQuickDownloadInvoicePdf = async (
    e: React.MouseEvent,
    invoiceId: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setDownloadingInvoiceId(invoiceId);
    setError(null);
    try {
      const res = await v2Api.getInvoice(invoiceId);
      const doc = buildPublicInvoicePreview(res.invoice, business, res.payments || []);
      await downloadInvoicePdf(doc);
    } catch (err: any) {
      setError(err?.message || 'Unable to generate invoice PDF. Please try again.');
    } finally {
      setDownloadingInvoiceId(null);
    }
  };

  useEffect(() => {
    if (tab === 'invoices') {
      loadInvoices();
    } else if (tab === 'quotes') {
      loadQuotes();
    }
  }, [tab, loadInvoices, loadQuotes]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <p className="label-caps text-[#6B7280] dark:text-[#9CA3AF]">Documents</p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl">
            {tab === 'invoices' ? 'Invoices' : tab === 'quotes' ? 'Quotes' : 'Receipts'}
          </h1>
        </div>
        {tab === 'invoices' && (
          <Link
            to="/app/invoices/new"
            className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-[#064E3B] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#04392B] min-h-[44px]"
          >
            <PlusCircle className="w-4 h-4" />
            <span>New Invoice</span>
          </Link>
        )}
        {tab === 'quotes' && (
          <Link
            to="/app/quotes/new"
            className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-[#064E3B] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#04392B] min-h-[44px]"
          >
            <PlusCircle className="w-4 h-4" />
            <span>New Quote</span>
          </Link>
        )}
      </div>

      {/* Document Type Tabs */}
      <div className="inline-flex rounded-[10px] border border-gray-200/70 dark:border-[#1F2925] bg-[#F4F6F8] dark:bg-[#111715] p-1 gap-1">
        {(
          [
            { id: 'invoices', label: 'Invoices' },
            { id: 'receipts', label: 'Receipts' },
            { id: 'quotes', label: 'Quotes' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-4 py-2 text-xs font-semibold min-h-[36px] transition-colors ${
              tab === t.id
                ? 'bg-[#064E3B] text-white'
                : 'text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'receipts' && <ReceiptsListPage business={business} />}

      {tab === 'quotes' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={quoteSearch}
                onChange={(e) => setQuoteSearch(e.target.value)}
                placeholder="Search customer or quote number…"
                className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] pl-10 pr-4 py-2.5 text-sm min-h-[44px]"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: 'ALL', label: 'All' },
                  { id: 'SENT', label: 'Sent' },
                  { id: 'ACCEPTED', label: 'Accepted' },
                  { id: 'DECLINED', label: 'Declined' },
                  { id: 'EXPIRED', label: 'Expired' },
                  { id: 'CONVERTED', label: 'Converted' },
                  { id: 'DRAFT', label: 'Drafts' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setQuoteFilter(f.id)}
                  className={`rounded-[10px] px-3 py-2 text-xs font-medium min-h-[40px] border transition-colors ${
                    quoteFilter === f.id
                      ? 'border-[#064E3B] bg-[#064E3B] text-white'
                      : 'border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] text-[#6B7280] dark:text-[#9CA3AF]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {quotesError && (
            <div className="rounded-[10px] border border-[#B91C1C]/30 bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]">
              {quotesError}
            </div>
          )}

          {quotesLoading ? (
            <div className="py-12 text-center text-xs text-[#6B7280]">Loading quotes…</div>
          ) : quotes.length === 0 ? (
            <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-8 text-center space-y-3">
              <FileText className="w-8 h-8 mx-auto text-[#6B7280]" />
              <h2 className="font-display text-2xl">No quotes yet</h2>
              <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] max-w-sm mx-auto">
                Send a clear quotation for your customer to accept on their phone, then turn it into an invoice in one tap.
              </p>
              <Link
                to="/app/quotes/new"
                className="inline-flex items-center gap-2 rounded-[10px] bg-[#064E3B] px-5 py-2.5 text-xs font-semibold text-white min-h-[44px]"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Create your first quote</span>
              </Link>
            </div>
          ) : (
            <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] divide-y divide-gray-100 dark:divide-[#1F2925]">
              {quotes.map((q) => (
                <Link
                  key={q.id}
                  to={q.status === 'DRAFT' ? `/app/quotes/${q.id}/edit` : `/app/quotes/${q.id}`}
                  className="flex items-center justify-between gap-4 p-4 hover:bg-[#F6F7F8] dark:hover:bg-[#1A221F] transition-colors"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-[#064E3B] dark:text-[#6EE7B7]">
                        {q.quoteNumber || 'DRAFT'}
                      </span>
                      {quoteStatusBadge(q)}
                    </div>
                    <p className="text-sm font-semibold truncate">{q.customerName}</p>
                    <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                      Issued {formatLagosDateOnly(q.issueDate)} · Valid until{' '}
                      {formatLagosDateOnly(q.validUntil)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-sm font-semibold tabular-nums">
                      {formatKobo(q.totalKobo, q.currency)}
                    </p>
                    {q.convertedInvoiceNumber && (
                      <p className="font-mono text-xs text-[#064E3B] dark:text-[#6EE7B7]">
                        {q.convertedInvoiceNumber}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'invoices' && (
        <div className="space-y-4">
          {/* Search + Status Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search customer or invoice number…"
                className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] pl-10 pr-4 py-2.5 text-sm min-h-[44px]"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: 'ALL', label: 'All' },
                  { id: 'SENT', label: 'Unpaid' },
                  { id: 'OVERDUE', label: 'Overdue' },
                  { id: 'PART_PAID', label: 'Part paid' },
                  { id: 'PAID', label: 'Paid' },
                  { id: 'DRAFT', label: 'Drafts' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={`rounded-[10px] px-3 py-2 text-xs font-medium min-h-[40px] border transition-colors ${
                    filter === f.id
                      ? 'border-[#064E3B] bg-[#064E3B] text-white'
                      : 'border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] text-[#6B7280] dark:text-[#9CA3AF]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-[10px] border border-[#B91C1C]/30 bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]">
              {error}
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-xs text-[#6B7280]">Loading invoices…</div>
          ) : invoices.length === 0 ? (
            <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-8 text-center space-y-3">
              <ReceiptText className="w-8 h-8 mx-auto text-[#6B7280]" />
              <h2 className="font-display text-2xl">No invoices yet</h2>
              <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] max-w-sm mx-auto">
                Send a clear invoice with your bank details and track what is paid and what is left.
              </p>
              <Link
                to="/app/invoices/new"
                className="inline-flex items-center gap-2 rounded-[10px] bg-[#064E3B] px-5 py-2.5 text-xs font-semibold text-white min-h-[44px]"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Create your first invoice</span>
              </Link>
            </div>
          ) : (
            <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] divide-y divide-gray-100 dark:divide-[#1F2925]">
              {invoices.map((inv) => {
                const isDownloading = downloadingInvoiceId === inv.id;
                return (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between gap-3 p-4 hover:bg-[#F6F7F8] dark:hover:bg-[#1A221F] transition-colors"
                  >
                    <Link
                      to={
                        inv.status === 'DRAFT'
                          ? `/app/invoices/${inv.id}/edit`
                          : `/app/invoices/${inv.id}`
                      }
                      className="flex flex-1 items-center justify-between gap-4 min-w-0"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-[#064E3B] dark:text-[#6EE7B7]">
                            {inv.invoiceNumber || 'DRAFT'}
                          </span>
                          {invoiceStatusBadge(inv)}
                        </div>
                        <p className="text-sm font-semibold truncate">{inv.customerName}</p>
                        <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                          Issued {formatLagosDateOnly(inv.issueDate)} · Due{' '}
                          {formatLagosDateOnly(inv.dueDate)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-mono text-sm font-semibold tabular-nums">
                          {formatKobo(inv.totalKobo, inv.currency)}
                        </p>
                        {inv.balanceDueKobo > 0 && inv.status !== 'DRAFT' && (
                          <p className="font-mono text-xs text-[#B45309] dark:text-amber-400 tabular-nums">
                            Left: {formatKobo(inv.balanceDueKobo, inv.currency)}
                          </p>
                        )}
                      </div>
                    </Link>
                    <button
                      type="button"
                      disabled={isDownloading}
                      onClick={(e) => handleQuickDownloadInvoicePdf(e, inv.id)}
                      aria-label={`Download PDF for ${inv.invoiceNumber || 'draft invoice'}`}
                      title="Download PDF"
                      className="shrink-0 inline-flex items-center gap-1 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-2.5 py-2 text-xs font-medium text-[#111827] dark:text-[#F3F4F6] hover:border-[#064E3B] hover:text-[#064E3B] dark:hover:text-[#10B981] disabled:opacity-50 min-h-[38px]"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">
                        {isDownloading ? 'PDF…' : 'PDF'}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
