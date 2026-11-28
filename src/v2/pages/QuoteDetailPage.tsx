import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  MoreHorizontal,
  Printer,
  RefreshCw,
  Send,
  Share2,
  XCircle,
} from 'lucide-react';
import { Link, useRouter } from '../../lib/router';
import { formatKobo, formatLagosDateOnly } from '../../shared/money';
import type { BusinessProfile } from '../../shared/types';
import type { QuoteRecord } from '../../shared/v2/types';
import { v2Api } from '../api';
import { QuoteDocument } from '../components/QuoteDocument';
import { buildPublicQuotePreview, downloadQuotePdf } from '../pdf';

function formatLagosTimestamp(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-NG', {
      timeZone: 'Africa/Lagos',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

export function QuoteDetailPage({
  business,
  quoteId,
}: {
  business: BusinessProfile;
  quoteId: string;
}) {
  const { navigate } = useRouter();
  const [quote, setQuote] = useState<QuoteRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [voidModalOpen, setVoidModalOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await v2Api.getQuote(quoteId);
      setQuote(res.quote);
    } catch (err: any) {
      setError(err?.message || 'Unable to load quote');
    } finally {
      setLoading(false);
    }
  }, [quoteId]);

  useEffect(() => {
    load();
  }, [load]);

  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  };

  if (loading) {
    return <div className="py-16 text-center text-xs text-[#6B7280]">Loading quote…</div>;
  }

  if (!quote) {
    return (
      <div className="rounded-[20px] border border-gray-200/70 bg-white p-8 text-center space-y-3">
        <h1 className="font-display text-2xl">Quote not found</h1>
        {error && <p className="text-xs text-[#B91C1C]">{error}</p>}
        <Link
          to="/app/documents"
          className="inline-flex items-center gap-2 rounded-[10px] bg-[#064E3B] px-4 py-2.5 text-xs font-semibold text-white"
        >
          Back to Documents
        </Link>
      </div>
    );
  }

  const publicPreview = buildPublicQuotePreview(quote, business);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const publicUrl = `${origin}/q/${quote.publicId}`;
  const docNumber = quote.quoteNumber || 'Draft Quote';

  const canConvert =
    (quote.status === 'SENT' && !quote.isExpired) || quote.status === 'ACCEPTED';
  const canRevise = quote.status === 'SENT' || quote.status === 'DECLINED';
  const canVoid = quote.status !== 'VOID' && quote.status !== 'CONVERTED';

  const handleSend = async () => {
    setBusyAction(true);
    setError(null);
    try {
      const res = await v2Api.sendQuote(quote.id);
      setQuote(res.quote);
      showNotice(`Quote ${res.quote.quoteNumber} issued and ready to share`);
    } catch (err: any) {
      setError(err?.message || 'Unable to send quote');
    } finally {
      setBusyAction(false);
    }
  };

  const handleConvert = async () => {
    setBusyAction(true);
    setError(null);
    try {
      const res = await v2Api.convertQuoteToInvoice(quote.id, false);
      navigate(`/app/invoices/${res.invoice.id}/edit`);
    } catch (err: any) {
      setError(err?.message || 'Unable to convert quote to invoice');
      setBusyAction(false);
    }
  };

  const handleRevise = async () => {
    setBusyAction(true);
    setMoreOpen(false);
    setError(null);
    try {
      const res = await v2Api.reviseQuote(quote.id);
      navigate(`/app/quotes/${res.quote.id}/edit`);
    } catch (err: any) {
      setError(err?.message || 'Unable to revise quote');
      setBusyAction(false);
    }
  };

  const handleRegenerateLink = async () => {
    setBusyAction(true);
    setMoreOpen(false);
    setError(null);
    try {
      const res = await v2Api.regenerateQuoteLink(quote.id);
      setQuote(res.quote);
      showNotice('New public link created. The old link no longer works.');
    } catch (err: any) {
      setError(err?.message || 'Unable to regenerate link');
    } finally {
      setBusyAction(false);
    }
  };

  const handleVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (voidReason.trim().length < 3) {
      setError('Enter a short reason (at least 3 characters).');
      return;
    }
    setBusyAction(true);
    setError(null);
    try {
      const res = await v2Api.voidQuote(quote.id, voidReason.trim());
      setQuote(res.quote);
      setVoidModalOpen(false);
      setVoidReason('');
      showNotice('Quote voided');
    } catch (err: any) {
      setError(err?.message || 'Unable to void quote');
    } finally {
      setBusyAction(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      showNotice('Quote link copied');
    } catch {
      showNotice(publicUrl);
    }
  };

  const cleanPhone = (quote.customerPhone || '').replace(/[^0-9]/g, '');
  const waPhone =
    cleanPhone.startsWith('0') && cleanPhone.length === 11
      ? `234${cleanPhone.slice(1)}`
      : cleanPhone;
  const safeBiz = (publicPreview.snapshot.business.name || 'Business').replace(/[\r\n]+/g, ' ');
  const safeDoc = docNumber.replace(/[\r\n]+/g, ' ');
  const waMsg = [
    `Quotation ${safeDoc} from ${safeBiz}`,
    `Total: ${formatKobo(quote.totalKobo, quote.currency)}`,
    `Valid until: ${formatLagosDateOnly(quote.validUntil)}`,
    `View and respond here: ${publicUrl}`,
  ].join('\n');
  const whatsappUrl = waPhone
    ? `https://wa.me/${encodeURIComponent(waPhone)}?text=${encodeURIComponent(waMsg)}`
    : `https://wa.me/?text=${encodeURIComponent(waMsg)}`;

  const handleWebShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: `${docNumber} · ${publicPreview.snapshot.business.name}`,
          text: `Quotation ${docNumber} — ${formatKobo(quote.totalKobo, quote.currency)}`,
          url: publicUrl,
        });
        return;
      } catch {
        // fall through to copy
      }
    }
    await handleCopyLink();
  };

  const handleDownloadPdf = async () => {
    setPdfBusy(true);
    setError(null);
    try {
      await downloadQuotePdf(publicPreview);
    } catch (err: any) {
      setError(err?.message || 'Unable to generate PDF');
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-5 print:max-w-none print:space-y-0">
      {/* Header & Primary Actions */}
      <div className="no-print flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <Link
            to="/app/documents"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6B7280] hover:text-[#111827] dark:text-[#9CA3AF]"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Documents</span>
          </Link>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl">{docNumber}</h1>
          <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
            {quote.customerName} · Valid until {formatLagosDateOnly(quote.validUntil)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {quote.status === 'DRAFT' && (
            <>
              <button
                type="button"
                disabled={busyAction}
                onClick={handleSend}
                className="inline-flex items-center gap-2 rounded-[10px] bg-[#064E3B] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#04392B] min-h-[44px]"
              >
                <Send className="w-4 h-4" />
                <span>Send quote</span>
              </button>
              <Link
                to={`/app/quotes/${quote.id}/edit`}
                className="inline-flex items-center gap-2 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-4 py-2.5 text-xs font-semibold min-h-[44px]"
              >
                Edit draft
              </Link>
            </>
          )}

          {canConvert && (
            <button
              type="button"
              disabled={busyAction}
              onClick={handleConvert}
              className="inline-flex items-center gap-2 rounded-[10px] bg-[#064E3B] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#04392B] disabled:opacity-60 min-h-[44px]"
            >
              <span>{busyAction ? 'Converting…' : 'Convert to invoice'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}

          {quote.status === 'CONVERTED' && quote.convertedInvoiceId && (
            <Link
              to={`/app/invoices/${quote.convertedInvoiceId}`}
              className="inline-flex items-center gap-2 rounded-[10px] bg-[#064E3B] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#04392B] min-h-[44px]"
            >
              <span>
                Open {quote.convertedInvoiceNumber ? quote.convertedInvoiceNumber : 'invoice'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          )}

          {(quote.isExpired || quote.status === 'DECLINED') && (
            <button
              type="button"
              disabled={busyAction}
              onClick={handleRevise}
              className="inline-flex items-center gap-2 rounded-[10px] bg-[#064E3B] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#04392B] min-h-[44px]"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Revise quote</span>
            </button>
          )}

          <button
            type="button"
            disabled={pdfBusy}
            onClick={handleDownloadPdf}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3.5 py-2.5 text-xs font-semibold hover:bg-[#F6F7F8] dark:hover:bg-[#1A221F] disabled:opacity-60 min-h-[44px]"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{pdfBusy ? 'Preparing PDF…' : 'Download PDF'}</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3.5 py-2.5 text-xs font-semibold hover:bg-[#F6F7F8] dark:hover:bg-[#1A221F] min-h-[44px]"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print</span>
          </button>

          {(canRevise || canVoid || quote.status !== 'DRAFT') && (
            <div className="relative">
              <button
                type="button"
                aria-label="More quote actions"
                onClick={() => setMoreOpen((v) => !v)}
                className="inline-flex items-center justify-center rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3 py-2.5 min-h-[44px]"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {moreOpen && (
                <div className="absolute right-0 mt-1.5 w-52 rounded-[10px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] shadow-lg py-1.5 z-20 text-xs">
                  {canRevise && (
                    <button
                      type="button"
                      onClick={handleRevise}
                      className="w-full text-left px-3.5 py-2.5 hover:bg-[#F6F7F8] dark:hover:bg-[#1A221F] font-medium"
                    >
                      Revise quote (void &amp; copy)
                    </button>
                  )}
                  {quote.status !== 'DRAFT' && (
                    <button
                      type="button"
                      onClick={handleRegenerateLink}
                      className="w-full text-left px-3.5 py-2.5 hover:bg-[#F6F7F8] dark:hover:bg-[#1A221F] font-medium"
                    >
                      Regenerate public link
                    </button>
                  )}
                  {canVoid && (
                    <button
                      type="button"
                      onClick={() => {
                        setMoreOpen(false);
                        setVoidModalOpen(true);
                      }}
                      className="w-full text-left px-3.5 py-2.5 text-[#B91C1C] hover:bg-[#FEF2F2] font-medium"
                    >
                      Void quote
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {notice && (
        <div className="no-print rounded-[10px] border border-[#064E3B]/25 bg-[#ECFDF5] p-3 text-xs text-[#064E3B] font-medium">
          {notice}
        </div>
      )}
      {error && (
        <div className="no-print rounded-[10px] border border-[#B91C1C]/30 bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]">
          {error}
        </div>
      )}

      {/* Customer Acceptance / Decline Banner */}
      {(quote.status === 'ACCEPTED' || quote.status === 'CONVERTED') && quote.decisionName && (
        <div className="no-print rounded-[20px] border border-[#064E3B]/25 bg-[#ECFDF5] p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-[#064E3B] shrink-0 mt-0.5" />
          <div className="text-xs text-[#064E3B] space-y-0.5">
            <p className="font-semibold">
              Accepted by {quote.decisionName}
              {quote.decisionAt ? ` · ${formatLagosTimestamp(quote.decisionAt)}` : ''}
            </p>
            {quote.decisionNote && <p>Note: {quote.decisionNote}</p>}
          </div>
        </div>
      )}

      {quote.status === 'DECLINED' && quote.decisionName && (
        <div className="no-print rounded-[20px] border border-[#B91C1C]/30 bg-[#FEF2F2] p-4 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-[#B91C1C] shrink-0 mt-0.5" />
          <div className="text-xs text-[#991B1B] space-y-0.5">
            <p className="font-semibold">
              Declined by {quote.decisionName}
              {quote.decisionAt ? ` · ${formatLagosTimestamp(quote.decisionAt)}` : ''}
            </p>
            {quote.decisionNote && <p>Note: {quote.decisionNote}</p>}
          </div>
        </div>
      )}

      {/* Share Bar (when sent) */}
      {quote.status !== 'DRAFT' && (
        <div className="no-print flex flex-wrap gap-2">
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#064E3B] bg-white dark:bg-[#131917] px-3.5 py-2 text-xs font-semibold text-[#064E3B] dark:text-[#6EE7B7] min-h-[40px]"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Share on WhatsApp</span>
          </a>
          <button
            type="button"
            onClick={handleWebShare}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3.5 py-2 text-xs font-medium min-h-[40px]"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy link</span>
          </button>
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3.5 py-2 text-xs font-medium min-h-[40px]"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Public view</span>
          </a>
        </div>
      )}

      {/* Document Template */}
      <QuoteDocument quote={publicPreview} />

      {/* Void Modal */}
      {voidModalOpen && (
        <div className="no-print fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleVoid}
            className="w-full max-w-md rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 space-y-4"
          >
            <h2 className="font-display text-2xl">Void {docNumber}?</h2>
            <p className="text-xs text-[#6B7280]">
              Voiding marks this quote inactive while keeping its quote number in your records.
            </p>
            <div>
              <label className="block text-xs font-semibold mb-1" htmlFor="void-quote-reason">
                Reason
              </label>
              <input
                id="void-quote-reason"
                type="text"
                required
                minLength={3}
                maxLength={240}
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="e.g. Customer changed specification"
                className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#101512] px-3 py-2.5 text-sm min-h-[44px]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setVoidModalOpen(false)}
                className="rounded-[10px] border border-gray-200 px-4 py-2 text-xs font-semibold min-h-[40px]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyAction}
                className="rounded-[10px] bg-[#B91C1C] px-4 py-2 text-xs font-semibold text-white min-h-[40px]"
              >
                Void quote
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
