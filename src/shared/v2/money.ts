import { getLagosDateString } from '../money';
import { shiftLagosDate } from '../cashbook';

/**
 * Exact BigInt round-half-up division for non-negative numerators and positive denominators.
 * Ties (remainder * 2 === denominator) always round UP.
 */
export function roundHalfUpDiv(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) {
    throw new Error('Denominator must be positive');
  }
  if (numerator <= 0n) return 0;
  const q = numerator / denominator;
  const r = numerator % denominator;
  const rounded = r * 2n >= denominator ? q + 1n : q;
  return Number(rounded);
}

/**
 * Parses a decimal quantity string or number (up to 3 decimals) into exact integer thousandths.
 * Examples: "1" -> 1000, "2.5" -> 2500, "0.125" -> 125, "1.2345" -> 1235 (round half up).
 */
export function parseQtyToThousandths(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) return 0;
    return Math.round(input * 1000);
  }
  const cleaned = input.replace(/[,\s]/g, '').trim();
  if (!cleaned) return 0;
  const match = /^(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return 0;
  const whole = Number.parseInt(match[1], 10);
  const frac = match[2] ?? '';
  if (!Number.isFinite(whole)) return 0;
  if (frac.length <= 3) {
    const fracVal = Number.parseInt(frac.padEnd(3, '0'), 10) || 0;
    return whole * 1000 + fracVal;
  }
  const first3 = Number.parseInt(frac.slice(0, 3), 10) || 0;
  const fourthDigit = Number.parseInt(frac[3], 10) || 0;
  return whole * 1000 + first3 + (fourthDigit >= 5 ? 1 : 0);
}

/**
 * Formats integer thousandths cleanly without trailing zeros (e.g., 1000 -> "1", 2500 -> "2.5", 125 -> "0.125").
 */
export function formatQtyThousandths(qtyThousandths: number): string {
  const safe = Math.max(0, Math.round(qtyThousandths));
  const whole = Math.floor(safe / 1000);
  const rem = safe % 1000;
  if (rem === 0) return String(whole);
  const frac = String(rem).padStart(3, '0').replace(/0+$/, '');
  return `${whole}.${frac}`;
}

export type PaymentTermsKind = 'due_on_receipt' | 'net_7' | 'net_14' | 'net_30' | 'custom';
export type DepositType = 'none' | 'percent' | 'fixed';

export function computeDueDate(
  issueDate: string,
  termsKind: PaymentTermsKind,
  customDueDate?: string | null
): string {
  switch (termsKind) {
    case 'due_on_receipt':
      return issueDate;
    case 'net_7':
      return shiftLagosDate(issueDate, 7);
    case 'net_14':
      return shiftLagosDate(issueDate, 14);
    case 'net_30':
      return shiftLagosDate(issueDate, 30);
    case 'custom':
      return customDueDate && /^\d{4}-\d{2}-\d{2}$/.test(customDueDate) ? customDueDate : issueDate;
  }
}

export function formatTermsLabel(termsKind: PaymentTermsKind, dueDate?: string): string {
  switch (termsKind) {
    case 'due_on_receipt':
      return 'Due on receipt';
    case 'net_7':
      return '7 days';
    case 'net_14':
      return '14 days';
    case 'net_30':
      return '30 days';
    case 'custom':
      return dueDate ? `Custom (${dueDate})` : 'Custom date';
  }
}

/**
 * Overdue is strictly computed from due_date at 23:59:59 Africa/Lagos — never stored by hand.
 * Since Lagos calendar date rolls over at 00:00:00 WAT (23:00:00 UTC), any date strictly
 * after dueDate in Africa/Lagos means dueDate 23:59:59 Africa/Lagos has passed.
 */
export function isInvoiceOverdue(
  status: string,
  dueDate: string,
  balanceDueKobo: number,
  now: Date = new Date()
): boolean {
  if (balanceDueKobo <= 0) return false;
  if (status !== 'SENT' && status !== 'PART_PAID') return false;
  const todayLagos = getLagosDateString(now);
  return todayLagos > dueDate;
}

/**
 * Default quotation validity is 14 calendar days from issueDate (Africa/Lagos).
 */
export function computeValidUntilDate(issueDate: string, validityDays = 14): string {
  const safeDays = Math.max(0, Math.min(365, Math.round(validityDays)));
  return shiftLagosDate(issueDate, safeDays);
}

/**
 * Quote expiry is strictly computed from valid_until at 23:59:59 Africa/Lagos — never stored by hand.
 * Only an undecided SENT quote can be expired; ACCEPTED, DECLINED, CONVERTED, VOID, and DRAFT are never expired.
 */
export function isQuoteExpired(
  status: string,
  validUntil: string,
  now: Date = new Date()
): boolean {
  if (status !== 'SENT') return false;
  const todayLagos = getLagosDateString(now);
  return todayLagos > validUntil;
}

