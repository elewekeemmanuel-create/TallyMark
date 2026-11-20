import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileText,
  X,
  XCircle,
} from 'lucide-react';
import { Link } from '../../lib/router';
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
import type { PaymentClaimRecord } from '../../shared/v2/types';
import { v2Api } from '../api';

type ClaimTab = 'PENDING' | 'HISTORY';

export function ClaimsReviewPage({ business }: { business: BusinessProfile }) {
  const [tab, setTab] = useState<ClaimTab>('PENDING');
  const [claims, setClaims] = useState<PaymentClaimRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Per-claim editable confirm state (allows confirming in 2-3 taps with editable amount)
  const [amountInputs, setAmountInputs] = useState<Record<string, string>>({});
  const [methodInputs, setMethodInputs] = useState<Record<string, PaymentMethod>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  // Proof viewer modal
  const [proofModal, setProofModal] = useState<{
    claimRef: string;
    url: string;
    mime: string;
  } | null>(null);
  const [proofLoadingId, setProofLoadingId] = useState<string | null>(null);

  // Reject modal (private reason)
  const [rejectTarget, setRejectTarget] = useState<PaymentClaimRecord | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await v2Api.listClaims({
        status: tab === 'PENDING' ? 'PENDING' : 'ALL',
      });
      const list =
        tab === 'PENDING'
          ? res.claims.filter((c) => c.status === 'PENDING')
          : res.claims.filter((c) => c.status !== 'PENDING');
      setClaims(list);

      const nextAmounts: Record<string, string> = {};
      const nextMethods: Record<string, PaymentMethod> = {};
      for (const c of list) {
        if (c.status === 'PENDING') {
          const capped =
            c.invoiceBalanceDueKobo > 0
              ? Math.min(c.amountKobo, c.invoiceBalanceDueKobo)
              : c.amountKobo;
          nextAmounts[c.id] = formatKoboPlainInput(capped);
          nextMethods[c.id] = 'Transfer';
        }
      }
      setAmountInputs(nextAmounts);
      setMethodInputs(nextMethods);
    } catch (err: any) {
      setError(err?.message || 'Unable to load payment reports');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  };

  const handleOpenProof = async (claim: PaymentClaimRecord) => {
    setProofLoadingId(claim.id);
    setError(null);
    try {
      const res = await v2Api.getClaimProofUrl(claim.id);
      setProofModal({
        claimRef: claim.claimRef,
        url: res.url,
        mime: res.mime,
      });
    } catch (err: any) {
      setError(err?.message || 'Unable to open payment proof');
    } finally {
      setProofLoadingId(null);
    }
  };

  const handleConfirm = async (claim: PaymentClaimRecord) => {
    const rawAmount = amountInputs[claim.id] ?? formatKoboPlainInput(claim.amountKobo);
    const amountKobo = parseAmountToKobo(rawAmount);
    if (amountKobo <= 0) {
      setError('Enter a valid amount received before confirming.');
      return;
    }

    setBusyId(claim.id);
    setError(null);
    try {
      const res = await v2Api.confirmClaim(claim.id, {
        amountKobo,
        paymentMethod: methodInputs[claim.id] || 'Transfer',
        paymentDate: getLagosDateString(),
        reference: claim.reference || undefined,
        idempotencyKey: `claim-confirm-${claim.id}`,
      });
      notifyClaimsUpdated();
      await load();
      showNotice(
        res.receipt?.receiptNumber
          ? `Payment confirmed · Receipt ${res.receipt.receiptNumber} issued`
          : 'Payment confirmed and recorded in your Daily book'
      );
    } catch (err: any) {
      setError(err?.message || 'Unable to confirm payment report');
    } finally {
      setBusyId(null);
    }
  };

  const handleRejectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget) return;
    if (rejectReason.trim().length < 3) {
      setError('Enter a short private note explaining why this report was rejected.');
      return;
    }
    setBusyId(rejectTarget.id);
    setError(null);
    try {
      await v2Api.rejectClaim(rejectTarget.id, rejectReason.trim());
      setRejectTarget(null);
      setRejectReason('');
      notifyClaimsUpdated();
      await load();
      showNotice('Payment report rejected. Your note was kept private.');
    } catch (err: any) {
      setError(err?.message || 'Unable to reject payment report');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Customer claims</p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl">Payment Reports</h1>
          <p className="mt-1 text-xs text-[#5C635D] dark:text-[#9BA39D]">
            Check your bank statement before confirming. Confirming records the payment and issues a receipt.
          </p>
        </div>

        <Link
          to="/app/documents"
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] px-4 py-2.5 text-xs font-semibold min-h-[42px]"
        >
          <FileText className="w-4 h-4 text-[#064E3B] dark:text-[#10B981]" />
          <span>All Documents</span>
        </Link>
      </div>

      {/* Tabs */}
      <div className="inline-flex rounded-xl border border-[#E5DEC9] dark:border-[#242D28] bg-[#F5F1E7] dark:bg-[#111714] p-1 gap-1">
        {(
          [
            { id: 'PENDING', label: 'Awaiting check' },
            { id: 'HISTORY', label: 'History' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-4 py-2 text-xs font-semibold min-h-[36px] transition-colors ${
              tab === t.id
                ? 'bg-[#064E3B] text-white'
                : 'text-[#5C635D] dark:text-[#9BA39D] hover:text-[#121513] dark:hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
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

      {loading ? (
        <div className="py-12 text-center text-xs text-[#5C635D]">Loading payment reports…</div>
      ) : claims.length === 0 ? (
        <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-8 text-center space-y-3">
          <CheckCircle2 className="w-8 h-8 mx-auto text-[#064E3B] dark:text-[#10B981]" />
          <h2 className="font-display text-2xl">
            {tab === 'PENDING' ? 'No payment reports waiting' : 'No reviewed reports yet'}
          </h2>
          <p className="text-xs text-[#5C635D] dark:text-[#9BA39D] max-w-sm mx-auto">
            {tab === 'PENDING'
              ? 'When a customer taps "I\'ve paid" on an invoice link, their report appears here for your check.'
              : 'Confirmed and rejected customer payment reports will show here.'}
          </p>
          <Link
            to="/app/documents"
            className="inline-flex items-center gap-2 rounded-xl bg-[#064E3B] px-4 py-2.5 text-xs font-semibold text-white min-h-[42px]"
          >
            <span>Open Invoices</span>
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {claims.map((claim) => {
            const isPending = claim.status === 'PENDING';
            const isBusy = busyId === claim.id;

            return (
              <article
                key={claim.id}
                className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-4 sm:p-5 space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/app/invoices/${claim.invoiceId}`}
                        className="font-mono text-xs font-semibold text-[#064E3B] dark:text-[#10B981] hover:underline"
                      >
                        {claim.invoiceNumber || 'Invoice'}
                      </Link>
                      <span className="font-mono text-xs text-[#5C635D]">{claim.claimRef}</span>
                      {claim.status === 'CONFIRMED' && (
                        <span className="text-xs font-semibold text-[#064E3B] dark:text-[#10B981]">
                          Confirmed
                        </span>
                      )}
                      {claim.status === 'REJECTED' && (
                        <span className="text-xs font-semibold text-[#B91C1C]">Rejected</span>
                      )}
                    </div>
                    <p className="text-sm font-semibold">
                      {claim.payerName}{' '}
                      <span className="font-normal text-[#5C635D] dark:text-[#9BA39D]">
                        for {claim.invoiceCustomerName}
                      </span>
                    </p>
                    <p className="text-xs text-[#5C635D] dark:text-[#9BA39D]">
                      Reported {formatLagosDateOnly(claim.createdAt.slice(0, 10))}
                      {claim.reference ? ` · Ref: ${claim.reference}` : ''}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="font-mono text-lg font-semibold tabular-nums">
                      {formatKobo(claim.amountKobo, claim.invoiceCurrency || business.currency)}
                    </p>
                    <p className="text-[11px] text-[#5C635D] dark:text-[#9BA39D] font-mono tabular-nums">
                      What&apos;s left: {formatKobo(claim.invoiceBalanceDueKobo, claim.invoiceCurrency || business.currency)}
                    </p>
                  </div>
                </div>

                {/* Duplicate Warning Banner */}
                {claim.duplicateWarning && (
                  <div className="rounded-xl border border-[#B45309]/40 bg-[#FEF9EC] dark:bg-amber-950/30 p-3 flex items-start gap-2.5 text-xs text-[#92400E] dark:text-amber-300">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Possible duplicate payment report</p>
                      <p className="mt-0.5">{claim.duplicateWarning.reason}</p>
                    </div>
                  </div>
                )}

                {/* Proof link row */}
                <div className="flex flex-wrap items-center gap-2">
                  {claim.hasProof ? (
                    <button
                      type="button"
                      disabled={proofLoadingId === claim.id}
                      onClick={() => handleOpenProof(claim)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#111714] px-3.5 py-2 text-xs font-semibold min-h-[38px]"
                    >
                      <Eye className="w-3.5 h-3.5 text-[#064E3B] dark:text-[#10B981]" />
                      <span>{proofLoadingId === claim.id ? 'Opening proof…' : 'View proof'}</span>
                    </button>
                  ) : claim.proofDeletedAt ? (
                    <span className="text-xs text-[#5C635D]">
                      Proof removed automatically after 90 days
                    </span>
                  ) : (
                    <span className="text-xs text-[#5C635D]">No file attached (reference only)</span>
                  )}
                </div>

                {/* Owner Private Rejection Note (History tab) */}
                {claim.status === 'REJECTED' && claim.decisionReason && (
                  <p className="text-xs text-[#5C635D] dark:text-[#9BA39D] border-t border-[#EFEAD9] dark:border-[#242D28] pt-3">
                    Private note: {claim.decisionReason}
                  </p>
                )}

                {/* Pending Actions: Editable Amount + Confirm (<= 3 taps) & Reject */}
                {isPending && (
                  <div className="pt-3 border-t border-[#EFEAD9] dark:border-[#242D28] space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="block text-xs space-y-1">
                        <span className="font-medium text-[#5C635D] dark:text-[#9BA39D]">
                          Confirmed amount (₦)
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={amountInputs[claim.id] ?? formatKoboPlainInput(claim.amountKobo)}
                          onChange={(e) =>
                            setAmountInputs((prev) => ({ ...prev, [claim.id]: e.target.value }))
                          }
                          className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#111714] px-3 py-2 text-sm font-mono min-h-[42px]"
                        />
                      </label>

                      <label className="block text-xs space-y-1">
                        <span className="font-medium text-[#5C635D] dark:text-[#9BA39D]">
                          Payment method
                        </span>
                        <select
                          value={methodInputs[claim.id] || 'Transfer'}
                          onChange={(e) =>
                            setMethodInputs((prev) => ({
                              ...prev,
                              [claim.id]: e.target.value as PaymentMethod,
                            }))
                          }
                          className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#111714] px-3 py-2 text-xs min-h-[42px]"
                        >
                          <option value="Transfer">Transfer</option>
                          <option value="Cash">Cash</option>
                          <option value="POS">POS</option>
                          <option value="Card">Card</option>
                          <option value="Other">Other</option>
                        </select>
                      </label>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleConfirm(claim)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#064E3B] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#04392B] min-h-[44px] disabled:opacity-60"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>{isBusy ? 'Confirming…' : 'Confirm & issue receipt'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setRejectReason('');
                          setRejectTarget(claim);
                        }}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#B91C1C]/35 px-4 py-2.5 text-xs font-semibold text-[#B91C1C] hover:bg-[#FEF2F2] min-h-[44px] disabled:opacity-60"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>Reject</span>
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Proof Modal (uses short-lived signed owner URL only) */}
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
              <div>
                <p className="label-caps text-[#5C635D]">Payment proof</p>
                <p className="font-mono text-sm font-semibold">{proofModal.claimRef}</p>
              </div>
              <button
                type="button"
                onClick={() => setProofModal(null)}
                aria-label="Close proof preview"
                className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-xl border border-[#DED6C2] dark:border-[#2B352F]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-auto rounded-xl border border-[#E5DEC9] dark:border-[#242D28] bg-[#FAF8F3] dark:bg-[#111714] p-2 flex items-center justify-center min-h-[260px]">
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
                  alt={`Payment proof ${proofModal.claimRef}`}
                  referrerPolicy="no-referrer"
                  className="max-h-[65vh] w-auto object-contain rounded-lg"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal (keeps reason private) */}
      {rejectTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleRejectSubmit}
            className="w-full max-w-md rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-5 space-y-4"
          >
            <div>
              <p className="label-caps text-[#5C635D]">Reject payment report</p>
              <h2 className="font-display text-2xl mt-0.5">{rejectTarget.claimRef}</h2>
              <p className="text-xs text-[#5C635D] mt-1">
                This note stays private in your records. The customer will only see a neutral message.
              </p>
            </div>

            <label className="block text-xs space-y-1">
              <span className="font-medium">Private reason</span>
              <textarea
                rows={3}
                required
                minLength={3}
                maxLength={250}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. No credit alert received for this transfer reference"
                className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-[#FAF8F3] dark:bg-[#111714] px-3 py-2 text-xs"
              />
            </label>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busyId === rejectTarget.id}
                className="flex-1 rounded-xl bg-[#B91C1C] px-4 py-2.5 text-xs font-semibold text-white min-h-[44px] disabled:opacity-60"
              >
                {busyId === rejectTarget.id ? 'Rejecting…' : 'Reject report'}
              </button>
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
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
