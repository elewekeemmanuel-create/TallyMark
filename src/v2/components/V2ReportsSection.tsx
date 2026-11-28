import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { formatKobo } from '../../shared/money';
import type { BusinessProfile } from '../../shared/types';
import type { V2CsvExportType, V2ReportsSummary } from '../../shared/v2/types';
import { v2Api } from '../api';

interface V2ReportsSectionProps {
  business: BusinessProfile;
  dateFrom: string;
  dateTo: string;
}

export function V2ReportsSection({ business, dateFrom, dateTo }: V2ReportsSectionProps) {
  const [report, setReport] = useState<V2ReportsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<V2CsvExportType | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    v2Api
      .getV2Reports(dateFrom, dateTo)
      .then((res) => {
        if (active) setReport(res.report);
      })
      .catch((err: any) => {
        if (active) setError(err?.message || 'Unable to load invoices and quotes report');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [dateFrom, dateTo]);

  const handleExport = async (type: V2CsvExportType) => {
    setExporting(type);
    setError(null);
    try {
      await v2Api.downloadV2Csv(type, dateFrom, dateTo, business.currency);
    } catch (err: any) {
      setError(err?.message || 'Could not export CSV');
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
        Loading invoices and quotes breakdown…
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="rounded-[20px] border border-[#FCA5A5] bg-[#FEF2F2] dark:bg-[#2B1414] p-4 text-xs text-[#991B1B] dark:text-[#FCA5A5]">
        {error || 'Unable to load invoices and quotes report'}
      </div>
    );
  }

  const cur = business.currency;
  const { invoiceAgeing, quoteConversion } = report;

  return (
    <div className="space-y-4">
      {/* Sold vs Received (strictly separate, reconciled with Cash Book) */}
      <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-4 sm:p-5 space-y-3">
        <div>
          <p className="label-caps text-[#6B7280] dark:text-[#9CA3AF]">Sold vs Received</p>
          <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mt-0.5">
            Unpaid invoices count in Sold by issue date. Only confirmed money enters Received.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-[10px] border border-gray-100 dark:border-[#1F2925] bg-[#F6F7F8] dark:bg-[#111715] p-4">
            <p className="label-caps text-[#6B7280] dark:text-[#9CA3AF]">Sold (Total billed)</p>
            <p className="mt-1 font-mono-num text-2xl font-bold text-[#111827] dark:text-[#F3F4F6]">
              {formatKobo(report.soldTotalKobo, cur)}
            </p>
            <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mt-1">
              Invoiced: {formatKobo(report.invoicedSalesKobo, cur)} · Direct &amp; credit:{' '}
              {formatKobo(report.directSalesKobo, cur)}
            </p>
          </div>

          <div className="rounded-[10px] border border-[#064E3B]/25 bg-[#F6F7F8] dark:bg-[#111715] p-4">
            <p className="label-caps text-[#064E3B] dark:text-[#6EE7B7]">Received (Actual money in)</p>
            <p className="mt-1 font-mono-num text-2xl font-bold text-[#064E3B] dark:text-[#6EE7B7]">
              {formatKobo(report.receivedTotalKobo, cur)}
            </p>
            <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mt-1">
              Matches Cash Book money in · Net after expenses:{' '}
              {formatKobo(report.netCashFlowKobo, cur)}
            </p>
          </div>
        </div>
      </div>

      {/* Invoice Ageing & Quote-to-Invoice Conversion */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Invoice Ageing */}
        <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="label-caps text-[#6B7280] dark:text-[#9CA3AF]">Invoice ageing</p>
              <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mt-0.5">
                Unpaid invoices as of today (Lagos time)
              </p>
            </div>
            <p className="font-mono-num text-sm font-bold">
              {formatKobo(invoiceAgeing.totalOutstandingKobo, cur)}
            </p>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-[#1F2925] text-xs">
            {[
              {
                label: 'Not yet due',
                count: invoiceAgeing.notYetDueCount,
                kobo: invoiceAgeing.notYetDueKobo,
                warn: false,
              },
              {
                label: '1–7 days overdue',
                count: invoiceAgeing.days1To7Count,
                kobo: invoiceAgeing.days1To7Kobo,
                warn: invoiceAgeing.days1To7Kobo > 0,
              },
              {
                label: '8–30 days overdue',
                count: invoiceAgeing.days8To30Count,
                kobo: invoiceAgeing.days8To30Kobo,
                warn: invoiceAgeing.days8To30Kobo > 0,
              },
              {
                label: '30+ days overdue',
                count: invoiceAgeing.days30PlusCount,
                kobo: invoiceAgeing.days30PlusKobo,
                warn: invoiceAgeing.days30PlusKobo > 0,
              },
            ].map((row) => (
              <div key={row.label} className="py-2.5 flex items-center justify-between gap-2">
                <span>
                  {row.label}{' '}
                  <span className="text-[#6B7280] dark:text-[#9CA3AF]">({row.count})</span>
                </span>
                <span
                  className={`font-mono-num font-semibold ${
                    row.warn ? 'text-[#B91C1C] dark:text-[#FCA5A5]' : ''
                  }`}
                >
                  {formatKobo(row.kobo, cur)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Quote-to-Invoice Conversion */}
        <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="label-caps text-[#6B7280] dark:text-[#9CA3AF]">
                Quote-to-invoice conversion
              </p>
              <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mt-0.5">
                Quotes issued in selected period
              </p>
            </div>
            <p className="font-mono-num text-lg font-bold text-[#064E3B] dark:text-[#6EE7B7]">
              {quoteConversion.conversionRatePct}%
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <div className="rounded-[10px] bg-[#F6F7F8] dark:bg-[#111715] border border-gray-100 dark:border-[#1F2925] p-3">
              <p className="text-[#6B7280] dark:text-[#9CA3AF]">Quotes sent</p>
              <p className="font-mono-num text-base font-bold mt-0.5">
                {quoteConversion.quotesSent}
              </p>
              <p className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF] mt-0.5">
                {formatKobo(quoteConversion.quotedTotalKobo, cur)}
              </p>
            </div>
            <div className="rounded-[10px] bg-[#F6F7F8] dark:bg-[#111715] border border-gray-100 dark:border-[#1F2925] p-3">
              <p className="text-[#6B7280] dark:text-[#9CA3AF]">Converted to invoice</p>
              <p className="font-mono-num text-base font-bold text-[#064E3B] dark:text-[#6EE7B7] mt-0.5">
                {quoteConversion.quotesConverted}
              </p>
              <p className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF] mt-0.5">
                {formatKobo(quoteConversion.convertedTotalKobo, cur)}
              </p>
            </div>
          </div>

          <p className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
            Accepted (awaiting invoice): {quoteConversion.quotesAccepted} · Declined:{' '}
            {quoteConversion.quotesDeclined} · Expired: {quoteConversion.quotesExpired}
          </p>
        </div>
      </div>

      {/* V2 CSV Exports */}
      <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-4 sm:p-5 space-y-3">
        <div>
          <p className="label-caps text-[#6B7280] dark:text-[#9CA3AF]">
            Export Invoices, Quotes &amp; Payments (CSV)
          </p>
          <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mt-0.5">
            Spreadsheets open cleanly in Excel and Google Sheets with ₦ formatting.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { type: 'invoices', label: 'Invoices CSV' },
              { type: 'quotes', label: 'Quotes CSV' },
              { type: 'payments', label: 'Payments CSV' },
            ] as const
          ).map((btn) => (
            <button
              key={btn.type}
              type="button"
              disabled={exporting !== null}
              onClick={() => handleExport(btn.type)}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3.5 py-2 text-xs font-semibold text-[#111827] dark:text-[#F3F4F6] hover:bg-[#F4F6F8] dark:hover:bg-[#1A221F] min-h-[40px] disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5 text-[#064E3B] dark:text-[#6EE7B7]" />
              <span>{exporting === btn.type ? 'Exporting…' : btn.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
