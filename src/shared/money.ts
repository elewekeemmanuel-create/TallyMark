export const SUPPORTED_CURRENCIES = {
  NGN: { code: 'NGN', symbol: '₦', major: 'Naira', minor: 'Kobo' },
  USD: { code: 'USD', symbol: '$', major: 'Dollars', minor: 'Cents' },
  GBP: { code: 'GBP', symbol: '£', major: 'Pounds', minor: 'Pence' },
  EUR: { code: 'EUR', symbol: '€', major: 'Euros', minor: 'Cents' },
} as const;

export type CurrencyCode = keyof typeof SUPPORTED_CURRENCIES;

/**
 * Parses a decimal string like "12,500.50" into exact integer kobo without float precision drift.
 */
export function parseAmountToKobo(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return 0;
    return Math.round(input * 100);
  }
  const cleaned = input.replace(/[,₦$£€\s]/g, '').trim();
  if (!cleaned) return 0;
  const match = /^(\d+)(?:\.(\d{0,2}))?/.exec(cleaned);
  if (!match) return 0;
  const major = Number.parseInt(match[1], 10);
  const fracRaw = match[2] ?? '';
  const minor = Number.parseInt(fracRaw.padEnd(2, '0').slice(0, 2), 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return 0;
  return major * 100 + minor;
}

export function formatKobo(kobo: number, currency: CurrencyCode = 'NGN'): string {
  const safe = Number.isFinite(kobo) ? Math.round(kobo) : 0;
  const sign = safe < 0 ? '−' : '';
  const abs = Math.abs(safe);
  const major = Math.floor(abs / 100);
  const minor = abs % 100;
  const symbol = SUPPORTED_CURRENCIES[currency]?.symbol ?? '₦';
  const formattedMajor = major.toLocaleString('en-NG');
  return `${sign}${symbol}${formattedMajor}.${String(minor).padStart(2, '0')}`;
}

export function formatKoboPlainInput(kobo: number): string {
  const safe = Math.max(0, Math.round(kobo));
  const major = Math.floor(safe / 100);
  const minor = safe % 100;
  return minor === 0 ? String(major) : `${major}.${String(minor).padStart(2, '0')}`;
}

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];

function integerToWords(n: number): string {
  if (n === 0) return 'Zero';
  const chunks: number[] = [];
  let rem = Math.floor(n);
  while (rem > 0) {
    chunks.push(rem % 1000);
    rem = Math.floor(rem / 1000);
  }
  const parts: string[] = [];
  for (let i = chunks.length - 1; i >= 0; i--) {
    const c = chunks[i];
    if (c === 0) continue;
    const hundreds = Math.floor(c / 100);
    const rest = c % 100;
    const sub: string[] = [];
    if (hundreds > 0) {
      sub.push(`${ONES[hundreds]} Hundred`);
      if (rest > 0) sub.push('and');
    }
    if (rest > 0) {
      if (rest < 20) {
        sub.push(ONES[rest]);
      } else {
        const t = Math.floor(rest / 10);
        const o = rest % 10;
        sub.push(o > 0 ? `${TENS[t]}-${ONES[o]}` : TENS[t]);
      }
    }
    if (SCALES[i]) sub.push(SCALES[i]);
    parts.push(sub.join(' '));
  }
  return parts.join(', ');
}

export function koboToWords(kobo: number, currency: CurrencyCode = 'NGN'): string {
  const abs = Math.abs(Math.round(kobo));
  const major = Math.floor(abs / 100);
  const minor = abs % 100;
  const meta = SUPPORTED_CURRENCIES[currency] ?? SUPPORTED_CURRENCIES.NGN;

  if (major === 0 && minor === 0) {
    return `Zero ${meta.major} Only`;
  }

  const majorWords = `${integerToWords(major)} ${meta.major}`;
  if (minor === 0) {
    return `${majorWords} Only`;
  }
  const minorWords = `${integerToWords(minor)} ${meta.minor}`;
  if (major === 0) {
    return `${minorWords} Only`;
  }
  return `${majorWords} and ${minorWords} Only`;
}

export function getLagosDateString(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatLagosDateTime(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return String(isoOrDate);
  return new Intl.DateTimeFormat('en-NG', {
    timeZone: 'Africa/Lagos',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

export function formatLagosDateOnly(yyyyMmDd: string): string {
  const parts = yyyyMmDd.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return yyyyMmDd;
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
  return new Intl.DateTimeFormat('en-NG', {
    timeZone: 'Africa/Lagos',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

export interface CalculatedLineItem {
  description: string;
  qty: number;
  unitPriceKobo: number;
  discountKobo: number;
  grossKobo: number;
  lineTotalKobo: number;
}

export interface CalculatedReceiptTotals {
  items: CalculatedLineItem[];
  subtotalKobo: number;
  discountTotalKobo: number;
  vatKobo: number;
  totalKobo: number;
}

export function calculateReceiptTotals(
  rawItems: Array<{
    description: string;
    qty: number;
    unitPriceKobo: number;
    discountKobo?: number;
  }>,
  vatEnabled: boolean,
  vatMode: 'inclusive' | 'exclusive',
  vatRateBps: number = 750
): CalculatedReceiptTotals {
  const items: CalculatedLineItem[] = rawItems.map((item) => {
    const qtyMilli = Math.max(1, Math.round(item.qty * 1000));
    const unitPriceKobo = Math.max(0, Math.round(item.unitPriceKobo));
    const grossKobo = Math.round((qtyMilli * unitPriceKobo) / 1000);
    const discountKobo = Math.min(grossKobo, Math.max(0, Math.round(item.discountKobo ?? 0)));
    const lineTotalKobo = grossKobo - discountKobo;
    return {
      description: item.description.trim(),
      qty: qtyMilli / 1000,
      unitPriceKobo,
      discountKobo,
      grossKobo,
      lineTotalKobo,
    };
  });

  const subtotalKobo = items.reduce((sum, i) => sum + i.grossKobo, 0);
  const discountTotalKobo = items.reduce((sum, i) => sum + i.discountKobo, 0);
  const netKobo = Math.max(0, subtotalKobo - discountTotalKobo);

  let vatKobo = 0;
  let totalKobo = netKobo;
  if (vatEnabled && vatRateBps > 0 && netKobo > 0) {
    if (vatMode === 'exclusive') {
      vatKobo = Math.round((netKobo * vatRateBps) / 10000);
      totalKobo = netKobo + vatKobo;
    } else {
      vatKobo = Math.round((netKobo * vatRateBps) / (10000 + vatRateBps));
      totalKobo = netKobo;
    }
  }

  return {
    items,
    subtotalKobo,
    discountTotalKobo,
    vatKobo,
    totalKobo,
  };
}
