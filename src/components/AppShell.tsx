import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  CreditCard,
  Home,
  Menu,
  Mic,
  Moon,
  Plus,
  PlusCircle,
  ReceiptText,
  Settings,
  Sun,
  Users,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import { OfflineIndicator, PWAInstallButton } from '../lib/pwa';
import { Link, useRouter } from '../lib/router';
import { useTheme } from '../lib/theme';
import type { BusinessProfile } from '../shared/types';
import { TallymarkWordmark } from './TallymarkLogo';

interface AppShellProps {
  business: BusinessProfile;
  title: string;
  children: React.ReactNode;
}

const DESKTOP_NAV = [
  { to: '/app', label: 'Home', icon: Home },
  { to: '/app/speak', label: 'Speak Your Day', icon: Mic },
  { to: '/app/cashbook', label: 'Cash Book', icon: BookOpen },
  { to: '/app/new', label: 'New Receipt', icon: PlusCircle },
  { to: '/app/quick-sale', label: 'Quick Sale', icon: Zap },
  { to: '/app/credit-sale', label: 'Credit Sale', icon: CreditCard },
  { to: '/app/receipts', label: 'Receipts', icon: ReceiptText },
  { to: '/app/debtors', label: 'Debtors & Creditors', icon: Users },
  { to: '/app/expenses', label: 'Expenses', icon: Wallet },
  { to: '/app/reports', label: 'Reports', icon: BarChart3 },
  { to: '/app/settings', label: 'Settings', icon: Settings },
] as const;

const NEW_CHOICES = [
  {
    to: '/app/speak',
    title: 'Speak Your Day',
    subtitle: 'Say what you sold, spent, or gave on credit — review before saving',
    icon: Mic,
  },
  {
    to: '/app/new',
    title: 'Issue Receipt',
    subtitle: 'Itemized receipt with PDF & WhatsApp link',
    icon: ReceiptText,
  },
  {
    to: '/app/quick-sale',
    title: 'Quick Sale',
    subtitle: '5-second sale without receipt (issue later if needed)',
    icon: Zap,
  },
  {
    to: '/app/credit-sale',
    title: 'Credit Sale (Borrowed)',
    subtitle: 'Customer buys on credit and pays later',
    icon: CreditCard,
  },
  {
    to: '/app/expenses?new=1',
    title: 'Record Expense',
    subtitle: 'Stock, transport, rent, salaries, proof photo',
    icon: Wallet,
  },
] as const;

const MORE_LINKS = [
  { to: '/app/debtors', label: 'Debtors & Creditors', subtitle: 'Track who owes & supplier bills', icon: Users },
  { to: '/app/expenses', label: 'Expenses', subtitle: 'Log & filter business spending', icon: Wallet },
  { to: '/app/reports', label: 'Reports & Exports', subtitle: 'Net summary, charts & CSV / PDF', icon: BarChart3 },
  { to: '/app/settings', label: 'Business Settings', subtitle: 'Logo, prefix, VAT, close-day reminder', icon: Settings },
] as const;

