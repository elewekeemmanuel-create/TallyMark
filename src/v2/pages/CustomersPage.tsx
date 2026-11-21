import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, FileText, Search, Users } from 'lucide-react';
import { Link } from '../../lib/router';
import { formatKobo } from '../../shared/money';
import type { BusinessProfile } from '../../shared/types';
import type { CustomerDirectoryItem } from '../../shared/v2/types';
import { v2Api } from '../api';

interface CustomersPageProps {
  business: BusinessProfile;
}

export function CustomersPage({ business }: CustomersPageProps) {
  const [customers, setCustomers] = useState<CustomerDirectoryItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await v2Api.getCustomers(search.trim() || undefined);
      setCustomers(res.customers);
    } catch (err: any) {
      setError(err?.message || 'Unable to load customers');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  const totalOwedKobo = customers.reduce((sum, c) => sum + c.balanceOwedKobo, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Directory</p>
          <h1 className="font-display text-3xl sm:text-4xl">Customers</h1>
        </div>
        <Link
          to="/app/invoices/new"
          className="inline-flex items-center gap-2 rounded-xl bg-[#064E3B] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#04392B] min-h-[42px]"
        >
          <FileText className="w-4 h-4" />
          <span>New Invoice</span>
        </Link>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-4">
          <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Saved customers</p>
          <p className="mt-1 font-mono-num text-2xl font-bold">{customers.length}</p>
        </div>
        <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-4">
          <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Total balance owed</p>
          <p className="mt-1 font-mono-num text-2xl font-bold text-[#064E3B] dark:text-[#10B981]">
            {formatKobo(totalOwedKobo, business.currency)}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="w-4 h-4 text-[#5C635D] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by customer name, phone, or email..."
          className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] pl-10 pr-4 py-2.5 text-sm min-h-[44px]"
        />
      </div>

      {error && (
        <div className="rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] dark:bg-[#2B1414] px-4 py-3 text-xs text-[#991B1B] dark:text-[#FCA5A5]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-8 text-center text-xs text-[#5C635D] dark:text-[#9BA39D]">
          Loading customers…
        </div>
      ) : customers.length === 0 ? (
        <div className="rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] p-8 text-center space-y-3">
          <div className="w-11 h-11 rounded-2xl bg-[#F3EFE6] dark:bg-[#1B231F] text-[#064E3B] dark:text-[#10B981] mx-auto flex items-center justify-center">
            <Users className="w-5 h-5" />
          </div>
          <p className="text-sm font-semibold">
            {search ? 'No customer matched your search' : 'No saved customers yet'}
          </p>
          <p className="text-xs text-[#5C635D] dark:text-[#9BA39D] max-w-sm mx-auto">
            {search
              ? 'Try another name or phone number.'
              : 'Customers are saved automatically when you issue an invoice, quote, or receipt.'}
          </p>
          {!search && (
            <Link
              to="/app/invoices/new"
              className="inline-flex items-center rounded-xl bg-[#064E3B] px-4 py-2.5 text-xs font-semibold text-white min-h-[40px]"
            >
              Create your first invoice
            </Link>
          )}
        </div>
      ) : (
        <div className="divide-y divide-[#EFE9DA] dark:divide-[#202924] rounded-2xl border border-[#E5DEC9] dark:border-[#242D28] bg-white dark:bg-[#151B18] overflow-hidden">
          {customers.map((c) => {
            const docSummaryParts: string[] = [];
            if (c.invoiceCount > 0) docSummaryParts.push(`${c.invoiceCount} inv`);
            if (c.quoteCount > 0) docSummaryParts.push(`${c.quoteCount} quo`);
            if (c.receiptCount > 0) docSummaryParts.push(`${c.receiptCount} rct`);
            if (c.creditSaleCount > 0) docSummaryParts.push(`${c.creditSaleCount} credit`);

            return (
              <Link
                key={c.id}
                to={`/app/customers/${c.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-[#FAF8F3] dark:hover:bg-[#1B231F] transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#121513] dark:text-[#F4F1EA] truncate">
                    {c.name}
                  </p>
                  <p className="text-xs text-[#5C635D] dark:text-[#9BA39D] truncate mt-0.5">
                    {c.phone || c.email || 'No phone saved'}
                    {docSummaryParts.length > 0 ? ` · ${docSummaryParts.join(' · ')}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  <div className="text-right">
                    <p className="text-[11px] text-[#5C635D] dark:text-[#9BA39D]">
                      {c.balanceOwedKobo > 0 ? 'Owes' : 'Settled'}
                    </p>
                    <p
                      className={`font-mono-num text-sm font-bold ${
                        c.balanceOwedKobo > 0
                          ? 'text-[#B91C1C] dark:text-[#FCA5A5]'
                          : 'text-[#064E3B] dark:text-[#10B981]'
                      }`}
                    >
                      {formatKobo(c.balanceOwedKobo, business.currency)}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#5C635D]" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
