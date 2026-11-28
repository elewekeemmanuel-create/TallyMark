import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { BusinessProfile } from '../../shared/types';
import type { BankAccount } from '../../shared/v2/types';
import { v2Api } from '../api';

export function BankAccountsSettingsCard({
  business,
  onBusinessUpdated,
}: {
  business: BusinessProfile;
  onBusinessUpdated: (biz: BusinessProfile) => void;
}) {
  const [tinRc, setTinRc] = useState(business.tinRc || '');
  const [invoicePrefix, setInvoicePrefix] = useState(business.invoicePrefix || 'INV-');
  const [quotePrefix, setQuotePrefix] = useState(business.quotePrefix || 'QUO-');
  const [defaultTermsDays, setDefaultTermsDays] = useState(
    String(business.defaultPaymentTermsDays ?? 7)
  );
  const [defaultNotes, setDefaultNotes] = useState(business.defaultInvoiceNotes || '');
  const [banks, setBanks] = useState<BankAccount[]>(business.bankAccounts || []);
  const [addingBank, setAddingBank] = useState(false);
  const [bankName, setBankName] = useState('');
  const [accountName, setAccountName] = useState(business.name);
  const [accountNumber, setAccountNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddBank = () => {
    if (!bankName.trim() || !accountName.trim() || accountNumber.trim().length < 6) {
      setError('Enter bank name, account name, and a valid account number.');
      return;
    }
    setError(null);
    const next: BankAccount = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `bank-${Date.now()}`,
      bankName: bankName.trim(),
      accountName: accountName.trim(),
      accountNumber: accountNumber.trim(),
      isDefault: banks.length === 0,
    };
    setBanks((prev) => [...prev, next]);
    setBankName('');
    setAccountNumber('');
    setAddingBank(false);
  };

  const handleRemoveBank = (id: string) => {
    setBanks((prev) => prev.filter((b) => b.id !== id));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSavedNotice(false);
    try {
      const res = await v2Api.updateBillingSettings({
        tinRc: tinRc.trim(),
        bankAccounts: banks,
        invoicePrefix: invoicePrefix.trim(),
        quotePrefix: quotePrefix.trim(),
        defaultPaymentTermsDays: Math.max(0, Math.min(365, Number.parseInt(defaultTermsDays, 10) || 7)),
        defaultInvoiceNotes: defaultNotes.trim(),
      });
      onBusinessUpdated(res.business);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    } catch (err: any) {
      setError(err?.message || 'Unable to save billing settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSave}
      className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 sm:p-6 space-y-5"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Invoices, Bank Accounts &amp; Tax ID</h2>
          <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
            Changes apply to new invoices only. Already-sent invoices keep their original snapshot.
          </p>
        </div>
        {savedNotice && (
          <span className="text-xs font-semibold text-[#064E3B] dark:text-[#6EE7B7]">Saved</span>
        )}
      </div>

      {error && <p className="text-xs text-[#B91C1C] dark:text-red-400">{error}</p>}

      {/* Bank Accounts */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold">Bank accounts shown on invoices</label>
          {!addingBank && (
            <button
              type="button"
              onClick={() => setAddingBank(true)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#064E3B] dark:text-[#6EE7B7] hover:underline"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add bank account</span>
            </button>
          )}
        </div>

        {banks.length === 0 && !addingBank && (
          <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] rounded-[10px] border border-dashed border-gray-200 dark:border-[#232D29] p-3">
            No bank account added yet. Add one here or when creating your first invoice.
          </p>
        )}

        {banks.map((b) => (
          <div
            key={b.id}
            className="flex items-center justify-between gap-3 rounded-[10px] border border-gray-200/70 dark:border-[#1F2925] bg-[#F6F7F8] dark:bg-[#111715] px-3.5 py-2.5 text-xs"
          >
            <div className="min-w-0">
              <p className="font-semibold truncate">{b.bankName}</p>
              <p className="text-[#6B7280] dark:text-[#9CA3AF] truncate">{b.accountName}</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="font-mono font-semibold">{b.accountNumber}</span>
              <button
                type="button"
                onClick={() => handleRemoveBank(b.id)}
                aria-label={`Remove ${b.bankName}`}
                className="p-1.5 rounded-lg text-[#6B7280] hover:text-[#B91C1C]"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}

        {addingBank && (
          <div className="rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] p-3.5 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <input
                type="text"
                placeholder="Bank name (e.g. GTBank)"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                className="rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3 py-2 text-xs min-h-[40px]"
              />
              <input
                type="text"
                placeholder="Account number"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                className="rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3 py-2 text-xs font-mono min-h-[40px]"
              />
              <input
                type="text"
                placeholder="Account name"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                className="rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#131917] px-3 py-2 text-xs min-h-[40px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAddBank}
                className="rounded-[10px] bg-[#064E3B] px-3.5 py-2 text-xs font-semibold text-white min-h-[36px]"
              >
                Add account
              </button>
              <button
                type="button"
                onClick={() => setAddingBank(false)}
                className="rounded-[10px] border border-gray-200 dark:border-[#232D29] px-3.5 py-2 text-xs font-medium min-h-[36px]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* TIN/RC + Prefixes + Default terms */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <label className="block space-y-1 text-xs">
          <span className="font-medium">TIN or RC Number (printed when VAT is enabled)</span>
          <input
            type="text"
            value={tinRc}
            onChange={(e) => setTinRc(e.target.value)}
            placeholder="e.g. TIN 12345678-0001"
            className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 py-2.5 text-sm font-mono min-h-[44px]"
          />
        </label>

        <label className="block space-y-1 text-xs">
          <span className="font-medium">Default payment terms (days)</span>
          <input
            type="number"
            min={0}
            max={365}
            value={defaultTermsDays}
            onChange={(e) => setDefaultTermsDays(e.target.value)}
            className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 py-2.5 text-sm font-mono min-h-[44px]"
          />
        </label>

        <label className="block space-y-1 text-xs">
          <span className="font-medium">Invoice prefix (new invoices only)</span>
          <input
            type="text"
            value={invoicePrefix}
            onChange={(e) => setInvoicePrefix(e.target.value)}
            maxLength={12}
            className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 py-2.5 text-sm font-mono min-h-[44px]"
          />
        </label>

        <label className="block space-y-1 text-xs">
          <span className="font-medium">Quote prefix (new quotes only)</span>
          <input
            type="text"
            value={quotePrefix}
            onChange={(e) => setQuotePrefix(e.target.value)}
            maxLength={12}
            className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 py-2.5 text-sm font-mono min-h-[44px]"
          />
        </label>
      </div>

      <label className="block space-y-1 text-xs">
        <span className="font-medium">Default invoice note</span>
        <textarea
          rows={2}
          value={defaultNotes}
          onChange={(e) => setDefaultNotes(e.target.value)}
          placeholder="Optional payment note shown on new invoices"
          className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F6F7F8] dark:bg-[#111715] px-3 py-2 text-xs"
        />
      </label>

      <button
        type="submit"
        disabled={saving}
        className="rounded-[10px] bg-[#064E3B] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#04392B] min-h-[44px] disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save Invoice & Bank Details'}
      </button>
    </form>
  );
}
