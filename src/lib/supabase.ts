import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function cleanEnvValue(raw: string | undefined): string {
  if (!raw) return '';
  return raw.trim().replace(/^["']+|["']+$/g, '').trim();
}

function normalizeSupabaseOrigin(raw: string | undefined): string {
  const cleaned = cleanEnvValue(raw);
  if (!cleaned) return '';
  try {
    const parsed = new URL(cleaned);
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

export const supabase: SupabaseClient | null =
  isSupabaseConfigured
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null;
