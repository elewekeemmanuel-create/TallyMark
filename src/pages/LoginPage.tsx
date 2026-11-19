import React, { useEffect, useState } from 'react';
import { ArrowRight, Mail, ShieldCheck } from 'lucide-react';
import { api, setStoredSessionToken } from '../lib/api';
import { Link, useRouter } from '../lib/router';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { BusinessProfile, UserProfile } from '../shared/types';
import { TallymarkWordmark } from '../components/TallymarkLogo';

interface LoginPageProps {
  onAuthenticated: (user: UserProfile, business: BusinessProfile | null) => void;
}

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const { search, navigate } = useRouter();
  const [mode, setMode] = useState<'google' | 'magic'>('google');
  const [googleOAuthConfigured, setGoogleOAuthConfigured] = useState(false);
  const [directEmailSignInEnabled, setDirectEmailSignInEnabled] = useState(!isSupabaseConfigured);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicResult, setMagicResult] = useState<{ url: string; token: string } | null>(null);
  const [supabaseMagicSent, setSupabaseMagicSent] = useState(false);

  useEffect(() => {
    api
      .getAuthConfig()
      .then((res) => {
        setGoogleOAuthConfigured(res.googleOAuthConfigured);
        const allowDirect = res.directEmailSignInEnabled ?? !isSupabaseConfigured;
        setDirectEmailSignInEnabled(allowDirect);
        if (!res.googleOAuthConfigured && !allowDirect && !isSupabaseConfigured) {
          setMode('magic');
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(search);
    const magicToken = params.get('magicToken');
    if (magicToken) {
      setBusy(true);
      api
        .verifyMagicLink(magicToken)
        .then((res) => {
          setStoredSessionToken(res.sessionToken);
          onAuthenticated(res.user, res.business);
          navigate(res.business ? '/app' : '/onboarding', { replace: true });
        })
        .catch((err: any) => {
          setError(err?.message || 'Magic link is invalid or expired.');
          setBusy(false);
        });
    }
  }, [search, navigate, onAuthenticated]);

  const handleGoogleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isSupabaseConfigured && supabase) {
      setBusy(true);
      const { error: supaErr } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/app` },
      });
      if (supaErr) {
        setError(supaErr.message);
        setBusy(false);
      }
      return;
    }

    if (googleOAuthConfigured && !email.trim()) {
      setBusy(true);
      try {
        const { url } = await api.getGoogleAuthUrl();
        window.location.href = url;
        return;
      } catch (err: any) {
        setError(err?.message || 'Unable to start Google Sign-In');
        setBusy(false);
        return;
      }
    }

    if (!email.trim()) {
      setError('Enter your Google email address to continue.');
      return;
    }

    setBusy(true);
    try {
      const res = await api.signInWithGoogle(email.trim(), name.trim() || undefined);
      setStoredSessionToken(res.sessionToken);
      onAuthenticated(res.user, res.business);
      navigate(res.business ? '/app' : '/onboarding', { replace: true });
    } catch (err: any) {
      setError(err?.message || 'Unable to sign in');
    } finally {
      setBusy(false);
    }
  };

  const handleMagicRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMagicResult(null);
    setSupabaseMagicSent(false);
    if (!email.trim()) {
      setError('Enter your email address.');
      return;
    }
    setBusy(true);
    try {
      if (isSupabaseConfigured && supabase) {
        const { error: otpErr } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: {
            emailRedirectTo: `${window.location.origin}/app`,
            data: name.trim() ? { full_name: name.trim() } : undefined,
          },
        });
        if (otpErr) throw otpErr;
        setSupabaseMagicSent(true);
        return;
      }
      const res = await api.requestMagicLink(email.trim(), name.trim() || undefined);
      setMagicResult({ url: res.magicLinkUrl, token: res.token });
    } catch (err: any) {
      setError(err?.message || 'Unable to send magic link');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyMagicToken = async (token: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.verifyMagicLink(token);
      setStoredSessionToken(res.sessionToken);
      onAuthenticated(res.user, res.business);
      navigate(res.business ? '/app' : '/onboarding', { replace: true });
    } catch (err: any) {
      setError(err?.message || 'Magic link verification failed');
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
          <p className="label-caps text-[#064E3B] dark:text-[#10B981]">Owner Sign-In</p>
          <h1 className="mt-2 font-display text-3xl text-[#121513] dark:text-[#F4F1EA]">
            Open your receipt book
          </h1>
          <p className="mt-1.5 text-sm text-[#5C635D] dark:text-[#9BA39D]">
            Your receipts and ledger are private to your account.
          </p>

          <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-[#F3EFE6] dark:bg-[#1B231F] p-1">
            <button
              type="button"
              onClick={() => {
                setMode('google');
                setError(null);
                setMagicResult(null);
              }}
              className={`rounded-lg py-2 text-xs font-semibold transition-colors min-h-[40px] ${
                mode === 'google'
                  ? 'bg-white dark:bg-[#111714] text-[#121513] dark:text-[#F4F1EA] shadow-xs'
                  : 'text-[#5C635D] dark:text-[#9BA39D]'
              }`}
            >
              Google Sign-In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('magic');
                setError(null);
              }}
              className={`rounded-lg py-2 text-xs font-semibold transition-colors min-h-[40px] ${
                mode === 'magic'
                  ? 'bg-white dark:bg-[#111714] text-[#121513] dark:text-[#F4F1EA] shadow-xs'
                  : 'text-[#5C635D] dark:text-[#9BA39D]'
              }`}
            >
              Email Magic Link
            </button>
          </div>

          {mode === 'google' ? (
            <form onSubmit={handleGoogleSubmit} className="mt-5 space-y-4">
              {googleOAuthConfigured && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      if (isSupabaseConfigured && supabase) {
                        const { error: supaErr } = await supabase.auth.signInWithOAuth({
                          provider: 'google',
                          options: { redirectTo: `${window.location.origin}/app` },
                        });
                        if (supaErr) throw supaErr;
                        return;
                      }
                      const { url } = await api.getGoogleAuthUrl();
                      window.location.href = url;
                    } catch (err: any) {
                      setError(err?.message || 'Unable to launch Google Sign-In');
                      setBusy(false);
                    }
                  }}
                  className="w-full min-h-[48px] rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-4 py-2.5 text-sm font-semibold flex items-center justify-center gap-2.5 hover:bg-[#FAF8F3] dark:hover:bg-[#1B231F]"
                >
                  <span>Continue with Google</span>
                </button>
              )}

              {!isSupabaseConfigured && directEmailSignInEnabled && (
                <>
                  <div>
                    <label htmlFor="google-email" className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
                      Google Email Address
                    </label>
                    <input
                      id="google-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@gmail.com"
                      className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 text-sm min-h-[44px]"
                    />
                  </div>

                  <div>
                    <label htmlFor="google-name" className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
                      Your Name (optional)
                    </label>
                    <input
                      id="google-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Chinedu Okafor"
                      className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 text-sm min-h-[44px]"
                    />
                  </div>

                  {error && <p className="text-xs text-[#B91C1C] dark:text-red-400">{error}</p>}

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full min-h-[48px] rounded-xl bg-[#064E3B] text-white text-sm font-semibold hover:bg-[#04392B] transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    <span>{busy ? 'Signing in…' : 'Continue with Google Account'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </>
              )}
              {!isSupabaseConfigured && !directEmailSignInEnabled && !googleOAuthConfigured && (
                <div className="rounded-xl border border-[#ECE6D8] dark:border-[#26302B] bg-[#FAF8F3] dark:bg-[#111714] p-4 text-xs text-[#5C635D] dark:text-[#9BA39D] space-y-2">
                  <p>Google OAuth is not configured on this server. Use Email Magic Link to sign in.</p>
                  <button
                    type="button"
                    onClick={() => setMode('magic')}
                    className="font-semibold text-[#064E3B] dark:text-[#10B981] hover:underline"
                  >
                    Switch to Email Magic Link
                  </button>
                </div>
              )}
              {(isSupabaseConfigured || (!directEmailSignInEnabled && googleOAuthConfigured)) && error && (
                <p className="text-xs text-[#B91C1C] dark:text-red-400">{error}</p>
              )}
            </form>
          ) : (
            <form onSubmit={handleMagicRequest} className="mt-5 space-y-4">
              <div>
                <label htmlFor="magic-email" className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
                  Email Address
                </label>
                <input
                  id="magic-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@yourbusiness.ng"
                  className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 text-sm min-h-[44px]"
                />
              </div>

              <div>
                <label htmlFor="magic-name" className="block label-caps text-[#5C635D] dark:text-[#9BA39D] mb-1.5">
                  Your Name (optional)
                </label>
                <input
                  id="magic-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Amina Bello"
                  className="w-full rounded-xl border border-[#DED6C2] dark:border-[#2B352F] bg-white dark:bg-[#111714] px-3.5 py-2.5 text-sm min-h-[44px]"
                />
              </div>

              {error && <p className="text-xs text-[#B91C1C] dark:text-red-400">{error}</p>}

              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-[48px] rounded-xl bg-[#064E3B] text-white text-sm font-semibold hover:bg-[#04392B] transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <Mail className="w-4 h-4" />
                <span>{busy ? 'Generating link…' : 'Send Magic Link'}</span>
              </button>

              {supabaseMagicSent && (
                <div className="rounded-xl border border-[#064E3B]/30 bg-[#FAF8F3] dark:bg-[#111714] p-4 text-xs text-[#121513] dark:text-[#F4F1EA]">
                  Magic link sent to <span className="font-semibold">{email}</span>. Open your inbox to sign in.
                </div>
              )}

              {magicResult && (
                <div className="rounded-xl border border-[#C9B99A] bg-[#FAF8F3] dark:bg-[#111714] p-4 space-y-3">
                  <p className="text-xs text-[#5C635D] dark:text-[#9BA39D]">
                    One-time sign-in link ready (expires in 15 minutes):
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleVerifyMagicToken(magicResult.token)}
                    className="w-full min-h-[44px] rounded-xl bg-[#121513] dark:bg-[#10B981] text-white dark:text-[#0D110F] text-xs font-semibold hover:opacity-90"
                  >
                    Verify &amp; Sign In Now
                  </button>
                </div>
              )}
            </form>
          )}

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
