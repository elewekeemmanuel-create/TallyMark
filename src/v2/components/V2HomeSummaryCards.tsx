import React, { useEffect, useState } from 'react';
import { ArrowRight, FileText, PlusCircle } from 'lucide-react';
import { Link } from '../../lib/router';
import { formatKobo } from '../../shared/money';
import type { BusinessProfile } from '../../shared/types';
import { v2Api, type V2Summary } from '../api';

export function V2HomeSummaryCards({ business }: { business: BusinessProfile }) {
  const [summary, setSummary] = useState<V2Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    v2Api
      .getSummary()
      .then((res) => {
        if (active) setSummary(res.summary);
      })
      .catch(() => {
        // Silently skip if migration not applied yet
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-4 sm:p-5 space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#064E3B] dark:text-[#10B981]" />
          <h2 className="text-sm font-semibold text-[#121513] dark:text-[#F4F1EA]">
            Invoices
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/app/documents"
            className="text-xs font-medium text-[#064E3B] dark:text-[#10B981] hover:underline"
          >
            All documents
          </Link>
          <Link
            to="/app/invoices/new"
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#064E3B] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#04392B] min-h-[34px]"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>New Invoice</span>
          </Link>
        </div>
      </div>

      {!loading && (summary?.pendingClaimsCount || 0) > 0 && (
        <Link
          to="/app/claims"
          className="flex items-center justify-between gap-3 rounded-xl border border-[#B45309]/40 bg-[#FEF9EC] dark:bg-amber-950/30 px-3.5 py-3 text-xs text-[#92400E] dark:text-amber-300 hover:border-[#B45309]"
        >
          <div>
            <p className="font-semibold">
              {summary?.pendingClaimsCount}{' '}
              {summary?.pendingClaimsCount === 1
                ? 'payment report awaiting check'
                : 'payment reports awaiting check'}
            </p>
            <p className="mt-0.5 opacity-90">
              Review customer proof and confirm to issue a receipt.
            </p>
          </div>
          <ArrowRight className="w-4 h-4 shrink-0" />
        </Link>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Link
          to="/app/documents"
          className="rounded-xl border border-[#ECE6D8] dark:border-[#242D28] bg-[#FAF8F3] dark:bg-[#111714] p-3.5 hover:border-[#064E3B]/40"
        >
          <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Unpaid Invoices</p>
          <p className="mt-1 font-mono-num text-lg font-semibold text-[#121513] dark:text-[#F4F1EA]">
            {loading ? '—' : formatKobo(summary?.unpaidTotalKobo || 0, business.currency)}
          </p>
          <p className="mt-0.5 text-[11px] text-[#5C635D] dark:text-[#9BA39D]">
            {loading ? '' : `${summary?.unpaidCount || 0} open`}
          </p>
        </Link>

        <Link
          to="/app/documents"
          className="rounded-xl border border-[#ECE6D8] dark:border-[#242D28] bg-[#FAF8F3] dark:bg-[#111714] p-3.5 hover:border-[#064E3B]/40"
        >
          <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Overdue</p>
          <p
            className={`mt-1 font-mono-num text-lg font-semibold ${
              (summary?.overdueCount || 0) > 0
                ? 'text-[#B91C1C] dark:text-red-400'
                : 'text-[#064E3B] dark:text-[#10B981]'
            }`}
          >
            {loading ? '—' : formatKobo(summary?.overdueTotalKobo || 0, business.currency)}
          </p>
          <p className="mt-0.5 text-[11px] text-[#5C635D] dark:text-[#9BA39D]">
            {loading ? '' : `${summary?.overdueCount || 0} past due`}
          </p>
        </Link>

        <Link
          to="/app/documents"
          className="rounded-xl border border-[#ECE6D8] dark:border-[#242D28] bg-[#FAF8F3] dark:bg-[#111714] p-3.5 flex items-center justify-between hover:border-[#064E3B]/40"
        >
          <div>
            <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Drafts</p>
            <p className="mt-1 font-mono-num text-lg font-semibold text-[#121513] dark:text-[#F4F1EA]">
              {loading ? '—' : summary?.draftCount || 0}
            </p>
            <p className="mt-0.5 text-[11px] text-[#5C635D] dark:text-[#9BA39D]">
              Ready to send
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-[#5C635D]" />
        </Link>
      </div>
    </section>
  );
}
