import type { BusinessProfile } from '../types';

export type V2FeatureKey =
  | 'invoices_quotes'
  | 'customer_claims'
  | 'web_push'
  | 'customer_statements'
  | 'csv_exports'
  | 'hide_public_branding';

/**
 * Single entitlements gate reading the business's plan (docs/V2_SPEC.md section 1).
 * During early access, returns true for all product features.
 * Public branding ("Made with Tallymark") is ON by default and controlled by entitlement.
 */
export function canUse(
  business: Pick<BusinessProfile, 'plan'> | null | undefined,
  feature: V2FeatureKey
): boolean {
  if (!business) return false;
  const plan = business.plan || 'early_access';
  if (feature === 'hide_public_branding') {
    // Small "Made with Tallymark" link stays ON by default during early access
    return plan === 'enterprise' || plan === 'white_label';
  }
  if (plan === 'early_access') {
    return true;
  }
  return true;
}

export function isInvoicesQuotesModuleEnabled(
  business: Pick<BusinessProfile, 'modulesEnabled'> | null | undefined
): boolean {
  return Boolean(business?.modulesEnabled?.invoicesQuotes);
}

export function shouldShowPublicBranding(
  business: Pick<BusinessProfile, 'plan'> | null | undefined
): boolean {
  return !canUse(business, 'hide_public_branding');
}