export function AppShell({ business, title, children }: AppShellProps) {
  const { pathname, navigate } = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [newSheetOpen, setNewSheetOpen] = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);

  useEffect(() => {
    if (!newSheetOpen && !moreSheetOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNewSheetOpen(false);
        setMoreSheetOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [newSheetOpen, moreSheetOpen]);

  const isActive = (to: string) => {
    if (to === '/app') return pathname === '/app' || pathname === '/app/';
    return pathname === to || pathname.startsWith(`${to}/`);
  };

  const isMoreActive =
    isActive('/app/debtors') ||
    isActive('/app/expenses') ||
    isActive('/app/reports') ||
    isActive('/app/settings');

  const go = (to: string) => {
    setNewSheetOpen(false);
    setMoreSheetOpen(false);
    navigate(to);
  };

  return (
    <div className="min-h-screen bg-[#FAF8F3] dark:bg-[#0D110F] text-[#121513] dark:text-[#F4F1EA]">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden md:fixed md:inset-y-0 md:left-0 md:flex md:w-64 md:flex-col border-r border-[#E5DEC9] dark:border-[#242D28] bg-[#F5F1E7] dark:bg-[#111714]">
        <div className="flex items-center justify-between px-5 h-16 border-b border-[#E5DEC9] dark:border-[#242D28]">
          <Link to="/app" className="rounded-lg">
            <TallymarkWordmark size="md" />
          </Link>
        </div>

        <div className="px-5 py-3.5 border-b border-[#E5DEC9] dark:border-[#242D28]">
          <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">Business</p>
          <div className="mt-1.5 flex items-center gap-2.5">
            {business.logoDataUrl ? (
              <img
                src={business.logoDataUrl}
                alt={business.name}
                referrerPolicy="no-referrer"
                className="w-8 h-8 rounded-lg object-contain border border-[#DED6C2] dark:border-[#2B352F] bg-white p-0.5 shrink-0"
              />
            ) : (
              <span
                className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-xs font-semibold text-white shrink-0"
                style={{ backgroundColor: business.brandColor || '#064E3B' }}
              >
                {business.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span className="text-sm font-semibold truncate">{business.name}</span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5" aria-label="Primary navigation">
          {DESKTOP_NAV.map((item) => {
            const active = isActive(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors min-h-[42px] ${
                  active
                    ? 'bg-[#064E3B] text-white'
                    : 'text-[#444A45] dark:text-[#B5BCB7] hover:bg-[#EAE3D3] dark:hover:bg-[#1B231F]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="whitespace-nowrap truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[#E5DEC9] dark:border-[#242D28] space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex items-center gap-2 rounded-lg border border-[#D8CEB8] dark:border-[#2C3731] bg-white dark:bg-[#1B231F] px-3 py-2 text-xs font-medium text-[#121513] dark:text-[#F4F1EA] hover:bg-[#F3EFE6] dark:hover:bg-[#232D28] min-h-[40px]"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </button>
            <PWAInstallButton compact />
          </div>
          <p className="text-[11px] text-[#5C635D] dark:text-[#9BA39D]">
            Built by Emmanuel Eleweke | Emmanuel of ZedTech
          </p>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="md:pl-64 flex flex-col min-h-screen">
        <header className="no-print sticky top-0 z-30 h-14 border-b border-[#E5DEC9] dark:border-[#242D28] bg-[#FAF8F3]/90 dark:bg-[#0D110F]/90 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/app" className="md:hidden shrink-0">
              <TallymarkWordmark size="sm" />
            </Link>
            <span className="hidden md:inline text-sm font-semibold text-[#121513] dark:text-[#F4F1EA] truncate">
              {title}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="md:hidden flex items-center gap-1.5">
              <PWAInstallButton compact />
              <button
                type="button"
                onClick={toggleTheme}
                aria-label="Toggle theme"
                className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18]"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
            <div className="hidden sm:flex items-center gap-2">
              <Link
                to="/app/quick-sale"
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#151B18] px-3 py-2 text-xs font-semibold text-[#121513] dark:text-[#F4F1EA] hover:bg-[#F3EFE6] dark:hover:bg-[#1B231F] transition-colors whitespace-nowrap min-h-[40px]"
              >
                <Zap className="w-3.5 h-3.5 text-[#064E3B] dark:text-[#10B981]" />
                <span>Quick Sale</span>
              </Link>
              {pathname !== '/app/new' && (
                <Link
                  to="/app/new"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#064E3B] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#04392B] transition-colors whitespace-nowrap min-h-[40px]"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>New Receipt</span>
                </Link>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-5 pb-24 md:pb-10 max-w-6xl w-full mx-auto">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Tab Bar (5 slots: Home, Cash Book, + New, Receipts, More) */}
      <nav
        aria-label="Mobile navigation"
        className="no-print md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[#E5DEC9] dark:border-[#242D28] bg-[#FAF8F3]/95 dark:bg-[#111714]/95 backdrop-blur-md pb-safe"
      >
        <div className="grid grid-cols-5 h-14 items-center">
          <Link
            to="/app"
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium h-full ${
              isActive('/app')
                ? 'text-[#064E3B] dark:text-[#10B981]'
                : 'text-[#5C635D] dark:text-[#9BA39D]'
            }`}
          >
            <Home className="w-5 h-5" />
            <span>Home</span>
          </Link>

          <Link
            to="/app/cashbook"
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium h-full ${
              isActive('/app/cashbook')
                ? 'text-[#064E3B] dark:text-[#10B981]'
                : 'text-[#5C635D] dark:text-[#9BA39D]'
            }`}
          >
            <BookOpen className="w-5 h-5" />
            <span>Cash Book</span>
          </Link>

          <div className="flex items-center justify-center h-full">
            <button
              type="button"
              onClick={() => {
                setMoreSheetOpen(false);
                setNewSheetOpen((v) => !v);
              }}
              aria-label="New entry"
              className="inline-flex items-center justify-center gap-1 rounded-2xl bg-[#064E3B] text-white px-3.5 h-10 text-xs font-semibold shadow-sm active:scale-95 transition-transform"
            >
              <Plus className="w-4 h-4" />
              <span>New</span>
            </button>
          </div>

          <Link
            to="/app/receipts"
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium h-full ${
              isActive('/app/receipts')
                ? 'text-[#064E3B] dark:text-[#10B981]'
                : 'text-[#5C635D] dark:text-[#9BA39D]'
            }`}
          >
            <ReceiptText className="w-5 h-5" />
            <span>Receipts</span>
          </Link>

          <button
            type="button"
            onClick={() => {
              setNewSheetOpen(false);
              setMoreSheetOpen((v) => !v);
            }}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium h-full ${
              isMoreActive || moreSheetOpen
                ? 'text-[#064E3B] dark:text-[#10B981]'
                : 'text-[#5C635D] dark:text-[#9BA39D]'
            }`}
          >
            <Menu className="w-5 h-5" />
            <span>More</span>
          </button>
        </div>
      </nav>

      {/* + New Action Sheet */}
      {newSheetOpen && (
        <div
          className="no-print md:hidden fixed inset-0 z-50 flex items-end bg-black/50 backdrop-blur-xs"
          onClick={() => setNewSheetOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Create new entry"
        >
          <div
            className="w-full rounded-t-3xl border-t border-[#E5DEC9] dark:border-[#26302B] bg-[#FAF8F3] dark:bg-[#151B18] p-5 pb-safe space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p className="font-display text-2xl">Record Entry</p>
              <button
                type="button"
                onClick={() => setNewSheetOpen(false)}
                aria-label="Close"
                className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-xl border border-[#DED6C2] dark:border-[#2B352F]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2.5">
              {NEW_CHOICES.map((c) => {
                const Icon = c.icon;
                return (
                  <button
                    key={c.to}
                    type="button"
                    onClick={() => go(c.to)}
                    className="w-full text-left rounded-2xl border border-[#E5DEC9] dark:border-[#26302B] bg-white dark:bg-[#111714] p-4 flex items-center gap-3.5 min-h-[60px] active:scale-[0.99]"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[#064E3B]/10 dark:bg-[#10B981]/15 text-[#064E3B] dark:text-[#10B981] flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#121513] dark:text-[#F4F1EA]">{c.title}</p>
                      <p className="text-xs text-[#5C635D] dark:text-[#9BA39D]">{c.subtitle}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* More Drawer Sheet */}
      {moreSheetOpen && (
        <div
          className="no-print md:hidden fixed inset-0 z-50 flex items-end bg-black/50 backdrop-blur-xs"
          onClick={() => setMoreSheetOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="More options"
        >
          <div
            className="w-full rounded-t-3xl border-t border-[#E5DEC9] dark:border-[#26302B] bg-[#FAF8F3] dark:bg-[#151B18] p-5 pb-safe space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="label-caps text-[#5C635D] dark:text-[#9BA39D]">{business.name}</p>
                <p className="font-display text-2xl">More</p>
              </div>
              <button
                type="button"
                onClick={() => setMoreSheetOpen(false)}
                aria-label="Close"
                className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-xl border border-[#DED6C2] dark:border-[#2B352F]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2.5">
              {MORE_LINKS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.to}
                    type="button"
                    onClick={() => go(item.to)}
                    className="w-full text-left rounded-2xl border border-[#E5DEC9] dark:border-[#26302B] bg-white dark:bg-[#111714] p-4 flex items-center gap-3.5 min-h-[60px]"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[#F3EFE6] dark:bg-[#1B231F] text-[#064E3B] dark:text-[#10B981] flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#121513] dark:text-[#F4F1EA]">{item.label}</p>
                      <p className="text-xs text-[#5C635D] dark:text-[#9BA39D]">{item.subtitle}</p>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="pt-2 text-center text-[11px] text-[#5C635D] dark:text-[#9BA39D]">
              Built by Emmanuel Eleweke | Emmanuel of ZedTech
            </p>
          </div>
        </div>
      )}

      <OfflineIndicator />
    </div>
  );
}