export interface V2LineInput {
  description: string;
  qtyThousandths: number;
  unitPriceKobo: number;
  discountKobo?: number;
}

export interface CalculatedV2Line {
  description: string;
  qtyThousandths: number;
  unitPriceKobo: number;
  discountKobo: number;
  grossKobo: number;
  lineTotalKobo: number;
}

export interface CalculatedV2Totals {
  lines: CalculatedV2Line[];
  subtotalKobo: number;
  lineDiscountTotalKobo: number;
  linesNetSubtotalKobo: number;
  invoiceDiscountKobo: number;
  taxableKobo: number;
  vatKobo: number;
  totalKobo: number;
  depositType: DepositType;
  depositValue: number;
  amountDueNowKobo: number;
}

/**
 * V2 Accounting Rules (docs/V2_SPEC.md section 2):
 * - Quantities stored as integer thousandths (up to 3 decimals).
 * - Line gross = round-half-up(qtyThousandths * unitPriceKobo / 1000).
 * - Line total = gross - lineDiscount (clamped >= 0).
 * - Invoice discount applies BEFORE VAT.
 * - Exclusive VAT = round-half-up(taxable * vatRateBps / 10000); total = taxable + vat.
 * - Inclusive VAT = round-half-up(gross * vatRateBps / (10000 + vatRateBps)); total = gross.
 * - Totals are sums of rounded parts.
 */
export function calculateV2DocumentTotals(params: {
  lines: V2LineInput[];
  invoiceDiscountKobo?: number;
  vatEnabled: boolean;
  vatMode: 'inclusive' | 'exclusive';
  vatRateBps?: number;
  depositType?: DepositType;
  depositValue?: number;
}): CalculatedV2Totals {
  const vatRateBps = Math.max(0, Math.round(params.vatRateBps ?? 750));

  const lines: CalculatedV2Line[] = params.lines.map((line) => {
    const qtyThousandths = Math.max(1, Math.round(line.qtyThousandths));
    const unitPriceKobo = Math.max(0, Math.round(line.unitPriceKobo));
    const grossKobo = roundHalfUpDiv(BigInt(qtyThousandths) * BigInt(unitPriceKobo), 1000n);
    const discountKobo = Math.min(grossKobo, Math.max(0, Math.round(line.discountKobo ?? 0)));
    const lineTotalKobo = grossKobo - discountKobo;
    return {
      description: line.description.trim(),
      qtyThousandths,
      unitPriceKobo,
      discountKobo,
      grossKobo,
      lineTotalKobo,
    };
  });

  const subtotalKobo = lines.reduce((sum, l) => sum + l.grossKobo, 0);
  const lineDiscountTotalKobo = lines.reduce((sum, l) => sum + l.discountKobo, 0);
  const linesNetSubtotalKobo = lines.reduce((sum, l) => sum + l.lineTotalKobo, 0);

  const invoiceDiscountKobo = Math.min(
    linesNetSubtotalKobo,
    Math.max(0, Math.round(params.invoiceDiscountKobo ?? 0))
  );
  const taxableKobo = Math.max(0, linesNetSubtotalKobo - invoiceDiscountKobo);

  let vatKobo = 0;
  let totalKobo = taxableKobo;

  if (params.vatEnabled && vatRateBps > 0 && taxableKobo > 0) {
    if (params.vatMode === 'exclusive') {
      vatKobo = roundHalfUpDiv(BigInt(taxableKobo) * BigInt(vatRateBps), 10000n);
      totalKobo = taxableKobo + vatKobo;
    } else {
      vatKobo = roundHalfUpDiv(BigInt(taxableKobo) * BigInt(vatRateBps), BigInt(10000 + vatRateBps));
      totalKobo = taxableKobo;
    }
  }

  let depositType: DepositType = params.depositType ?? 'none';
  let depositValue = Math.max(0, Math.round(params.depositValue ?? 0));
  let amountDueNowKobo = totalKobo;

  if (depositType === 'percent') {
    depositValue = Math.min(10000, depositValue); // stored as basis points (e.g. 5000 = 50%)
    amountDueNowKobo = roundHalfUpDiv(BigInt(totalKobo) * BigInt(depositValue), 10000n);
  } else if (depositType === 'fixed') {
    depositValue = Math.min(totalKobo, depositValue);
    amountDueNowKobo = depositValue;
  } else {
    depositType = 'none';
    depositValue = 0;
    amountDueNowKobo = totalKobo;
  }

  return {
    lines,
    subtotalKobo,
    lineDiscountTotalKobo,
    linesNetSubtotalKobo,
    invoiceDiscountKobo,
    taxableKobo,
    vatKobo,
    totalKobo,
    depositType,
    depositValue,
    amountDueNowKobo,
  };
}

/**
 * Protects exported CSV cells against Excel/Sheets formula injection.
 */
export function sanitizeCsvCell(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/^[=+\-@\t\r]/.test(s)) {
    return `'${s}`;
  }
  return s;
}
