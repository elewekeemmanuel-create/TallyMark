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
    <section className="rounded-[24px] bg-white dark:bg-[#131917] p-5 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-[10px] bg-[#EFF6FF] dark:bg-blue-950/40 text-[#064E3B] dark:text-[#6EE7B7] inline-flex items-center justify-center">
            <FileText className="w-4 h-4" />
          </span>
          <h2 className="text-base font-semibold text-[#111827] dark:text-[#F3F4F6]">Invoices</h2>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/app/documents"
            className="text-xs font-semibold text-[#047857] dark:text-[#6EE7B7] hover:underline"
          >
            All documents
          </Link>
          <Link
            to="/app/invoices/new"
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#064E3B] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#04392B] min-h-[36px] transition-colors"
          >
            <PlusCircle className="w-3.5 h-3.5 text-[#6EE7B7]" />
            <span>New Invoice</span>
          </Link>
        </div>
      </div>

      {!loading && (summary?.pendingClaimsCount || 0) > 0 && (
        <Link
          to="/app/claims"
          className="flex items-center justify-between gap-3 rounded-[16px] bg-[#FFFBEB] dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/50 px-4 py-3 text-xs text-[#92400E] dark:text-amber-200 hover:bg-amber-50 transition-colors"
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
          className="rounded-[18px] bg-[#F6F7F8] dark:bg-[#1A221F] p-4 hover:bg-[#ECFDF5] dark:hover:bg-[#1F2D27] transition-colors"
        >
          <p className="text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">Unpaid Invoices</p>
          <p className="mt-1.5 font-mono-num text-lg font-semibold text-[#111827] dark:text-[#F3F4F6]">
            {loading ? '—' : formatKobo(summary?.unpaidTotalKobo || 0, business.currency)}
          </p>
          <p className="mt-0.5 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
            {loading ? '' : `${summary?.unpaidCount || 0} open`}
          </p>
        </Link>

        <Link
          to="/app/documents"
          className="rounded-[18px] bg-[#F6F7F8] dark:bg-[#1A221F] p-4 hover:bg-[#FEF2F2]/70 dark:hover:bg-[#1F2D27] transition-colors"
        >
          <p className="text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">Overdue</p>
          <p
            className={`mt-1.5 font-mono-num text-lg font-semibold ${
              (summary?.overdueCount || 0) > 0
                ? 'text-[#B91C1C] dark:text-red-400'
                : 'text-[#047857] dark:text-[#6EE7B7]'
            }`}
          >
            {loading ? '—' : formatKobo(summary?.overdueTotalKobo || 0, business.currency)}
          </p>
          <p className="mt-0.5 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
            {loading ? '' : `${summary?.overdueCount || 0} past due`}
          </p>
        </Link>

        <Link
          to="/app/documents"
          className="rounded-[18px] bg-[#F6F7F8] dark:bg-[#1A221F] p-4 flex items-center justify-between hover:bg-[#ECFDF5] dark:hover:bg-[#1F2D27] transition-colors"
        >
          <div>
            <p className="text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF]">Drafts</p>
            <p className="mt-1.5 font-mono-num text-lg font-semibold text-[#111827] dark:text-[#F3F4F6]">
              {loading ? '—' : summary?.draftCount || 0}
            </p>
            <p className="mt-0.5 text-xs text-[#6B7280] dark:text-[#9CA3AF]">Ready to send</p>
          </div>
          <ArrowRight className="w-4 h-4 text-[#6B7280] dark:text-[#9CA3AF]" />
        </Link>
      </div>
    </section>
  );
}
