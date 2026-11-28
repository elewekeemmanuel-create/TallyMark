import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Download,
  Edit3,
  FileText,
  MessageSquare,
  Share2,
} from 'lucide-react';
import { Link } from '../../lib/router';
import { formatKobo, formatLagosDateOnly, getLagosDateString } from '../../shared/money';
import { shiftLagosDate } from '../../shared/cashbook';
import type { BusinessProfile } from '../../shared/types';
import { buildWhatsAppUrl } from '../../shared/v2/money';
import type { CustomerStatementRecord } from '../../shared/v2/types';
import { v2Api } from '../api';
import { downloadCustomerStatementPdf, shareCustomerStatementPdf } from '../pdf';

interface CustomerDetailPageProps {
  business: BusinessProfile;
  customerId: string;
}

type DetailTab = 'statement' | 'invoices' | 'quotes' | 'payments';

export function CustomerDetailPage({ business, customerId }: CustomerDetailPageProps) {
  const todayLagos = getLagosDateString();
  const [fromDate, setFromDate] = useState(`${todayLagos.slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(todayLagos);
  const [tab, setTab] = useState<DetailTab>('statement');

  const [detail, setDetail] = useState<Awaited<ReturnType<typeof v2Api.getCustomerDetail>> | null>(null);
  const [statement, setStatement] = useState<CustomerStatementRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [stmtLoading, setStmtLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Edit customer form
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await v2Api.getCustomerDetail(customerId);
      setDetail(res);
      setEditName(res.customer.name);
      setEditPhone(res.customer.phone);
      setEditEmail(res.customer.email);
      setEditAddress(res.customer.address);
      setEditNotes(res.customer.notes);
    } catch (err: any) {
      setError(err?.message || 'Unable to load customer');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  const loadStatement = useCallback(async () => {
    if (!fromDate || !toDate || fromDate > toDate) return;
    setStmtLoading(true);
    try {
      const res = await v2Api.getCustomerStatement(customerId, fromDate, toDate);
      setStatement(res.statement);
    } catch (err: any) {
      setError(err?.message || 'Unable to build statement');
    } finally {
      setStmtLoading(false);
    }
  }, [customerId, fromDate, toDate]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    loadStatement();
  }, [loadStatement]);

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) return;
    setSavingEdit(true);
    setNotice(null);
    try {
      await v2Api.updateCustomer(customerId, {
        name: editName.trim(),
        phone: editPhone.trim(),
        email: editEmail.trim(),
        address: editAddress.trim(),
        notes: editNotes.trim(),
      });
      setEditing(false);
      setNotice('Customer details saved.');
      await Promise.all([loadDetail(), loadStatement()]);
    } catch (err: any) {
      setError(err?.message || 'Could not save customer details');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!statement) return;
    setPdfBusy(true);
    setNotice(null);
    try {
      await downloadCustomerStatementPdf(statement);
      setNotice('Statement PDF downloaded.');
    } catch (err: any) {
      setError(err?.message || 'Could not generate statement PDF');
    } finally {
      setPdfBusy(false);
    }
  };

  const handleSharePdf = async () => {
    if (!statement) return;
    setPdfBusy(true);
    setNotice(null);
    try {
      const mode = await shareCustomerStatementPdf(statement);
      setNotice(
        mode === 'shared'
          ? 'Statement PDF shared.'
          : 'Statement PDF downloaded — attach it in WhatsApp to share.'
      );
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setError(err?.message || 'Could not share statement PDF');
      }
    } finally {
      setPdfBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="py-16 text-center text-xs text-[#6B7280] dark:text-[#9CA3AF]">
        Loading customer profile…
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-8 text-center space-y-3">
        <p className="text-sm font-semibold">{error || 'Customer not found'}</p>
        <Link
          to="/app/customers"
          className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#064E3B] px-4 py-2 text-xs font-semibold text-white"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Customers</span>
        </Link>
      </div>
    );
  }

  const { customer } = detail;
  const waSummaryUrl = statement
    ? buildWhatsAppUrl(
        customer.phone,
        `Hello ${customer.name}, here is your statement summary from ${business.name} (${formatLagosDateOnly(statement.fromDate)} to ${formatLagosDateOnly(statement.toDate)}):\n` +
          `Opening balance: ${formatKobo(statement.openingBalanceKobo, business.currency)}\n` +
          `Billed: ${formatKobo(statement.periodDebitsKobo, business.currency)}\n` +
          `Payments: ${formatKobo(statement.periodPaymentsKobo, business.currency)}\n` +
          (statement.periodWriteOffsKobo > 0
            ? `Write-offs: ${formatKobo(statement.periodWriteOffsKobo, business.currency)}\n`
            : '') +
          `Closing balance: ${formatKobo(statement.closingBalanceKobo, business.currency)}`
      )
    : '#';

  return (
    <div className="space-y-5">
      <div>
        <Link
          to="/app/customers"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-[#F3F4F6]"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>All Customers</span>
        </Link>
      </div>

      {/* Customer Header Card */}
      <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-3xl text-[#111827] dark:text-[#F3F4F6]">
              {customer.name}
            </h1>
            <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mt-1">
              {[customer.phone, customer.email, customer.address].filter(Boolean).join(' · ') ||
                'No contact details saved yet'}
            </p>
            {customer.notes && (
              <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] mt-1">{customer.notes}</p>
            )}
          </div>

          <div className="text-right">
            <p className="label-caps text-[#6B7280] dark:text-[#9CA3AF]">Current balance owed</p>
            <p
              className={`font-mono-num text-2xl font-bold mt-0.5 ${
                customer.balanceOwedKobo > 0
                  ? 'text-[#B91C1C] dark:text-[#FCA5A5]'
                  : 'text-[#064E3B] dark:text-[#6EE7B7]'
              }`}
            >
              {formatKobo(customer.balanceOwedKobo, business.currency)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100 dark:border-[#1F2925]">
          <Link
            to="/app/invoices/new"
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#064E3B] px-3.5 py-2 text-xs font-semibold text-white min-h-[38px]"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>New Invoice</span>
          </Link>
          <Link
            to="/app/quotes/new"
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-gray-200 dark:border-[#232D29] px-3.5 py-2 text-xs font-semibold min-h-[38px]"
          >
            <span>New Quote</span>
          </Link>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-gray-200 dark:border-[#232D29] px-3.5 py-2 text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF] min-h-[38px]"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>{editing ? 'Cancel edit' : 'Edit details'}</span>
          </button>
        </div>

        {editing && (
          <form onSubmit={handleSaveCustomer} className="pt-3 border-t border-gray-100 dark:border-[#1F2925] grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold block mb-1">Name</label>
              <input
                type="text"
                required
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 py-2 text-xs min-h-[40px]"
              />
            </div>
            <div>
              <label className="text-xs font-semibold block mb-1">Phone</label>
              <input
                type="tel"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 py-2 text-xs min-h-[40px]"
              />
            </div>
            <div>
              <label className="text-xs font-semibold block mb-1">Email</label>
              <input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 py-2 text-xs min-h-[40px]"
              />
            </div>
            <div>
              <label className="text-xs font-semibold block mb-1">Address</label>
              <input
                type="text"
                value={editAddress}
                onChange={(e) => setEditAddress(e.target.value)}
                className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 py-2 text-xs min-h-[40px]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold block mb-1">Notes</label>
              <input
                type="text"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 py-2 text-xs min-h-[40px]"
              />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <button
                type="submit"
                disabled={savingEdit}
                className="rounded-[10px] bg-[#064E3B] px-4 py-2 text-xs font-semibold text-white min-h-[40px] disabled:opacity-60"
              >
                {savingEdit ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        )}
      </div>

      {error && (
        <div className="rounded-[10px] border border-[#FCA5A5] bg-[#FEF2F2] dark:bg-[#2B1414] px-4 py-3 text-xs text-[#991B1B] dark:text-[#FCA5A5]">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-[10px] border border-[#A7F3D0] bg-[#ECFDF5] dark:bg-[#0F291E] px-4 py-3 text-xs text-[#065F46] dark:text-[#6EE7B7]">
          {notice}
        </div>
      )}

      {/* Section Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            { id: 'statement', label: 'Statement of Account' },
            { id: 'invoices', label: `Invoices (${detail.invoices.length})` },
            { id: 'quotes', label: `Quotes (${detail.quotes.length})` },
            { id: 'payments', label: `Payments (${detail.payments.length})` },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-[10px] px-3.5 py-2 text-xs font-semibold min-h-[40px] ${
              tab === t.id
                ? 'bg-[#064E3B] text-white'
                : 'border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] text-[#374151] dark:text-[#C5CCC7]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB: STATEMENT OF ACCOUNT */}
      {tab === 'statement' && (
        <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-2.5">
              <div>
                <label className="text-[11px] font-semibold text-[#6B7280] dark:text-[#9CA3AF] block mb-1">
                  From
                </label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 py-2 text-xs min-h-[38px]"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-[#6B7280] dark:text-[#9CA3AF] block mb-1">
                  To
                </label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 py-2 text-xs min-h-[38px]"
                />
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setFromDate(`${todayLagos.slice(0, 7)}-01`);
                    setToDate(todayLagos);
                  }}
                  className="rounded-[10px] border border-gray-200 dark:border-[#232D29] px-2.5 py-2 text-[11px] font-medium min-h-[38px]"
                >
                  This month
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFromDate(shiftLagosDate(todayLagos, -90));
                    setToDate(todayLagos);
                  }}
                  className="rounded-[10px] border border-gray-200 dark:border-[#232D29] px-2.5 py-2 text-[11px] font-medium min-h-[38px]"
                >
                  90 days
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFromDate(`${todayLagos.slice(0, 4)}-01-01`);
                    setToDate(todayLagos);
                  }}
                  className="rounded-[10px] border border-gray-200 dark:border-[#232D29] px-2.5 py-2 text-[11px] font-medium min-h-[38px]"
                >
                  This year
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!statement || pdfBusy}
                onClick={handleDownloadPdf}
                className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#064E3B] px-3.5 py-2 text-xs font-semibold text-white min-h-[38px] disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{pdfBusy ? 'Building PDF…' : 'Download PDF'}</span>
              </button>
              <button
                type="button"
                disabled={!statement || pdfBusy}
                onClick={handleSharePdf}
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-gray-200 dark:border-[#232D29] px-3 py-2 text-xs font-semibold min-h-[38px] disabled:opacity-50"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Share</span>
              </button>
              <a
                href={waSummaryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-gray-200 dark:border-[#232D29] px-3 py-2 text-xs font-semibold min-h-[38px]"
              >
                <MessageSquare className="w-3.5 h-3.5 text-[#064E3B] dark:text-[#6EE7B7]" />
                <span>WhatsApp</span>
              </a>
            </div>
          </div>

          {stmtLoading || !statement ? (
            <p className="py-8 text-center text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              Calculating statement…
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="rounded-[10px] bg-[#F6F7F8] dark:bg-[#111715] border border-gray-100 dark:border-[#1F2925] p-3">
                  <p className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">Opening balance</p>
                  <p className="font-mono-num text-sm font-bold mt-0.5">
                    {formatKobo(statement.openingBalanceKobo, business.currency)}
                  </p>
                </div>
                <div className="rounded-[10px] bg-[#F6F7F8] dark:bg-[#111715] border border-gray-100 dark:border-[#1F2925] p-3">
                  <p className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">Billed</p>
                  <p className="font-mono-num text-sm font-bold mt-0.5">
                    {formatKobo(statement.periodDebitsKobo, business.currency)}
                  </p>
                </div>
                <div className="rounded-[10px] bg-[#F6F7F8] dark:bg-[#111715] border border-gray-100 dark:border-[#1F2925] p-3">
                  <p className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
                    Payments{statement.periodWriteOffsKobo > 0 ? ' & write-offs' : ''}
                  </p>
                  <p className="font-mono-num text-sm font-bold text-[#064E3B] dark:text-[#6EE7B7] mt-0.5">
                    {formatKobo(
                      statement.periodPaymentsKobo + statement.periodWriteOffsKobo,
                      business.currency
                    )}
                  </p>
                </div>
                <div className="rounded-[10px] bg-[#F6F7F8] dark:bg-[#111715] border border-[#064E3B]/30 p-3">
                  <p className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">Closing balance</p>
                  <p className="font-mono-num text-sm font-bold text-[#064E3B] dark:text-[#6EE7B7] mt-0.5">
                    {formatKobo(statement.closingBalanceKobo, business.currency)}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-gray-200/70 dark:border-[#1F2925] text-[11px] text-[#6B7280] dark:text-[#9CA3AF] uppercase">
                      <th className="py-2 pr-3 font-semibold">Date</th>
                      <th className="py-2 pr-3 font-semibold">Entry</th>
                      <th className="py-2 px-2 text-right font-semibold">Debit</th>
                      <th className="py-2 px-2 text-right font-semibold">Credit</th>
                      <th className="py-2 pl-2 text-right font-semibold">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-[#1F2925]">
                    <tr className="bg-[#F6F7F8] dark:bg-[#111715] font-semibold">
                      <td className="py-2.5 pr-3 font-mono-num text-[#6B7280] dark:text-[#9CA3AF]">
                        {statement.fromDate}
                      </td>
                      <td className="py-2.5 pr-3">Opening balance brought forward</td>
                      <td className="py-2.5 px-2 text-right font-mono-num">—</td>
                      <td className="py-2.5 px-2 text-right font-mono-num">—</td>
                      <td className="py-2.5 pl-2 text-right font-mono-num">
                        {formatKobo(statement.openingBalanceKobo, business.currency)}
                      </td>
                    </tr>
                    {statement.lines.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="py-6 text-center text-[#6B7280] dark:text-[#9CA3AF]"
                        >
                          No transactions in this date range.
                        </td>
                      </tr>
                    ) : (
                      statement.lines.map((line) => (
                        <tr key={line.id}>
                          <td className="py-2.5 pr-3 font-mono-num whitespace-nowrap text-[#6B7280] dark:text-[#9CA3AF]">
                            {line.date}
                          </td>
                          <td className="py-2.5 pr-3">
                            <span
                              className={
                                line.kind === 'WRITE_OFF'
                                  ? 'font-medium text-[#6B7280] dark:text-[#9CA3AF]'
                                  : ''
                              }
                            >
                              {line.description}
                            </span>
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono-num whitespace-nowrap">
                            {line.debitKobo > 0
                              ? formatKobo(line.debitKobo, business.currency)
                              : '—'}
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono-num whitespace-nowrap text-[#064E3B] dark:text-[#6EE7B7]">
                            {line.creditKobo > 0
                              ? formatKobo(line.creditKobo, business.currency)
                              : '—'}
                          </td>
                          <td className="py-2.5 pl-2 text-right font-mono-num font-semibold whitespace-nowrap">
                            {formatKobo(line.runningBalanceKobo, business.currency)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB: INVOICES */}
      {tab === 'invoices' && (
        <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] divide-y divide-gray-100 dark:divide-[#1F2925]">
          {detail.invoices.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              No invoices for this customer yet.
            </div>
          ) : (
            detail.invoices.map((inv) => (
              <Link
                key={inv.id}
                to={`/app/invoices/${inv.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[#F6F7F8] dark:hover:bg-[#1A221F]"
              >
                <div>
                  <p className="text-sm font-semibold">{inv.invoiceNumber || 'Draft Invoice'}</p>
                  <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                    Issued {formatLagosDateOnly(inv.issueDate)} · Due {formatLagosDateOnly(inv.dueDate)} · {inv.status}
                  </p>
                </div>
                <div className="text-right font-mono-num">
                  <p className="text-sm font-bold">{formatKobo(inv.totalKobo, inv.currency)}</p>
                  {inv.balanceDueKobo > 0 && (
                    <p className="text-[11px] text-[#B91C1C] dark:text-[#FCA5A5]">
                      Left: {formatKobo(inv.balanceDueKobo, inv.currency)}
                    </p>
                  )}
                </div>
              </Link>
            ))
          )}
        </div>
      )}

      {/* TAB: QUOTES */}
      {tab === 'quotes' && (
        <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] divide-y divide-gray-100 dark:divide-[#1F2925]">
          {detail.quotes.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              No quotes for this customer yet.
            </div>
          ) : (
            detail.quotes.map((q) => (
              <Link
                key={q.id}
                to={`/app/quotes/${q.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[#F6F7F8] dark:hover:bg-[#1A221F]"
              >
                <div>
                  <p className="text-sm font-semibold">{q.quoteNumber || 'Draft Quote'}</p>
                  <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                    Issued {formatLagosDateOnly(q.issueDate)} · Valid until {formatLagosDateOnly(q.validUntil)} ·{' '}
                    {q.isExpired ? 'EXPIRED' : q.status}
                  </p>
                </div>
                <p className="font-mono-num text-sm font-bold">
                  {formatKobo(q.totalKobo, q.currency)}
                </p>
              </Link>
            ))
          )}
        </div>
      )}

      {/* TAB: PAYMENTS */}
      {tab === 'payments' && (
        <div className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] divide-y divide-gray-100 dark:divide-[#1F2925]">
          {detail.payments.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              No payments recorded for this customer yet.
            </div>
          ) : (
            detail.payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">
                    {p.receiptNumber || 'Payment'} · {p.paymentMethod}
                    {p.isVoided ? ' (VOID)' : ''}
                  </p>
                  <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                    {formatLagosDateOnly(p.paymentDate)}
                    {p.debtReference ? ` · For ${p.debtReference}` : ''}
                    {p.reference ? ` · Ref: ${p.reference}` : ''}
                  </p>
                </div>
                <p
                  className={`font-mono-num text-sm font-bold ${
                    p.isVoided
                      ? 'line-through text-[#6B7280]'
                      : 'text-[#064E3B] dark:text-[#6EE7B7]'
                  }`}
                >
                  {formatKobo(p.amountKobo, business.currency)}
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
