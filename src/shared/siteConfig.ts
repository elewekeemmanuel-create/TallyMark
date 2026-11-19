// Centralized marketing configuration so pricing copy and contact details stay configurable.

const env =
  typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ? (import.meta as unknown as { env: Record<string, string | undefined> }).env
    : {};

export const SITE_CONFIG = {
  brandName: 'Tallymark',
  tagline: 'Issue the receipt. Keep the book. Know your day.',
  earlyAccessTag: 'Early access',
  trustTag: 'Your data stays yours',
  faqIsItFreeAnswer:
    (env.VITE_FAQ_PRICING_ANSWER || '').trim() ||
    'Free during early access. Everything in Tallymark — receipts, the daily cash book, debtors, expenses, and Speak Your Day — is included while we build alongside early Nigerian shop owners.',
  contactEmail: (env.VITE_CONTACT_EMAIL || '').trim() || 'hello@tallymark.ng',
  siteUrl: (env.VITE_APP_URL || '').trim() || 'https://tallymark.ng',
  creditLine: 'Built by Emmanuel Eleweke | Emmanuel of ZedTech',
} as const;
