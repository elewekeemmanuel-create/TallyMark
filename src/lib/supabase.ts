import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function cleanEnvValue(raw: string | undefined): string {
  if (!raw) return '';
  return raw.trim().replace(/^["']+|["']+$/g, '').trim();
}

function normalizeSupabaseOrigin(raw: string | undefined): string {
  const cleaned = cleanEnvValue(raw);
  if (!cleaned) return '';
  try {
    const withProtocol = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

const supabaseUrl = normalizeSupabaseOrigin(import.meta.env.VITE_SUPABASE_URL as string | undefined);
const supabaseAnonKey = cleanEnvValue(
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)
);

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

let preferSupabaseProxy = false;

function buildProxyRequest(
  rawUrl: string,
  input: RequestInfo | URL,
  init?: RequestInit
): [string, RequestInit] {
  const pathAndQuery = rawUrl.slice(supabaseUrl.length) || '/';
  const proxyUrl = `/api/supabase${pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`}`;
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value);
    });
  }
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  return [
    proxyUrl,
    {
      ...init,
      method,
      headers,
      credentials: 'same-origin',
    },
  ];
}

async function resilientSupabaseFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const rawUrl =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  const canProxy =
    typeof window !== 'undefined' &&
    Boolean(supabaseUrl) &&
    rawUrl.startsWith(supabaseUrl);

  if (canProxy && preferSupabaseProxy) {
    const [proxyUrl, proxyInit] = buildProxyRequest(rawUrl, input, init);
    const proxyRes = await fetch(proxyUrl, proxyInit);
    const contentType = proxyRes.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return proxyRes;
    }
    preferSupabaseProxy = false;
  }

  try {
    return await fetch(input, init);
  } catch (err: any) {
    if (err?.name === 'AbortError' || init?.signal?.aborted) {
      throw err;
    }
    if (canProxy) {
      const [proxyUrl, proxyInit] = buildProxyRequest(rawUrl, input, init);
      const proxyRes = await fetch(proxyUrl, proxyInit);
      const contentType = proxyRes.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        preferSupabaseProxy = true;
        return proxyRes;
      }
    }
    throw err;
  }
}

export const supabase: SupabaseClient | null =
  isSupabaseConfigured
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          flowType: 'pkce',
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
        },
        global: {
          fetch: resilientSupabaseFetch,
        },
      })
    : null;
