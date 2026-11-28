import React, { Suspense, lazy, useState } from 'react';
import { Download, FileText, LogOut, Moon, Sun, Trash2 } from 'lucide-react';
import { api, setStoredSessionToken } from '../lib/api';
import { PWAInstallButton } from '../lib/pwa';
import { useRouter } from '../lib/router';
import { useTheme } from '../lib/theme';
import { toggleInvoicesQuotesModule } from '../lib/v2ModuleToggle';
import type { BusinessProfile, UserProfile } from '../shared/types';
import { isInvoicesQuotesModuleEnabled } from '../shared/v2/entitlements';
import { BusinessProfileForm } from '../components/BusinessProfileForm';

const BankAccountsSettingsCard = lazy(() =>
  import('../v2/components/BankAccountsSettingsCard').then((m) => ({
    default: m.BankAccountsSettingsCard,
  }))
);
const PushNotificationsCard = lazy(() =>
  import('../v2/components/PushNotificationsCard').then((m) => ({
    default: m.PushNotificationsCard,
  }))
);

export function SettingsPage({
  user,
  business,
  onBusinessUpdated,
  onSignedOut,
}: {
  user: UserProfile;
  business: BusinessProfile;
  onBusinessUpdated: (biz: BusinessProfile) => void;
  onSignedOut: () => void;
}) {
  const { navigate } = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [savedNotice, setSavedNotice] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moduleSaving, setModuleSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const v2Enabled = isInvoicesQuotesModuleEnabled(business);

  const handleToggleV2Module = async () => {
    setModuleSaving(true);
    setError(null);
    try {
      const res = await toggleInvoicesQuotesModule({ enabled: !v2Enabled });
      onBusinessUpdated(res.business);
    } catch (err: any) {
      setError(err?.message || 'Unable to update Invoices & Quotes module');
    } finally {
      setModuleSaving(false);
    }
  };

  const handleSave = async (payload: Record<string, unknown>) => {
    setSavedNotice(false);
    const res = await api.updateBusiness(payload);
    onBusinessUpdated(res.business);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
  };

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const data = await api.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tallymark-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err: any) {
      setError(err?.message || 'Unable to export data');
    } finally {
      setExporting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setStoredSessionToken(null);
    onSignedOut();
    navigate('/login', { replace: true });
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteAccount();
      setStoredSessionToken(null);
      onSignedOut();
      navigate('/', { replace: true });
    } catch (err: any) {
      setError(err?.message || 'Unable to delete account');
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <p className="label-caps text-[#6B7280] dark:text-[#9CA3AF]">Account &amp; Business</p>
        <h1 className="mt-1 font-display text-3xl sm:text-4xl text-[#111827] dark:text-[#F3F4F6]">
          Settings
        </h1>
        <p className="mt-1 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
          Signed in as{' '}
          <strong className="text-[#111827] dark:text-[#F3F4F6]">{user.name || user.email}</strong>
          {user.name && user.name !== user.email && (
            <span className="ml-1 text-[#6B7280] dark:text-[#9CA3AF]">({user.email})</span>
          )}
        </p>
      </div>

      {/* Business Profile Editor */}
      <section className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold">Business Profile &amp; Receipt Defaults</h2>
          {savedNotice && (
            <span className="text-xs font-semibold text-[#064E3B] dark:text-[#6EE7B7]">
              Changes saved
            </span>
          )}
        </div>
        <BusinessProfileForm
          initial={business}
          defaultEmail={user.email}
          submitLabel="Save Settings"
          onSubmit={handleSave}
        />
      </section>

      {/* Optional Modules */}
      <section className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-[10px] bg-[#F4F6F8] dark:bg-[#1A221F] text-[#064E3B] dark:text-[#6EE7B7] flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Invoices &amp; Quotes</h2>
              <p className="mt-0.5 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                {v2Enabled
                  ? 'On. Turning this off hides Invoices & Quotes from navigation without deleting any saved documents.'
                  : 'Off. Turn on to send invoices, store bank transfer details, and record payments with linked receipts.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={moduleSaving}
            onClick={handleToggleV2Module}
            className={`min-h-[44px] rounded-[10px] px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-60 ${
              v2Enabled
                ? 'border border-gray-200 dark:border-[#232D29] text-[#111827] dark:text-[#F3F4F6] hover:bg-[#F4F6F8] dark:hover:bg-[#1A221F]'
                : 'bg-[#064E3B] text-white hover:bg-[#04392B]'
            }`}
          >
            {moduleSaving ? 'Updating…' : v2Enabled ? 'Turn off' : 'Turn on'}
          </button>
        </div>
      </section>

      {v2Enabled && (
        <Suspense fallback={null}>
          <BankAccountsSettingsCard business={business} onBusinessUpdated={onBusinessUpdated} />
          <PushNotificationsCard />
        </Suspense>
      )}

      {/* Appearance & App Install */}
      <section className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 sm:p-6 space-y-4">
        <h2 className="text-base font-semibold">App Preferences</h2>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Theme</p>
            <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              Switch between warm ivory paper and private-bank dark mode.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex items-center gap-2 rounded-[10px] border border-gray-200 dark:border-[#232D29] px-4 py-2 text-xs font-semibold min-h-[44px]"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            <span>{theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}</span>
          </button>
        </div>

        <div className="pt-3 border-t border-gray-100 dark:border-[#1F2925] flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Install Tallymark on this device</p>
            <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              Launch full-screen from your home screen like a native app.
            </p>
          </div>
          <PWAInstallButton />
        </div>
      </section>

      {/* Data Export, Sign Out & Delete Account */}
      <section className="rounded-[20px] border border-gray-200/70 dark:border-[#1F2925] bg-white dark:bg-[#131917] p-5 sm:p-6 space-y-4">
        <h2 className="text-base font-semibold">Data &amp; Session</h2>

        {error && <p className="text-xs text-[#B91C1C] dark:text-red-400">{error}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-2 rounded-[10px] border border-gray-200 dark:border-[#232D29] px-4 py-2.5 text-xs font-semibold min-h-[44px]"
          >
            <Download className="w-4 h-4 text-[#064E3B] dark:text-[#6EE7B7]" />
            <span>{exporting ? 'Preparing Export…' : 'Export All Data (JSON)'}</span>
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 rounded-[10px] border border-gray-200 dark:border-[#232D29] px-4 py-2.5 text-xs font-semibold min-h-[44px]"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>

        <div className="pt-4 border-t border-gray-100 dark:border-[#1F2925]">
          {!deleteConfirm ? (
            <button
              type="button"
              onClick={() => setDeleteConfirm(true)}
              className="inline-flex items-center gap-2 text-xs font-semibold text-[#B91C1C] hover:underline min-h-[40px]"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete Account &amp; Business Data</span>
            </button>
          ) : (
            <div className="rounded-[10px] border border-[#B91C1C]/30 bg-[#FEF2F2] dark:bg-red-950/30 p-4 space-y-3">
              <p className="text-xs font-medium text-[#B91C1C] dark:text-red-300">
                This permanently deletes your account, business profile, receipts, and ledger records. Export your JSON backup first if needed.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDeleteAccount}
                  disabled={deleting}
                  className="min-h-[40px] rounded-[10px] bg-[#B91C1C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#991B1B]"
                >
                  {deleting ? 'Deleting…' : 'Yes, Delete Everything'}
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(false)}
                  className="min-h-[40px] rounded-[10px] border border-gray-200 bg-white dark:bg-[#131917] px-4 py-2 text-xs font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
