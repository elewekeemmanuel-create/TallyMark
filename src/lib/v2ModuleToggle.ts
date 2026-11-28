import { ApiError, getStoredSessionToken } from './api';
import { isSupabaseConfigured, supabase } from './supabase';
import type { BusinessProfile } from '../shared/types';
import type { CurrencyCode } from '../shared/money';

function mapRow(row: any): BusinessProfile {
  const mods = row.modules_enabled || {};
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    logoDataUrl: row.logo_data_url || null,
    signatureDataUrl: Object.prototype.hasOwnProperty.call(row, 'signature_data_url')
      ? row.signature_data_url || null
      : (() => {
          try {
            return localStorage.getItem(`tallymark_issuer_sig_${row.owner_id}`) || null;
          } catch {
            return null;
          }
        })(),
    address: row.address || '',
    phone: row.phone || '',
    email: row.email || '',
    brandColor: row.brand_color || '#064E3B',
    receiptPrefix: row.receipt_prefix || 'RCT-',
    nextSequence: Number(row.next_sequence),
    currency: (row.currency || 'NGN') as CurrencyCode,
    vatEnabled: Boolean(row.vat_enabled),
    vatMode: row.vat_mode === 'inclusive' ? 'inclusive' : 'exclusive',
    vatRateBps: Number(row.vat_rate_bps ?? 750),
    openingCashKobo: Number(row.opening_cash_kobo ?? 0),
    defaultTemplate: row.default_template || 'modern',
    closeDayReminderTime: row.close_day_reminder_time || '19:00',
    tinRc: row.tin_rc || '',
    bankAccounts: Array.isArray(row.bank_accounts) ? row.bank_accounts : [],
    modulesEnabled: {
      invoicesQuotes: Boolean(mods.invoices_quotes ?? mods.invoicesQuotes ?? false),
    },
    plan: row.plan || 'early_access',
    invoicePrefix: row.invoice_prefix || 'INV-',
    nextInvoiceSequence: Number(row.next_invoice_sequence ?? 1),
    quotePrefix: row.quote_prefix || 'QUO-',
    nextQuoteSequence: Number(row.next_quote_sequence ?? 1),
    defaultPaymentTermsDays: Number(row.default_payment_terms_days ?? 7),
    defaultInvoiceNotes: row.default_invoice_notes || '',
    v2PromoDismissed: Boolean(row.v2_promo_dismissed),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Lightweight (~1 KB) module toggle & Home card dismissal helper.
 * Kept outside src/v2/ so the V2 module remains 100% lazy-loaded when disabled.
 */
export async function toggleInvoicesQuotesModule(params: {
  enabled?: boolean;
  dismissPromo?: boolean;
}): Promise<{ business: BusinessProfile }> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc('v2_toggle_module', {
      p_enabled: params.enabled ?? null,
      p_dismiss_promo: params.dismissPromo ?? null,
    });
    if (error) {
      const msg = error.message || '';
      const isMissingRpc =
        error.code === 'PGRST202' ||
        error.code === '42883' ||
        msg.includes('Could not find the function') ||
        (msg.includes('v2_toggle_module') && msg.toLowerCase().includes('does not exist'));
      if (isMissingRpc) {
        throw new ApiError(
          'V2 database migration (005_v2_quotations_invoices.sql) has not been run in Supabase yet. Run it in Supabase SQL Editor, then reload this page.',
          500
        );
      }
      throw new ApiError(msg || 'Unable to update module setting', 400);
    }
    return { business: mapRow(data) };
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getStoredSessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch('/api/v2/settings/module', {
    method: 'PATCH',
    headers,
    credentials: 'include',
    body: JSON.stringify(params),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(json?.error || 'Unable to update module setting', res.status);
  }
  return json as { business: BusinessProfile };
}

export const CLAIMS_UPDATED_EVENT = 'tallymark:claims-updated';

export function notifyClaimsUpdated() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CLAIMS_UPDATED_EVENT));
  }
}

/**
 * Lightweight pending claims count fetcher for the AppShell badge fallback.
 * Only called when the Invoices & Quotes module is enabled.
 */
export async function getPendingClaimsBadgeCount(): Promise<number> {
  try {
    if (isSupabaseConfigured && supabase) {
      const { count, error } = await supabase
        .from('payment_claims')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'PENDING');
      if (error) return 0;
      return Number(count || 0);
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = getStoredSessionToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch('/api/v2/summary', {
      method: 'GET',
      headers,
      credentials: 'include',
    });
    if (!res.ok) return 0;
    const json = await res.json().catch(() => null);
    return Number(json?.summary?.pendingClaimsCount || 0);
  } catch {
    return 0;
  }
}
