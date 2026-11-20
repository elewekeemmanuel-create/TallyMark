import React, { Component, Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { api, setStoredSessionToken } from './lib/api';
import { RouterProvider, useRouter } from './lib/router';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { ThemeProvider } from './lib/theme';
import type { BusinessProfile, UserProfile } from './shared/types';
import { isInvoicesQuotesModuleEnabled } from './shared/v2/entitlements';
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
const DocumentsPage = lazy(() =>
  import('./v2/pages/DocumentsPage').then((m) => ({ default: m.DocumentsPage }))
);
const InvoiceEditorPage = lazy(() =>
  import('./v2/pages/InvoiceEditorPage').then((m) => ({ default: m.InvoiceEditorPage }))
);
const InvoiceDetailPage = lazy(() =>
  import('./v2/pages/InvoiceDetailPage').then((m) => ({ default: m.InvoiceDetailPage }))
);
const ClaimsReviewPage = lazy(() =>
  import('./v2/pages/ClaimsReviewPage').then((m) => ({ default: m.ClaimsReviewPage }))
);
const QuoteEditorPage = lazy(() =>
  import('./v2/pages/QuoteEditorPage').then((m) => ({ default: m.QuoteEditorPage }))
);
const QuoteDetailPage = lazy(() =>
  import('./v2/pages/QuoteDetailPage').then((m) => ({ default: m.QuoteDetailPage }))
);

function parseOAuthCallbackParams() {
  if (typeof window === 'undefined') {
    return {
      isCallbackRoute: false,
      code: null as string | null,
      accessToken: null as string | null,
      refreshToken: null as string | null,
      oauthError: null as string | null,
      hasOAuthParams: false,
    };
  }
  const pathname = window.location.pathname || '/';
  const searchParams = new URLSearchParams(window.location.search || '');
  const hashRaw = (window.location.hash || '').replace(/^#/, '');
  const hashParams = new URLSearchParams(hashRaw);

  const code = searchParams.get('code');
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  const oauthError =
    searchParams.get('error_description') ||
    hashParams.get('error_description') ||
    searchParams.get('error') ||
    hashParams.get('error');

  const isCallbackRoute = pathname === '/auth/callback' || pathname === '/auth/callback/';
  const hasOAuthParams = Boolean(code || accessToken || oauthError);

  return {
    isCallbackRoute,
    code,
    accessToken,
    refreshToken,
    oauthError,
    hasOAuthParams,
  };
}

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
  const initialOAuth = useRef(parseOAuthCallbackParams());
  const oauthHandlingRef = useRef(
    initialOAuth.current.isCallbackRoute || initialOAuth.current.hasOAuthParams
  );
  const [authLoading, setAuthLoading] = useState(true);
  const [oauthMessage, setOauthMessage] = useState<string | null>(
    oauthHandlingRef.current ? 'Completing Google sign-in…' : null
  );
  const [user, setUser] = useState<UserProfile | null>(null);
  const [business, setBusiness] = useState<BusinessProfile | null>(null);

  const refreshMe = useCallback(async () => {
    try {
      const res = await api.getMe();
      setUser(res.user);
      setBusiness(res.business);
      return res;
    } catch {
      setUser(null);
      setBusiness(null);
      setStoredSessionToken(null);
      return null;
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    const finishPopupAndClose = (ok: boolean, errorMessage?: string | null) => {
      if (typeof window !== 'undefined' && window.opener) {
        try {
          window.opener.postMessage(
            { type: 'TALLYMARK_OAUTH_COMPLETE', ok, error: errorMessage || null },
            window.location.origin
          );
        } catch {
          // ignore cross-origin postMessage errors
        }
        window.close();
        return true;
      }
      return false;
    };

    const init = async () => {
      const cb = initialOAuth.current;
      const isOAuthReturn = cb.isCallbackRoute || cb.hasOAuthParams;

      if (isSupabaseConfigured && supabase) {
        try {
          // Handle explicit OAuth error returned by Google / Supabase
          if (cb.oauthError) {
            const cleanErr = cb.oauthError.replace(/\+/g, ' ');
            if (cb.isCallbackRoute && finishPopupAndClose(false, cleanErr)) {
              return;
            }
            oauthHandlingRef.current = false;
            setOauthMessage(null);
            setAuthLoading(false);
            if (active) {
              navigate(`/login?auth_error=${encodeURIComponent(cleanErr)}`, { replace: true });
            }
            return;
          }

          // Await Supabase client initialization (which runs detectSessionInUrl for PKCE/implicit)
          let { data: sessData } = await supabase.auth.getSession();

          // Explicit fallback: exchange PKCE ?code= if detectSessionInUrl didn't already consume it
          if (!sessData.session && cb.code) {
            const { data: exData, error: exErr } = await supabase.auth.exchangeCodeForSession(cb.code);
            if (exErr) {
              const errMsg = exErr.message || 'Could not complete Google sign-in. Please try again.';
              if (cb.isCallbackRoute && finishPopupAndClose(false, errMsg)) {
                return;
              }
              oauthHandlingRef.current = false;
              setOauthMessage(null);
              setAuthLoading(false);
              if (active) {
                navigate(`/login?auth_error=${encodeURIComponent(errMsg)}`, { replace: true });
              }
              return;
            }
            sessData = { session: exData.session };
          }

          // Explicit fallback: set implicit hash tokens if present and not yet loaded
          if (!sessData.session && cb.accessToken && cb.refreshToken) {
            const { data: setSessData, error: setSessErr } = await supabase.auth.setSession({
              access_token: cb.accessToken,
              refresh_token: cb.refreshToken,
            });
            if (!setSessErr && setSessData.session) {
              sessData = { session: setSessData.session };
            }
          }

          if (isOAuthReturn) {
            if (!sessData.session) {
              const failMsg = 'Google sign-in session could not be restored. Please try again.';
              if (cb.isCallbackRoute && finishPopupAndClose(false, failMsg)) {
                return;
              }
              oauthHandlingRef.current = false;
              setOauthMessage(null);
              setAuthLoading(false);
              if (active) {
                navigate(`/login?auth_error=${encodeURIComponent(failMsg)}`, { replace: true });
              }
              return;
            }

            if (cb.isCallbackRoute && finishPopupAndClose(true, null)) {
              return;
            }

            if (active) {
              const me = await refreshMe();
              oauthHandlingRef.current = false;
              setOauthMessage(null);
              if (me) {
                navigate(me.business ? '/app' : '/onboarding', { replace: true });
              } else {
                navigate(
                  `/login?auth_error=${encodeURIComponent('Signed in with Google, but could not load your profile. Please try again.')}`,
                  { replace: true }
                );
              }
            }
            return;
          }
        } catch (err: any) {
          if (isOAuthReturn) {
            const msg = err?.message || 'Google sign-in failed. Please try again.';
            if (cb.isCallbackRoute && finishPopupAndClose(false, msg)) {
              return;
            }
            oauthHandlingRef.current = false;
            setOauthMessage(null);
            setAuthLoading(false);
            if (active) {
              navigate(`/login?auth_error=${encodeURIComponent(msg)}`, { replace: true });
            }
            return;
          }
        }
      }

      oauthHandlingRef.current = false;
      setOauthMessage(null);
      if (active) {
        await refreshMe();
      }
    };

    init();

    if (isSupabaseConfigured && supabase) {
      const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
        if (!active) return;
        // Never race with in-flight OAuth code/token exchange or premature INITIAL_SESSION(null)
        if (oauthHandlingRef.current) return;
        if (event === 'INITIAL_SESSION') return;

        if (session && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED')) {
          refreshMe();
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setBusiness(null);
          setAuthLoading(false);
        }
      });
      return () => {
        active = false;
        sub.subscription.unsubscribe();
      };
    }
    return () => {
      active = false;
    };
  }, [navigate, refreshMe]);

  // Public receipt route (/r/:id) works immediately even while auth loads or logged out
  const publicMatch = /^\/r\/([A-Za-z0-9_-]+)$/.exec(pathname);
  if (publicMatch) {
    return <PublicReceiptPage publicId={publicMatch[1]} />;
  }

  // Dedicated OAuth callback screen (or OAuth return on /) stays in loading state until exchange finishes
  if (pathname === '/auth/callback' || pathname === '/auth/callback/' || oauthHandlingRef.current) {
    return (
      <div className="min-h-screen bg-[#FAF8F3] dark:bg-[#0D110F] flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="font-display text-3xl text-[#121513] dark:text-[#F4F1EA]">Tallymark</p>
          <p className="text-xs text-[#5C635D] dark:text-[#9BA39D]">
            {oauthMessage || 'Completing sign-in…'}
          </p>
        </div>
      </div>
    );
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
    if (user) {
      setTimeout(() => navigate(business ? '/app' : '/onboarding', { replace: true }), 0);
      return null;
    }
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
    <AppShell business={business} user={user} title={title}>
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

  const v2Enabled = isInvoicesQuotesModuleEnabled(business);

  if (v2Enabled) {
    if (pathname === '/app/documents') {
      return renderInShell('Documents', <DocumentsPage business={business} />);
    }

    if (pathname === '/app/claims') {
      return renderInShell('Payment Reports', <ClaimsReviewPage business={business} />);
    }

    if (pathname === '/app/invoices/new') {
      return renderInShell(
        'New Invoice',
        <InvoiceEditorPage business={business} onBusinessUpdated={(nextBiz) => setBusiness(nextBiz)} />
      );
    }

    const invoiceEditMatch = /^\/app\/invoices\/([A-Za-z0-9_-]+)\/edit$/.exec(pathname);
    if (invoiceEditMatch) {
      return renderInShell(
        'Edit Invoice',
        <InvoiceEditorPage
          business={business}
          invoiceId={invoiceEditMatch[1]}
          onBusinessUpdated={(nextBiz) => setBusiness(nextBiz)}
        />
      );
    }

    const invoiceDetailMatch = /^\/app\/invoices\/([A-Za-z0-9_-]+)$/.exec(pathname);
    if (invoiceDetailMatch) {
      return renderInShell(
        'Invoice Details',
        <InvoiceDetailPage business={business} invoiceId={invoiceDetailMatch[1]} />
      );
    }

    if (pathname === '/app/quotes/new') {
      return renderInShell('New Quote', <QuoteEditorPage business={business} />);
    }

    const quoteEditMatch = /^\/app\/quotes\/([A-Za-z0-9_-]+)\/edit$/.exec(pathname);
    if (quoteEditMatch) {
      return renderInShell(
        'Edit Quote',
        <QuoteEditorPage business={business} quoteId={quoteEditMatch[1]} />
      );
    }

    const quoteDetailMatch = /^\/app\/quotes\/([A-Za-z0-9_-]+)$/.exec(pathname);
    if (quoteDetailMatch) {
      return renderInShell(
        'Quote Details',
        <QuoteDetailPage business={business} quoteId={quoteDetailMatch[1]} />
      );
    }
  }

  return renderInShell(
    'Home',
    <HomePage business={business} onBusinessUpdated={(nextBiz) => setBusiness(nextBiz)} />
  );
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
