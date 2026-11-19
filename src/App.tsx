import React, { Component, Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { api, setStoredSessionToken } from './lib/api';
import { RouterProvider, useRouter } from './lib/router';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { ThemeProvider } from './lib/theme';
import type { BusinessProfile, UserProfile } from './shared/types';
import { AppShell } from './components/AppShell';
import { LandingPage } from './pages/LandingPage';
import { PrivacyPage, TermsPage } from './pages/LegalPages';
import { PublicReceiptPage } from './pages/PublicReceiptPage';

const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const OnboardingPage = lazy(() =>
  import('./pages/OnboardingPage').then((m) => ({ default: m.OnboardingPage }))
);
const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const NewReceiptPage = lazy(() =>
  import('./pages/NewReceiptPage').then((m) => ({ default: m.NewReceiptPage }))
);
const ReceiptsListPage = lazy(() =>
  import('./pages/ReceiptsPage').then((m) => ({ default: m.ReceiptsListPage }))
);
const ReceiptDetailPage = lazy(() =>
  import('./pages/ReceiptsPage').then((m) => ({ default: m.ReceiptDetailPage }))
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage }))
);
const CashBookPage = lazy(() =>
  import('./pages/CashBookPage').then((m) => ({ default: m.CashBookPage }))
);
const QuickSalePage = lazy(() =>
  import('./pages/QuickSalePage').then((m) => ({ default: m.QuickSalePage }))
);
const CreditSalePage = lazy(() =>
  import('./pages/CreditSalePage').then((m) => ({ default: m.CreditSalePage }))
);
const DebtorsPage = lazy(() =>
  import('./pages/DebtorsPage').then((m) => ({ default: m.DebtorsPage }))
);
const ExpensesPage = lazy(() =>
  import('./pages/ExpensesPage').then((m) => ({ default: m.ExpensesPage }))
);
const ReportsPage = lazy(() =>
  import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage }))
);
const SpeakDayPage = lazy(() =>
  import('./pages/SpeakDayPage').then((m) => ({ default: m.SpeakDayPage }))
);

function RouteLoadingFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="py-16 text-center text-xs text-[#5C635D] dark:text-[#9BA39D]"
    >
      Loading screen…
    </div>
  );
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error?.message || 'Unexpected application error' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#FAF8F3] text-[#121513] flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-[#E5DEC9] bg-white p-6 space-y-3 text-center">
            <h1 className="font-display text-3xl">Something went wrong</h1>
            <p className="text-sm text-[#5C635D]">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-2 rounded-xl bg-[#064E3B] px-5 py-2.5 text-xs font-semibold text-white"
            >
              Reload Tallymark
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function TallymarkRoutes() {
  const { pathname, navigate } = useRouter();
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [business, setBusiness] = useState<BusinessProfile | null>(null);

  const refreshMe = useCallback(async () => {
    try {
      const res = await api.getMe();
      setUser(res.user);
      setBusiness(res.business);
    } catch {
      setUser(null);
      setBusiness(null);
      setStoredSessionToken(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMe();
    if (isSupabaseConfigured && supabase) {
      const { data: sub } = supabase.auth.onAuthStateChange(() => {
        refreshMe();
      });
      return () => sub.subscription.unsubscribe();
    }
  }, [refreshMe]);

  // Public receipt route (/r/:id) works immediately even while auth loads or logged out
  const publicMatch = /^\/r\/([A-Za-z0-9_-]+)$/.exec(pathname);
  if (publicMatch) {
    return <PublicReceiptPage publicId={publicMatch[1]} />;
  }

  if (pathname === '/privacy') return <PrivacyPage />;
  if (pathname === '/terms') return <TermsPage />;
  if (pathname === '/' || pathname === '') {
    return <LandingPage isSignedIn={Boolean(user)} />;
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#FAF8F3] dark:bg-[#0D110F] flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="font-display text-3xl text-[#121513] dark:text-[#F4F1EA]">Tallymark</p>
          <p className="text-xs text-[#5C635D] dark:text-[#9BA39D]">Opening your receipt book…</p>
        </div>
      </div>
    );
  }

  if (pathname === '/login') {
    return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <LoginPage
          onAuthenticated={(nextUser, nextBiz) => {
            setUser(nextUser);
            setBusiness(nextBiz);
          }}
        />
      </Suspense>
    );
  }

  if (!user) {
    // Redirect protected routes cleanly to /login
    setTimeout(() => navigate('/login', { replace: true }), 0);
    return null;
  }

  if (pathname === '/onboarding' || !business) {
    if (business && pathname === '/onboarding') {
      setTimeout(() => navigate('/app', { replace: true }), 0);
      return null;
    }
    return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <OnboardingPage
          user={user}
          onCompleted={(nextBiz) => {
            setBusiness(nextBiz);
          }}
        />
      </Suspense>
    );
  }

  const renderInShell = (title: string, content: React.ReactNode) => (
    <AppShell business={business} title={title}>
      <Suspense fallback={<RouteLoadingFallback />}>{content}</Suspense>
    </AppShell>
  );

  const receiptDetailMatch = /^\/app\/receipts\/([A-Za-z0-9_-]+)$/.exec(pathname);
  if (receiptDetailMatch) {
    return renderInShell(
      'Receipt Details',
      <ReceiptDetailPage business={business} receiptId={receiptDetailMatch[1]} />
    );
  }

  if (pathname === '/app/new') {
    return renderInShell('New Receipt', <NewReceiptPage business={business} />);
  }

  if (pathname === '/app/speak') {
    return renderInShell('Speak Your Day', <SpeakDayPage business={business} />);
  }

  if (pathname === '/app/quick-sale') {
    return renderInShell('Quick Sale', <QuickSalePage business={business} />);
  }

  if (pathname === '/app/credit-sale') {
    return renderInShell('Credit Sale', <CreditSalePage business={business} />);
  }

  if (pathname === '/app/cashbook') {
    return renderInShell('Cash Book', <CashBookPage business={business} />);
  }

  if (pathname === '/app/debtors') {
    return renderInShell('Debtors & Creditors', <DebtorsPage business={business} />);
  }

  if (pathname === '/app/expenses') {
    return renderInShell('Expenses', <ExpensesPage business={business} />);
  }

  if (pathname === '/app/reports') {
    return renderInShell('Reports & Exports', <ReportsPage business={business} />);
  }

  if (pathname === '/app/receipts') {
    return renderInShell('Receipts', <ReceiptsListPage business={business} />);
  }

  if (pathname === '/app/settings') {
    return renderInShell(
      'Settings',
      <SettingsPage
        user={user}
        business={business}
        onBusinessUpdated={(nextBiz) => setBusiness(nextBiz)}
        onSignedOut={() => {
          setUser(null);
          setBusiness(null);
        }}
      />
    );
  }

  return renderInShell('Home', <HomePage business={business} />);
}

export default function App() {
  return (
    <AppErrorBoundary>
      <ThemeProvider>
        <RouterProvider>
          <TallymarkRoutes />
        </RouterProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  );
}
