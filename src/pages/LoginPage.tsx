import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { api, setStoredSessionToken } from '../lib/api';
import { Link, useRouter } from '../lib/router';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { BusinessProfile, UserProfile } from '../shared/types';
import { TallymarkWordmark } from '../components/TallymarkLogo';

interface LoginPageProps {
  onAuthenticated: (user: UserProfile, business: BusinessProfile | null) => void;
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

  return msg || (mode === 'signin' ? 'Unable to sign in right now.' : 'Unable to create your account right now.');
}

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const { navigate } = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);

  const switchMode = (nextMode: 'signin' | 'signup') => {
    setMode(nextMode);
    setError(null);
    setConfirmationEmail(null);
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
          navigate('/app', { replace: true });
          return;
        }

        const { data, error: signUpErr } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: {
            data: { full_name: trimmedName },
            emailRedirectTo: `${window.location.origin}/app`,
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
          navigate('/app', { replace: true });
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
        navigate('/app', { replace: true });
      } else {
        const res = await api.signUpWithPassword(trimmedName, trimmedEmail, password);
        setStoredSessionToken(res.sessionToken);
        onAuthenticated(res.user, res.business);
        navigate('/app', { replace: true });
      }
    } catch (err: any) {
      setError(formatSupabaseAuthError(err?.message, mode));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF8F3] dark:bg-[#0D110F] text-[#121513] dark:text-[#F4F1EA] flex flex-col justify-between px-4 py-8">
      <div className="max-w-md w-full mx-auto">
        <Link to="/" className="inline-block">
          <TallymarkWordmark size="md" />
        </Link>

        <div className="mt-8 rounded-2xl border border-[#E5DEC9] dark:border-[#26302B] bg-white dark:bg-[#151B18] p-6 sm:p-8 shadow-sm">
          <p className="label-caps text-[#064E3B] dark:text-[#10B981]">
            {mode === 'signin' ? 'Owner Sign-In' : 'New Account'}
          </p>
          <h1 className="mt-2 font-display text-3xl text-[#121513] dark:text-[#F4F1EA]">
            {mode === 'signin' ? 'Open your receipt book' : 'Create your Tallymark account'}
          </h1>
          <p className="mt-1.5 text-sm text-[#5C635D] dark:text-[#9BA39D]">
            {mode === 'signin'
              ? 'Sign in with your email and password to access your receipts and cash book.'
              : 'Set up your private account to issue receipts and keep your daily cash book.'}
          </p>

          <div
            role="tablist"
            aria-label="Authentication mode"
            className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-[#F3EFE6] dark:bg-[#1B231F] p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              onClick={() => switchMode('signin')}
              className={`rounded-lg py-2 text-xs font-semibold transition-colors min-h-[40px] ${
                mode === 'signin'
                  ? 'bg-white dark:bg-[#111714] text-[#121513] dark:text-[#F4F1EA] shadow-xs'
                  : 'text-[#5C635D] dark:text-[#9BA39D] hover:text-[#121513] dark:hover:text-[#F4F1EA]'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              onClick={() => switchMode('signup')}
              className={`rounded-lg py-2 text-xs font-semibold transition-colors min-h-[40px] ${
                mode === 'signup'
                  ? 'bg-white dark:bg-[#111714] text-[#121513] dark:text-[#F4F1EA] shadow-xs'
                  : 'text-[#5C635D] dark:text-[#9BA39D] hover:text-[#121513] dark:hover:text-[#F4F1EA]'
              }`}
            >
              Create Account
            </button>
          </div>

          {confirmationEmail && (
            <div
              role="status"
              className="mt-5 rounded-xl border border-[#064E3B]/30 dark:border-[#10B981]/30 bg-[#064E3B]/5 dark:bg-[#10B981]/10 p-4 space-y-2.5"
            >
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[#064E3B] dark:text-[#10B981] mt-0.5 shrink-0" />
                <div className="text-xs text-[#121513] dark:text-[#F4F1EA] space-y-1">
                  <p className="font-semibold">Check your email to confirm your account</p>
                  <p className="text-[#5C635D] dark:text-[#9BA39D]">
                    We sent a confirmation link to{' '}
                    <span className="font-semibold text-[#121513] dark:text-[#F4F1EA]">
                      {confirmationEmail}
                    </span>
                    . Open your inbox and verify your email before signing in.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="text-xs font-semibold text-[#064E3B] dark:text-[#10B981] hover:underline"
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
                  className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5"
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
                  className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 text-sm min-h-[44px]"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="auth-email"
                className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5"
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
                className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 text-sm min-h-[44px]"
              />
            </div>

            <div>
              <label
                htmlFor="auth-password"
                className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5"
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
                  className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] pl-3.5 pr-11 py-2.5 text-sm min-h-[44px]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 inline-flex items-center justify-center rounded-lg text-[#5C635D] dark:text-[#9BA39D] hover:bg-[#F3EFE6] dark:hover:bg-[#1B231F]"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {mode === 'signup' && (
                <p className="mt-1 text-[11px] text-[#5C635D] dark:text-[#9BA39D]">
                  Minimum 6 characters.
                </p>
              )}
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-[#B91C1C]/30 bg-[#B91C1C]/5 dark:bg-red-950/30 px-3.5 py-2.5 text-xs text-[#B91C1C] dark:text-red-300"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full min-h-[48px] rounded-xl bg-[#064E3B] text-white text-sm font-semibold hover:bg-[#04392B] transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-60"
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

          <div className="mt-5 text-center text-xs text-[#5C635D] dark:text-[#9BA39D]">
            {mode === 'signin' ? (
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className="hover:text-[#121513] dark:hover:text-[#F4F1EA]"
              >
                Don&apos;t have an account?{' '}
                <span className="font-semibold text-[#064E3B] dark:text-[#10B981] underline underline-offset-2">
                  Create one
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="hover:text-[#121513] dark:hover:text-[#F4F1EA]"
              >
                Already have an account?{' '}
                <span className="font-semibold text-[#064E3B] dark:text-[#10B981] underline underline-offset-2">
                  Sign in
                </span>
              </button>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-[#ECE6D8] dark:border-[#26302B] flex items-center gap-2 text-xs text-[#5C635D] dark:text-[#9BA39D]">
            <ShieldCheck className="w-4 h-4 text-[#064E3B] dark:text-[#10B981] shrink-0" />
            <span>Each business account is strictly isolated to its owner.</span>
          </div>
        </div>
      </div>

      <footer className="max-w-md w-full mx-auto pt-8 text-center text-xs text-[#5C635D] dark:text-[#9BA39D]">
        Built by Emmanuel Eleweke | Emmanuel of ZedTech
      </footer>
    </div>
  );
}
