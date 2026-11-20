import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  MoreHorizontal,
  Printer,
  RefreshCw,
  Send,
  Share2,
  X,
  XCircle,
} from 'lucide-react';
import { Link, useRouter } from '../../lib/router';
import { notifyClaimsUpdated } from '../../lib/v2ModuleToggle';
import {
  formatKobo,
  formatKoboPlainInput,
  formatLagosDateOnly,
  getLagosDateString,
  parseAmountToKobo,
} from '../../shared/money';
import type { PaymentMethod } from '../../shared/schemas';
import type { BusinessProfile } from '../../shared/types';
import type {
  InvoiceRecord,
  PaymentClaimRecord,
  PaymentRecord,
} from '../../shared/v2/types';
import { v2Api } from '../api';
import { InvoiceDocument } from '../components/InvoiceDocument';
import { buildPublicInvoicePreview, downloadInvoicePdf } from '../pdf';

export function InvoiceDetailPage({
  business,
  invoiceId,
}: {
  business: BusinessProfile;
  invoiceId: string;
}) {
  const { navigate } = useRouter();
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [pendingClaims, setPendingClaims] = useState<PaymentClaimRecord[]>([]);
  const [claimAmounts, setClaimAmounts] = useState<Record<string, string>>({});
  const [claimBusyId, setClaimBusyId] = useState<string | null>(null);
  const [proofModal, setProofModal] = useState<{ claimRef: string; url: string; mime: string } | null>(
    null
  );
  const [rejectClaimTarget, setRejectClaimTarget] = useState<PaymentClaimRecord | null>(null);
  const [rejectClaimReason, setRejectClaimReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Payment modal state (pre-filled for <= 4 tap flow)
  const [payOpen, setPayOpen] = useState(false);
  const [payAmountText, setPayAmountText] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('Transfer');
  const [payDate, setPayDate] = useState(() => getLagosDateString());
  const [payRef, setPayRef] = useState('');
  const [payKey, setPayKey] = useState('');
  const [paySaving, setPaySaving] = useState(false);

  // More actions & reason modals
  const [moreOpen, setMoreOpen] = useState(false);
  const [reasonModal, setReasonModal] = useState<{
    kind: 'void_invoice' | 'write_off' | 'void_payment';
    targetReceiptId?: string;
    title: string;
    actionLabel: string;
  } | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [busyAction, setBusyAction] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, claimsRes] = await Promise.all([
        v2Api.getInvoice(invoiceId),
        v2Api.listClaims({ status: 'PENDING', invoiceId }).catch(() => ({ claims: [] })),
      ]);
      setInvoice(res.invoice);
      setPayments(res.payments || []);
      const pending = (claimsRes.claims || []).filter((c) => c.status === 'PENDING');
      setPendingClaims(pending);
      const nextAmts: Record<string, string> = {};
      for (const c of pending) {
        nextAmts[c.id] = formatKoboPlainInput(
          res.invoice.balanceDueKobo > 0
            ? Math.min(c.amountKobo, res.invoice.balanceDueKobo)
            : c.amountKobo
        );
      }
      setClaimAmounts(nextAmts);
    } catch (err: any) {
      setError(err?.message || 'Unable to load invoice');
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    load();
  }, [load]);

  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  };

  const openPaymentModal = () => {
    if (!invoice) return;
    setPayAmountText(formatKoboPlainInput(invoice.balanceDueKobo));
    setPayMethod('Transfer');
    setPayDate(getLagosDateString());
    setPayRef('');
    setPayKey(
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? `pay-${crypto.randomUUID()}`
        : `pay-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    setError(null);
    setPayOpen(true);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoice || !invoice.debtId) return;
    const amountKobo = parseAmountToKobo(payAmountText);
    if (amountKobo <= 0) {
      setError('Enter a payment amount greater than zero.');
      return;
    }
    setPaySaving(true);
    setError(null);
    try {
      const res = await v2Api.recordPayment({
        debtId: invoice.debtId,
        amountKobo,
        paymentMethod: payMethod,
        paymentDate: payDate,
        reference: payRef.trim(),
        idempotencyKey: payKey,
      });
      setPayOpen(false);
      await load();
      showNotice(
        res.receipt?.receiptNumber
          ? `Payment recorded · Receipt ${res.receipt.receiptNumber} issued`
          : 'Payment recorded'
      );
    } catch (err: any) {
      setError(err?.message || 'Unable to record payment');
    } finally {
      setPaySaving(false);
    }
  };

  const handleReasonConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoice || !reasonModal) return;
    if (reasonText.trim().length < 3) {
      setError('Enter a short reason (at least 3 characters).');
      return;
    }
    setBusyAction(true);
    setError(null);
    try {
      if (reasonModal.kind === 'void_invoice') {
        await v2Api.voidInvoice(invoice.id, reasonText.trim());
        showNotice('Invoice voided');
      } else if (reasonModal.kind === 'write_off') {
        await v2Api.writeOffInvoice(invoice.id, reasonText.trim());
        showNotice('Remaining balance written off · Invoice settled');
      } else if (reasonModal.kind === 'void_payment' && reasonModal.targetReceiptId) {
        await v2Api.voidPaymentByReceipt(reasonModal.targetReceiptId, reasonText.trim());
        showNotice('Payment receipt voided · Balance reopened');
      }
      setReasonModal(null);
      setReasonText('');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Action failed');
    } finally {
      setBusyAction(false);
    }
  };

  const handleRegenerateLink = async () => {
    if (!invoice) return;
    setBusyAction(true);
    setMoreOpen(false);
    setError(null);
    try {
      await v2Api.regenerateInvoiceLink(invoice.id);
      await load();
      showNotice('New link created. The previous link no longer works.');
    } catch (err: any) {
      setError(err?.message || 'Unable to regenerate link');
    } finally {
      setBusyAction(false);
    }
  };

  const handleReissue = async () => {
    if (!invoice) return;
    setBusyAction(true);
    setMoreOpen(false);
    setError(null);
    try {
      const res = await v2Api.reissueInvoice(invoice.id, 'Reissued with corrections');
      navigate(`/app/invoices/${res.invoice.id}/edit`, { replace: true });
    } catch (err: any) {
      setError(err?.message || 'Unable to reissue invoice');
    } finally {
      setBusyAction(false);
    }
  };

  const handleSendDraft = async () => {
    if (!invoice) return;
    setBusyAction(true);
    setError(null);
    try {
      await v2Api.sendInvoice(invoice.id);
      await load();
      showNotice('Invoice sent and locked');
    } catch (err: any) {
      setError(err?.message || 'Unable to send invoice');
    } finally {
      setBusyAction(false);
    }
  };

  if (loading) {
    return <div className="py-16 text-center text-xs text-[#5C635D]">Loading invoice…</div>;
  }

  if (!invoice) {
    return (
      <div className="py-16 text-center space-y-3">
        <p className="text-sm text-[#B91C1C]">{error || 'Invoice not found'}</p>
        <Link to="/app/documents" className="text-xs font-semibold text-[#064E3B] underline">
          Back to Documents
        </Link>
      </div>
    );
  }

  const publicUrl = `${window.location.origin}/i/${invoice.publicId}`;
  const isOpen = (invoice.status === 'SENT' || invoice.status === 'PART_PAID') && invoice.balanceDueKobo > 0;
  const hasActivePayments = payments.some((p) => !p.isVoided);

  const previewDoc = buildPublicInvoicePreview(invoice, business, payments, pendingClaims.length);

  const handleDownloadPdf = async () => {
    setPdfBusy(true);
    setError(null);
    try {
      await downloadInvoicePdf(previewDoc);
      showNotice('Invoice PDF downloaded');
    } catch (err: any) {
      setError(err?.message || 'Unable to generate invoice PDF. Please try again.');
    } finally {
      setPdfBusy(false);
    }
  };

  const whatsappText = encodeURIComponent(
    `Invoice ${previewDoc.snapshot.invoiceNumber} from ${previewDoc.snapshot.business.name}\nAmount due: ${formatKobo(invoice.balanceDueKobo || invoice.totalKobo, invoice.currency)}\nView invoice: ${publicUrl}`
  );

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      showNotice('Invoice link copied');
    } catch {
      showNotice(publicUrl);
    }
  };

  const handleWebShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Invoice ${previewDoc.snapshot.invoiceNumber}`,
          text: `Invoice ${previewDoc.snapshot.invoiceNumber} from ${previewDoc.snapshot.business.name}`,
          url: publicUrl,
        });
        return;
      } catch {
        // fallback to copy
      }
    }
    await handleCopyLink();
  };

  return (
    <div className="max-w-4xl space-y-5">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/app/documents"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#5C635D] hover:text-[#121513] dark:hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Documents</span>
          </Link>
          {invoice.sourceQuoteId && (
            <Link
              to={`/app/quotes/${invoice.sourceQuoteId}`}
              className="text-xs font-medium text-[#064E3B] dark:text-[#10B981] hover:underline"
            >
              View source quote
            </Link>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {invoice.status === 'DRAFT' && (
            <>
              <Link
                to={`/app/invoices/${invoice.id}/edit`}
                className="rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] px-3.5 py-2 text-xs font-semibold min-h-[40px] inline-flex items-center"
              >
                Edit draft
              </Link>
              <button
                type="button"
                disabled={busyAction}
                onClick={handleSendDraft}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#064E3B] px-4 py-2 text-xs font-semibold text-white min-h-[40px]"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send invoice</span>
              </button>
            </>
          )}

          {isOpen && invoice.debtId && (
            <button
              type="button"
              onClick={openPaymentModal}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#064E3B] px-4 py-2 text-xs font-semibold text-white hover:bg-[#04392B] min-h-[42px]"
            >
              <Banknote className="w-4 h-4" />
              <span>Record payment</span>
            </button>
          )}

          <button
            type="button"
            disabled={pdfBusy}
            onClick={handleDownloadPdf}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] px-3.5 py-2 text-xs font-semibold hover:bg-[#FAF8F3] dark:hover:bg-[#1B231F] disabled:opacity-60 min-h-[42px]"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{pdfBusy ? 'Preparing PDF…' : 'Download PDF'}</span>
          </button>

          {invoice.status !== 'DRAFT' && (
            <>
              <a
                href={`https://wa.me/?text=${whatsappText}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] px-3.5 py-2 text-xs font-semibold min-h-[42px]"
              >
                <Share2 className="w-3.5 h-3.5 text-[#064E3B] dark:text-[#10B981]" />
                <span>WhatsApp</span>
              </a>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMoreOpen((v) => !v)}
                  aria-label="More invoice actions"
                  className="inline-flex items-center gap-1 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] px-3 py-2 text-xs font-semibold min-h-[42px]"
                >
                  <MoreHorizontal className="w-4 h-4" />
                  <span>More</span>
                </button>
                {moreOpen && (
                  <div className="absolute right-0 mt-1.5 w-56 rounded-xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] shadow-lg py-1.5 z-30 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setMoreOpen(false);
                        window.print();
                      }}
                      className="w-full px-3.5 py-2 text-left hover:bg-[#FAF8F3] dark:hover:bg-[#1B231F] flex items-center gap-2"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Print invoice</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMoreOpen(false);
                        handleCopyLink();
                      }}
                      className="w-full px-3.5 py-2 text-left hover:bg-[#FAF8F3] dark:hover:bg-[#1B231F] flex items-center gap-2"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy public link</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMoreOpen(false);
                        handleWebShare();
                      }}
                      className="w-full px-3.5 py-2 text-left hover:bg-[#FAF8F3] dark:hover:bg-[#1B231F] flex items-center gap-2"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      <span>Share via device</span>
                    </button>
                    <a
                      href={publicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setMoreOpen(false)}
                      className="w-full px-3.5 py-2 text-left hover:bg-[#FAF8F3] dark:hover:bg-[#1B231F] flex items-center gap-2"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Open public page</span>
                    </a>
                    <button
                      type="button"
                      onClick={handleRegenerateLink}
                      className="w-full px-3.5 py-2 text-left hover:bg-[#FAF8F3] dark:hover:bg-[#1B231F] flex items-center gap-2"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Regenerate public link</span>
                    </button>
                    {invoice.status === 'SENT' && !hasActivePayments && (
                      <button
                        type="button"
                        onClick={handleReissue}
                        className="w-full px-3.5 py-2 text-left hover:bg-[#FAF8F3] dark:hover:bg-[#1B231F]"
                      >
                        Reissue invoice (void + copy)
                      </button>
                    )}
                    {isOpen && (
                      <button
                        type="button"
                        onClick={() => {
                          setMoreOpen(false);
                          setReasonText('');
                          setReasonModal({
                            kind: 'write_off',
                            title: 'Write off remaining balance',
                            actionLabel: 'Write off & settle',
                          });
                        }}
                        className="w-full px-3.5 py-2 text-left hover:bg-[#FAF8F3] dark:hover:bg-[#1B231F] text-[#B45309]"
                      >
                        Write off balance
                      </button>
                    )}
                    {invoice.status !== 'VOID' && !hasActivePayments && (
                      <button
                        type="button"
                        onClick={() => {
                          setMoreOpen(false);
                          setReasonText('');
                          setReasonModal({
                            kind: 'void_invoice',
                            title: 'Void invoice',
                            actionLabel: 'Void invoice',
                          });
                        }}
                        className="w-full px-3.5 py-2 text-left hover:bg-[#FEF2F2] text-[#B91C1C]"
                      >
                        Void invoice
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {notice && (
        <div className="rounded-xl border border-[#064E3B]/30 bg-[#ECFDF5] dark:bg-emerald-950/30 p-3 text-xs font-medium text-[#064E3B] dark:text-emerald-300">
          {notice}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-[#B91C1C]/30 bg-[#FEF2F2] dark:bg-red-950/30 p-3 text-xs text-[#B91C1C] dark:text-red-300">
          {error}
        </div>
      )}

      {/* Pending Customer Payment Reports for this Invoice */}
      {pendingClaims.length > 0 && (
        <section className="rounded-2xl border border-[#B45309]/40 bg-[#FEF9EC] dark:bg-amber-950/25 p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="label-caps text-[#92400E] dark:text-amber-300">
                Customer payment {pendingClaims.length === 1 ? 'report' : 'reports'} awaiting check
              </p>
              <p className="text-xs text-[#713F12] dark:text-amber-200/90 mt-0.5">
                Confirm only after checking your bank alert. Confirming issues a linked receipt.
              </p>
            </div>
            <Link
              to="/app/claims"
              className="text-xs font-semibold text-[#064E3B] dark:text-[#10B981] hover:underline shrink-0"
            >
              All reports
            </Link>
          </div>

          <div className="space-y-3">
            {pendingClaims.map((claim) => (
              <div
                key={claim.id}
                className="rounded-xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-3.5 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2 text-xs">
                  <div>
                    <p className="font-semibold text-sm">
                      {claim.payerName}{' '}
                      <span className="font-mono text-xs text-[#5C635D]">({claim.claimRef})</span>
                    </p>
                    <p className="text-[#5C635D] dark:text-[#9BA39D]">
                      Reported {formatKobo(claim.amountKobo, invoice.currency)}
                      {claim.reference ? ` · Ref: ${claim.reference}` : ''}
                    </p>
                  </div>
                  {claim.hasProof && (
                    <button
                      type="button"
                      onClick={async () => {
                        setError(null);
                        try {
                          const p = await v2Api.getClaimProofUrl(claim.id);
                          setProofModal({ claimRef: claim.claimRef, url: p.url, mime: p.mime });
                        } catch (err: any) {
                          setError(err?.message || 'Unable to open proof');
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#DED6C2] dark:border-[#2B352F] px-3 py-1.5 text-xs font-semibold"
                    >
                      <Eye className="w-3.5 h-3.5 text-[#064E3B] dark:text-[#10B981]" />
                      <span>View proof</span>
                    </button>
                  )}
                </div>

                {claim.duplicateWarning && (
                  <div className="rounded-lg border border-[#B45309]/40 bg-[#FEF9EC] dark:bg-amber-950/30 p-2.5 flex items-start gap-2 text-xs text-[#92400E] dark:text-amber-300">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{claim.duplicateWarning.reason}</span>
                  </div>
                )}

                <div className="flex flex-wrap items-end gap-2">
                  <label className="block text-xs space-y-1 flex-1 min-w-[140px]">
                    <span className="font-medium text-[#5C635D]">Confirmed amount (₦)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={claimAmounts[claim.id] ?? formatKoboPlainInput(claim.amountKobo)}
                      onChange={(e) =>
                        setClaimAmounts((prev) => ({ ...prev, [claim.id]: e.target.value }))
                      }
                      className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#111714] px-3 py-2 text-xs font-mono min-h-[40px]"
                    />
                  </label>

                  <button
                    type="button"
                    disabled={claimBusyId === claim.id}
                    onClick={async () => {
                      const amt = parseAmountToKobo(
                        claimAmounts[claim.id] ?? formatKoboPlainInput(claim.amountKobo)
                      );
                      if (amt <= 0) {
                        setError('Enter a valid confirmed amount.');
                        return;
                      }
                      setClaimBusyId(claim.id);
                      setError(null);
                      try {
                        const res = await v2Api.confirmClaim(claim.id, {
                          amountKobo: amt,
                          paymentMethod: 'Transfer',
                          paymentDate: getLagosDateString(),
                          reference: claim.reference || undefined,
                          idempotencyKey: `claim-confirm-${claim.id}`,
                        });
                        notifyClaimsUpdated();
                        await load();
                        showNotice(
                          res.receipt?.receiptNumber
                            ? `Payment confirmed · Receipt ${res.receipt.receiptNumber} issued`
                            : 'Payment confirmed'
                        );
                      } catch (err: any) {
                        setError(err?.message || 'Unable to confirm payment report');
                      } finally {
                        setClaimBusyId(null);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#064E3B] px-3.5 py-2 text-xs font-semibold text-white min-h-[40px] disabled:opacity-60"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{claimBusyId === claim.id ? 'Confirming…' : 'Confirm & issue receipt'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={claimBusyId === claim.id}
                    onClick={() => {
                      setRejectClaimReason('');
                      setRejectClaimTarget(claim);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#B91C1C]/35 px-3 py-2 text-xs font-semibold text-[#B91C1C] min-h-[40px]"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Reject</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Paper Invoice Snapshot */}
      <InvoiceDocument invoice={previewDoc} />

      {/* Payments Recorded on this Invoice */}
      {invoice.status !== 'DRAFT' && (
        <section className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Payments recorded</h2>
            {isOpen && invoice.debtId && (
              <button
                type="button"
                onClick={openPaymentModal}
                className="text-xs font-semibold text-[#064E3B] dark:text-[#10B981] hover:underline"
              >
                + Record payment
              </button>
            )}
          </div>

          {payments.length === 0 ? (
            <p className="text-xs text-[#5C635D] dark:text-[#9BA39D]">
              No payment recorded yet. Money will appear in your Cash Book once you record a payment.
            </p>
          ) : (
            <div className="divide-y divide-[#EFEAD9] dark:divide-[#242D28]">
              {payments.map((p) => (
                <div key={p.id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold">
                        {formatKobo(p.amountKobo, invoice.currency)}
                      </span>
                      <span className="text-[#5C635D]">· {p.paymentMethod}</span>
                      {p.isVoided && (
                        <span className="font-semibold text-[#B91C1C]">VOID</span>
                      )}
                    </div>
                    <p className="text-[#5C635D] dark:text-[#9BA39D]">
                      {formatLagosDateOnly(p.paymentDate)}
                      {p.receiptNumber ? ` · Receipt ${p.receiptNumber}` : ''}
                      {p.reference ? ` · Ref: ${p.reference}` : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {p.receiptId && (
                      <Link
                        to={`/app/receipts/${p.receiptId}`}
                        className="rounded-lg border border-[#DED6C2] dark:border-[#2B352F] px-2.5 py-1.5 text-xs font-medium"
                      >
                        View receipt
                      </Link>
                    )}
                    {!p.isVoided && p.receiptId && (
                      <button
                        type="button"
                        onClick={() => {
                          setReasonText('');
                          setReasonModal({
                            kind: 'void_payment',
                            targetReceiptId: p.receiptId!,
                            title: `Void payment receipt ${p.receiptNumber || ''}`,
                            actionLabel: 'Void & reopen balance',
                          });
                        }}
                        className="rounded-lg border border-[#B91C1C]/30 px-2.5 py-1.5 text-xs font-medium text-[#B91C1C]"
                      >
                        Void receipt
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Record Payment Modal */}
      {payOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleRecordPayment}
            className="w-full max-w-md rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-5 space-y-4"
          >
            <div>
              <p className="label-caps text-[#5C635D]">Record payment</p>
              <h2 className="font-display text-2xl mt-0.5">{invoice.invoiceNumber}</h2>
              <p className="text-xs text-[#5C635D]">
                What&apos;s left: <strong className="font-mono">{formatKobo(invoice.balanceDueKobo, invoice.currency)}</strong>
              </p>
            </div>

            <label className="block text-xs space-y-1">
              <span className="font-medium">Amount received (₦)</span>
              <input
                type="text"
                inputMode="decimal"
                required
                value={payAmountText}
                onChange={(e) => setPayAmountText(e.target.value)}
                className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#111714] px-3.5 py-2.5 text-sm font-mono min-h-[44px]"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs space-y-1">
                <span className="font-medium">Payment method</span>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                  className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#111714] px-3 py-2.5 text-xs min-h-[44px]"
                >
                  <option value="Transfer">Transfer</option>
                  <option value="Cash">Cash</option>
                  <option value="POS">POS</option>
                  <option value="Card">Card</option>
                  <option value="Other">Other</option>
                </select>
              </label>

              <label className="block text-xs space-y-1">
                <span className="font-medium">Payment date</span>
                <input
                  type="date"
                  value={payDate}
                  min={invoice.issueDate}
                  max={getLagosDateString()}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#111714] px-3 py-2.5 text-xs font-mono min-h-[44px]"
                />
              </label>
            </div>

            <label className="block text-xs space-y-1">
              <span className="font-medium">Reference (optional)</span>
              <input
                type="text"
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                placeholder="e.g. GTBank transfer ref"
                maxLength={80}
                className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#111714] px-3 py-2.5 text-xs min-h-[44px]"
              />
            </label>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={paySaving}
                className="flex-1 rounded-xl bg-[#064E3B] px-4 py-2.5 text-xs font-semibold text-white min-h-[44px] disabled:opacity-60"
              >
                {paySaving ? 'Saving…' : 'Save payment & issue receipt'}
              </button>
              <button
                type="button"
                onClick={() => setPayOpen(false)}
                className="rounded-xl border border-[#DED6C2] dark:border-[#2B352F] px-4 py-2.5 text-xs font-medium min-h-[44px]"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Reason Modal (Void Invoice / Write Off Balance / Void Payment Receipt) */}
      {reasonModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleReasonConfirm}
            className="w-full max-w-md rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-5 space-y-4"
          >
            <h2 className="font-display text-2xl">{reasonModal.title}</h2>
            <label className="block text-xs space-y-1">
              <span className="font-medium">Reason (required for audit log)</span>
              <textarea
                rows={3}
                required
                minLength={3}
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder="Enter clear reason…"
                className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#111714] px-3 py-2 text-xs"
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busyAction}
                className="flex-1 rounded-xl bg-[#B91C1C] px-4 py-2.5 text-xs font-semibold text-white min-h-[44px] disabled:opacity-60"
              >
                {busyAction ? 'Processing…' : reasonModal.actionLabel}
              </button>
              <button
                type="button"
                onClick={() => setReasonModal(null)}
                className="rounded-xl border border-[#DED6C2] dark:border-[#2B352F] px-4 py-2.5 text-xs font-medium min-h-[44px]"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Signed Proof Viewer Modal */}
      {proofModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setProofModal(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-4 space-y-3 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-sm font-semibold">Proof · {proofModal.claimRef}</p>
              <button
                type="button"
                onClick={() => setProofModal(null)}
                aria-label="Close proof"
                className="min-w-[38px] min-h-[38px] inline-flex items-center justify-center rounded-xl border border-[#DED6C2] dark:border-[#2B352F]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto rounded-xl border border-[#E5DEC9] dark:border-[#242D28] bg-[#FAF8F3] dark:bg-[#111714] p-2 flex items-center justify-center min-h-[240px]">
              {proofModal.mime === 'application/pdf' ? (
                <iframe
                  title={`Proof ${proofModal.claimRef}`}
                  src={proofModal.url}
                  sandbox=""
                  className="w-full h-[60vh] rounded-lg bg-white"
                />
              ) : (
                <img
                  src={proofModal.url}
                  alt={`Proof ${proofModal.claimRef}`}
                  referrerPolicy="no-referrer"
                  className="max-h-[65vh] w-auto object-contain rounded-lg"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Private Reject Claim Modal */}
      {rejectClaimTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (rejectClaimReason.trim().length < 3) {
                setError('Enter a short private reason (at least 3 characters).');
                return;
              }
              setClaimBusyId(rejectClaimTarget.id);
              setError(null);
              try {
                await v2Api.rejectClaim(rejectClaimTarget.id, rejectClaimReason.trim());
                setRejectClaimTarget(null);
                setRejectClaimReason('');
                notifyClaimsUpdated();
                await load();
                showNotice('Payment report rejected. Reason kept private.');
              } catch (err: any) {
                setError(err?.message || 'Unable to reject report');
              } finally {
                setClaimBusyId(null);
              }
            }}
            className="w-full max-w-md rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-5 space-y-4"
          >
            <div>
              <p className="label-caps text-[#5C635D]">Reject payment report</p>
              <h2 className="font-display text-2xl mt-0.5">{rejectClaimTarget.claimRef}</h2>
              <p className="text-xs text-[#5C635D] mt-1">
                Kept private for your records only. The customer sees a neutral message.
              </p>
            </div>
            <label className="block text-xs space-y-1">
              <span className="font-medium">Private reason</span>
              <textarea
                rows={3}
                required
                minLength={3}
                maxLength={250}
                value={rejectClaimReason}
                onChange={(e) => setRejectClaimReason(e.target.value)}
                placeholder="e.g. No transfer received matching this reference"
                className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#111714] px-3 py-2 text-xs"
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={claimBusyId === rejectClaimTarget.id}
                className="flex-1 rounded-xl bg-[#B91C1C] px-4 py-2.5 text-xs font-semibold text-white min-h-[44px] disabled:opacity-60"
              >
                {claimBusyId === rejectClaimTarget.id ? 'Rejecting…' : 'Reject report'}
              </button>
              <button
                type="button"
                onClick={() => setRejectClaimTarget(null)}
                className="rounded-xl border border-[#DED6C2] dark:border-[#2B352F] px-4 py-2.5 text-xs font-medium min-h-[44px]"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
