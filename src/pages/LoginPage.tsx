import React, { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { api, setStoredSessionToken } from '../lib/api';
import { Link, useRouter } from '../lib/router';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { BusinessProfile, UserProfile } from '../shared/types';
import { TallymarkWordmark } from '../components/TallymarkLogo';

interface LoginPageProps {
  onAuthenticated: (user: UserProfile, business: BusinessProfile | null) => void;
}

function GoogleIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.55-.2-2.27H12v4.3h6.44a5.51 5.51 0 0 1-2.39 3.62v3h3.87c2.26-2.08 3.57-5.15 3.57-8.65z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.95H1.28v3.1A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.29A7.22 7.22 0 0 1 4.9 12c0-.79.14-1.56.38-2.29v-3.1H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.39l4-3.1z"
      />
      <path
        fill="#EA4335"
        d="M12 4.76c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.61l4 3.1c.95-2.84 3.6-4.95 6.72-4.95z"
      />
    </svg>
  );
}

function formatSupabaseAuthError(message: string | undefined, mode: 'signin' | 'signup'): string {
  const msg = (message || '').trim();
  const lower = msg.toLowerCase();

  if (lower.includes('invalid login credentials') || lower.includes('invalid_credentials')) {
    return 'Incorrect email or password. Please check your details and try again.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Please confirm your email address using the link sent to your inbox before signing in.';
  }
  if (
    lower.includes('already registered') ||
    lower.includes('already exists') ||
    lower.includes('user_already_exists')
  ) {
    return 'An account with this email already exists. Try signing in instead.';
  }
  if (lower.includes('password') && (lower.includes('6') || lower.includes('short') || lower.includes('weak'))) {
    return 'Password must be at least 6 characters long.';
  }
  if (lower.includes('valid email') || lower.includes('invalid email')) {
    return 'Enter a valid email address.';
  }
  if (lower.includes('access_denied') || lower.includes('cancelled')) {
    return 'Google sign-in was cancelled. You can try again or sign in with email.';
  }
  if (lower.includes('provider is not enabled')) {
    return 'Google sign-in is not enabled in your Supabase Authentication providers yet.';
  }
  if (
    lower.includes('failed to fetch') ||
    lower.includes('load failed') ||
    lower.includes('networkerror') ||
    lower.includes('fetch failed') ||
    lower.includes('network request failed')
  ) {
    return 'Could not reach the authentication server. Check your internet connection and Supabase URL configuration, then try again.';
  }
  if (lower.includes('signup is disabled') || lower.includes('signups not allowed')) {
    return 'Email sign-up is currently disabled in your Supabase Auth settings.';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'Too many attempts right now. Please wait a minute and try again.';
  }
  if (lower.includes('code verifier') || lower.includes('pkce')) {
    return 'Google sign-in expired or opened in a different window. Please tap Continue with Google again.';
  }

  return msg || (mode === 'signin' ? 'Unable to sign in right now.' : 'Unable to create your account right now.');
}

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const { navigate, search } = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleAvailable, setGoogleAvailable] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(search || '');
    const authErr = params.get('auth_error') || params.get('error_description') || params.get('error');
    if (authErr) {
      setError(formatSupabaseAuthError(authErr, 'signin'));
      window.history.replaceState({}, '', '/login');
    }
  }, [search]);

  useEffect(() => {
    if (isSupabaseConfigured) {
      setGoogleAvailable(true);
      return;
    }
    api
      .getAuthConfig()
      .then((cfg) => setGoogleAvailable(Boolean(cfg.googleOAuthConfigured)))
      .catch(() => setGoogleAvailable(false));
  }, []);

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'TALLYMARK_OAUTH_TOKENS' && isSupabaseConfigured && supabase) {
        try {
          const { error: setErr } = await supabase.auth.setSession({
            access_token: String(event.data.accessToken || ''),
            refresh_token: String(event.data.refreshToken || ''),
          });
          if (setErr) {
            setError(formatSupabaseAuthError(setErr.message, mode));
            return;
          }
          const me = await api.getMe();
          onAuthenticated(me.user, me.business);
          navigate(me.business ? '/app' : '/onboarding', { replace: true });
        } catch (err: any) {
          setError(formatSupabaseAuthError(err?.message, mode));
        } finally {
          setGoogleBusy(false);
        }
      } else if (event.data?.type === 'TALLYMARK_OAUTH_CODE' && isSupabaseConfigured && supabase) {
        try {
          const { error: exErr } = await supabase.auth.exchangeCodeForSession(
            String(event.data.code || '')
          );
          if (exErr) {
            setError(formatSupabaseAuthError(exErr.message, mode));
            return;
          }
          const me = await api.getMe();
          onAuthenticated(me.user, me.business);
          navigate(me.business ? '/app' : '/onboarding', { replace: true });
        } catch (err: any) {
          setError(formatSupabaseAuthError(err?.message, mode));
        } finally {
          setGoogleBusy(false);
        }
      } else if (event.data?.type === 'TALLYMARK_OAUTH_COMPLETE') {
        if (!event.data.ok) {
          setGoogleBusy(false);
          setError(
            formatSupabaseAuthError(
              event.data.error || 'Google sign-in did not complete.',
              mode
            )
          );
          return;
        }
        try {
          const me = await api.getMe();
          onAuthenticated(me.user, me.business);
          navigate(me.business ? '/app' : '/onboarding', { replace: true });
        } catch (err: any) {
          setError(formatSupabaseAuthError(err?.message, mode));
        } finally {
          setGoogleBusy(false);
        }
      } else if (event.data?.type === 'TALLYMARK_OAUTH_SUCCESS') {
        try {
          if (event.data.sessionToken) {
            setStoredSessionToken(event.data.sessionToken);
          }
          const me = await api.getMe();
          onAuthenticated(me.user, me.business);
          navigate(me.business ? '/app' : '/onboarding', { replace: true });
        } catch (err: any) {
          setError(formatSupabaseAuthError(err?.message, mode));
        } finally {
          setGoogleBusy(false);
        }
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [mode, navigate, onAuthenticated]);

  const switchMode = (nextMode: 'signin' | 'signup') => {
    setMode(nextMode);
    setError(null);
    setConfirmationEmail(null);
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setConfirmationEmail(null);
    setGoogleBusy(true);

    try {
      const redirectTo = `${window.location.origin}/auth/callback`;
      const isEmbeddedIframe = window.self !== window.top;

      if (isSupabaseConfigured && supabase) {
        const supa = supabase;
        if (isEmbeddedIframe) {
          const { data, error: oauthErr } = await supa.auth.signInWithOAuth({
            provider: 'google',
            options: {
              redirectTo,
              skipBrowserRedirect: true,
              queryParams: { prompt: 'select_account' },
            },
          });
          if (oauthErr || !data?.url) {
            setError(formatSupabaseAuthError(oauthErr?.message || 'Unable to start Google sign-in.', mode));
            setGoogleBusy(false);
            return;
          }
          const popup = window.open(data.url, 'tallymark_google_auth', 'width=520,height=680');
          if (!popup) {
            setError(
              'Pop-up was blocked by your browser. Allow pop-ups or open Tallymark directly in a full browser tab to sign in with Google.'
            );
            setGoogleBusy(false);
            return;
          }
          const poll = window.setInterval(async () => {
            if (!popup.closed) return;
            window.clearInterval(poll);
            try {
              const { data: sess } = await supa.auth.getSession();
              if (sess.session) {
                const me = await api.getMe();
                onAuthenticated(me.user, me.business);
                navigate(me.business ? '/app' : '/onboarding', { replace: true });
                return;
              }
            } catch {
              // ignore and reset busy state below
            }
            setGoogleBusy(false);
          }, 500);
          return;
        }

        const { error: oauthErr } = await supa.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo,
            queryParams: { prompt: 'select_account' },
          },
        });
        if (oauthErr) {
          setError(formatSupabaseAuthError(oauthErr.message, mode));
          setGoogleBusy(false);
        }
        return;
      }

      // Standalone Express Google OAuth fallback
      const { url } = await api.getGoogleAuthUrl();
      if (isEmbeddedIframe) {
        const popup = window.open(url, 'tallymark_google_auth', 'width=520,height=680');
        if (!popup) {
          setError('Pop-up was blocked. Allow pop-ups to continue with Google.');
          setGoogleBusy(false);
        }
      } else {
        window.location.assign(url);
      }
    } catch (err: any) {
      setError(formatSupabaseAuthError(err?.message, mode));
      setGoogleBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setConfirmationEmail(null);

    const trimmedEmail = email.trim();
    const trimmedName = fullName.trim();

    if (mode === 'signup' && !trimmedName) {
      setError('Enter your full name to create an account.');
      return;
    }

    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Enter a valid email address.');
      return;
    }

    if (mode === 'signup' && password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (mode === 'signin' && !password) {
      setError('Enter your password to sign in.');
      return;
    }

    setBusy(true);
    try {
      if (isSupabaseConfigured && supabase) {
        if (mode === 'signin') {
          const { error: signInErr } = await supabase.auth.signInWithPassword({
            email: trimmedEmail,
            password,
          });
          if (signInErr) {
            setError(formatSupabaseAuthError(signInErr.message, 'signin'));
            return;
          }
          const me = await api.getMe();
          onAuthenticated(me.user, me.business);
          navigate(me.business ? '/app' : '/onboarding', { replace: true });
          return;
        }

        const { data, error: signUpErr } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: {
            data: { full_name: trimmedName },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });

        if (signUpErr) {
          setError(formatSupabaseAuthError(signUpErr.message, 'signup'));
          return;
        }

        // Supabase returns a user with an empty identities array when email confirmation is on
        // and the email is already registered.
        if (data.user && !data.session && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setError('An account with this email already exists. Try signing in instead.');
          return;
        }

        if (data.session) {
          const me = await api.getMe();
          onAuthenticated(me.user, me.business);
          navigate(me.business ? '/app' : '/onboarding', { replace: true });
          return;
        }

        // Email confirmation required before signing in
        setConfirmationEmail(trimmedEmail);
        setPassword('');
        return;
      }

      // Local SQLite / Express fallback when Supabase env vars are not configured
      if (mode === 'signin') {
        const res = await api.signInWithPassword(trimmedEmail, password);
        setStoredSessionToken(res.sessionToken);
        onAuthenticated(res.user, res.business);
        navigate(res.business ? '/app' : '/onboarding', { replace: true });
      } else {
        const res = await api.signUpWithPassword(trimmedName, trimmedEmail, password);
        setStoredSessionToken(res.sessionToken);
        onAuthenticated(res.user, res.business);
        navigate(res.business ? '/app' : '/onboarding', { replace: true });
      }
    } catch (err: any) {
      setError(formatSupabaseAuthError(err?.message, mode));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F7F8] dark:bg-[#0B0F0E] text-[#111827] dark:text-[#F3F4F6] flex flex-col justify-between px-4 py-10">
      <div className="max-w-md w-full mx-auto">
        <Link to="/" className="inline-block">
          <TallymarkWordmark size="md" />
        </Link>

        <div className="mt-8 rounded-[24px] bg-white dark:bg-[#131917] p-7 sm:p-8 shadow-[0_16px_48px_-24px_rgba(17,24,39,0.12)]">
          <span className="inline-flex items-center rounded-full bg-[#ECFDF5] dark:bg-[#064E3B]/40 px-3 py-1 text-xs font-medium text-[#064E3B] dark:text-[#6EE7B7]">
            {mode === 'signin' ? 'Owner Sign-In' : 'New Account'}
          </span>
          <h1 className="mt-3 text-2xl sm:text-[28px] font-semibold tracking-[-0.025em] text-[#111827] dark:text-[#F3F4F6]">
            {mode === 'signin' ? 'Open your receipt book' : 'Create your Tallymark account'}
          </h1>
          <p className="mt-1.5 text-sm text-[#6B7280] dark:text-[#9CA3AF] leading-relaxed">
            {mode === 'signin'
              ? 'Sign in with Google or your email to access your receipts and cash book.'
              : 'Get started in one click with Google or create an account with your email.'}
          </p>

          {googleAvailable && (
            <div className="mt-6">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={busy || googleBusy}
                className="w-full min-h-[48px] rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-white dark:bg-[#1A221F] text-[#111827] dark:text-[#F3F4F6] text-sm font-semibold hover:bg-[#F6F7F8] dark:hover:bg-[#232D29] transition-colors inline-flex items-center justify-center gap-2.5 disabled:opacity-60"
              >
                {googleBusy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Connecting to Google…</span>
                  </>
                ) : (
                  <>
                    <GoogleIcon className="w-4 h-4" />
                    <span>Continue with Google</span>
                  </>
                )}
              </button>

              <div className="mt-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-gray-100 dark:bg-[#232D29]" />
                <span className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">or with email</span>
                <div className="h-px flex-1 bg-gray-100 dark:bg-[#232D29]" />
              </div>
            </div>
          )}

          <div
            role="tablist"
            aria-label="Authentication mode"
            className="mt-5 grid grid-cols-2 gap-1 rounded-[10px] bg-[#F4F6F8] dark:bg-[#1A221F] p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              onClick={() => switchMode('signin')}
              className={`rounded-[8px] py-2 text-xs font-semibold transition-colors min-h-[38px] ${
                mode === 'signin'
                  ? 'bg-white dark:bg-[#131917] text-[#111827] dark:text-[#F3F4F6] shadow-xs'
                  : 'text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              onClick={() => switchMode('signup')}
              className={`rounded-[8px] py-2 text-xs font-semibold transition-colors min-h-[38px] ${
                mode === 'signup'
                  ? 'bg-white dark:bg-[#131917] text-[#111827] dark:text-[#F3F4F6] shadow-xs'
                  : 'text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-white'
              }`}
            >
              Create Account
            </button>
          </div>

          {confirmationEmail && (
            <div
              role="status"
              className="mt-5 rounded-[14px] bg-[#ECFDF5] dark:bg-[#064E3B]/30 p-4 space-y-2.5"
            >
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[#064E3B] dark:text-[#6EE7B7] mt-0.5 shrink-0" />
                <div className="text-xs text-[#111827] dark:text-[#F3F4F6] space-y-1">
                  <p className="font-semibold">Check your email to confirm your account</p>
                  <p className="text-[#4B5563] dark:text-[#D1D5DB]">
                    We sent a confirmation link to{' '}
                    <span className="font-semibold text-[#111827] dark:text-white">
                      {confirmationEmail}
                    </span>
                    . Open your inbox and verify your email before signing in.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="text-xs font-semibold text-[#064E3B] dark:text-[#6EE7B7] hover:underline"
              >
                Back to Sign In
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
            {mode === 'signup' && (
              <div>
                <label
                  htmlFor="auth-full-name"
                  className="block text-xs font-medium text-[#4B5563] dark:text-[#D1D5DB] mb-1.5"
                >
                  Full Name
                </label>
                <input
                  id="auth-full-name"
                  type="text"
                  autoComplete="name"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Chinedu Okafor"
                  className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F9FAFB] dark:bg-[#1A221F] px-3.5 py-2.5 text-sm text-[#111827] dark:text-[#F3F4F6] focus:bg-white dark:focus:bg-[#131917] focus:outline-none focus:ring-2 focus:ring-[#064E3B]/20 focus:border-[#064E3B] min-h-[44px]"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="auth-email"
                className="block text-xs font-medium text-[#4B5563] dark:text-[#D1D5DB] mb-1.5"
              >
                Email
              </label>
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@yourbusiness.ng"
                className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F9FAFB] dark:bg-[#1A221F] px-3.5 py-2.5 text-sm text-[#111827] dark:text-[#F3F4F6] focus:bg-white dark:focus:bg-[#131917] focus:outline-none focus:ring-2 focus:ring-[#064E3B]/20 focus:border-[#064E3B] min-h-[44px]"
              />
            </div>

            <div>
              <label
                htmlFor="auth-password"
                className="block text-xs font-medium text-[#4B5563] dark:text-[#D1D5DB] mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  required
                  minLength={mode === 'signup' ? 6 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'At least 6 characters' : 'Enter your password'}
                  className="w-full rounded-[10px] border border-gray-200 dark:border-[#232D29] bg-[#F9FAFB] dark:bg-[#1A221F] pl-3.5 pr-11 py-2.5 text-sm text-[#111827] dark:text-[#F3F4F6] focus:bg-white dark:focus:bg-[#131917] focus:outline-none focus:ring-2 focus:ring-[#064E3B]/20 focus:border-[#064E3B] min-h-[44px]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 inline-flex items-center justify-center rounded-[8px] text-[#6B7280] dark:text-[#9CA3AF] hover:bg-gray-200/60 dark:hover:bg-[#232D29]"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {mode === 'signup' && (
                <p className="mt-1 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                  Minimum 6 characters.
                </p>
              )}
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-[10px] bg-[#FEF2F2] dark:bg-red-950/30 border border-red-200/80 dark:border-red-900/50 px-3.5 py-2.5 text-xs text-[#B91C1C] dark:text-red-300"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full min-h-[48px] rounded-[10px] bg-[#064E3B] text-white text-sm font-semibold hover:bg-[#04392B] active:scale-[0.99] transition-all inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{mode === 'signin' ? 'Signing in…' : 'Creating account…'}</span>
                </>
              ) : (
                <>
                  <span>{mode === 'signin' ? 'Sign In' : 'Create Account'}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-5 text-center text-xs text-[#6B7280] dark:text-[#9CA3AF]">
            {mode === 'signin' ? (
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className="hover:text-[#111827] dark:hover:text-white"
              >
                Don&apos;t have an account?{' '}
                <span className="font-semibold text-[#047857] dark:text-[#6EE7B7] underline underline-offset-2">
                  Create one
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="hover:text-[#111827] dark:hover:text-white"
              >
                Already have an account?{' '}
                <span className="font-semibold text-[#047857] dark:text-[#6EE7B7] underline underline-offset-2">
                  Sign in
                </span>
              </button>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-gray-100 dark:border-[#1F2925] flex items-center gap-2 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
            <ShieldCheck className="w-4 h-4 text-[#047857] dark:text-[#6EE7B7] shrink-0" />
            <span>Each business account is strictly isolated to its owner.</span>
          </div>
        </div>
      </div>

      <footer className="max-w-md w-full mx-auto pt-8 text-center text-xs text-[#6B7280] dark:text-[#9CA3AF]">
        Built by Emmanuel Eleweke | Emmanuel of ZedTech
      </footer>
    </div>
  );
}
