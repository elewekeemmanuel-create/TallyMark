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
  if (/^[=+\-@\t\r]/.test(s) || /^[ \t]+[=+\-@]/.test(s)) {
    return `'${s}`;
  }
  return s;
}

// ============================================================================
// SLICE 4: RECEIVABLES AGEING (AFRICA/LAGOS), REMINDERS & CUSTOMER STATEMENTS
// ============================================================================

export type AgeingBucket = 'not_yet_due' | '1_7' | '8_30' | '30_plus';

function parseYmdUtcDay(ymd: string): number {
  const [y, m, d] = ymd.split('-').map((n) => Number.parseInt(n, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return 0;
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/**
 * Computes exact whole-day overdue count and ageing bucket in Africa/Lagos (WAT, UTC+1).
 * A document due on `2026-05-10` is `not_yet_due` up to `2026-05-10 23:59:59 WAT`
 * and becomes 1 day overdue (`1_7`) at `2026-05-11 00:00:00 WAT`.
 * If `dueDate` is null (e.g. legacy part-paid receipt or quick credit without due date),
 * falls back to `fallbackIssueDate`.
 */
export function computeAgeingBucket(
  dueDate: string | null | undefined,
  fallbackIssueDate: string,
  referenceNow: Date | string = new Date()
): { daysOverdue: number; bucket: AgeingBucket; effectiveDueDate: string } {
  const effectiveDueDate =
    dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : fallbackIssueDate;
  const todayLagos =
    typeof referenceNow === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(referenceNow)
      ? referenceNow
      : getLagosDateString(referenceNow instanceof Date ? referenceNow : new Date(referenceNow));

  const diff = parseYmdUtcDay(todayLagos) - parseYmdUtcDay(effectiveDueDate);
  if (diff <= 0) {
    return { daysOverdue: 0, bucket: 'not_yet_due', effectiveDueDate };
  }
  if (diff <= 7) {
    return { daysOverdue: diff, bucket: '1_7', effectiveDueDate };
  }
  if (diff <= 30) {
    return { daysOverdue: diff, bucket: '8_30', effectiveDueDate };
  }
  return { daysOverdue: diff, bucket: '30_plus', effectiveDueDate };
}

export const REMINDER_WARNING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days (72 hours)

/**
 * Returns true when a reminder was already logged within the last 3 days.
 */
export function isRemindedWithin3Days(
  lastSentAtIso: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!lastSentAtIso) return false;
  const sentMs = Date.parse(lastSentAtIso);
  if (!Number.isFinite(sentMs)) return false;
  const elapsed = now.getTime() - sentMs;
  return elapsed >= 0 && elapsed < REMINDER_WARNING_WINDOW_MS;
}

/**
 * Normalizes Nigerian/international phone numbers into wa.me digits-only format.
 */
export function normalizeWhatsAppPhone(rawPhone: string | null | undefined): string {
  const digits = (rawPhone || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('0') && digits.length === 11) {
    return `234${digits.slice(1)}`;
  }
  if (digits.startsWith('234') && digits.length >= 13) {
    return digits;
  }
  if (digits.length >= 10) {
    return digits;
  }
  return '';
}

export function buildReminderMessage(params: {
  tone: 'gentle' | 'firm';
  businessName: string;
  customerName: string;
  amountFormatted: string;
  referenceNumber: string;
  dueDate?: string | null;
  publicUrl?: string | null;
}): string {
  const customer = (params.customerName || 'Customer').trim();
  const biz = (params.businessName || 'our shop').trim();
  const refPart = params.referenceNumber ? ` (${params.referenceNumber})` : '';
  const duePart = params.dueDate ? ` due ${params.dueDate}` : '';
  const linkPart = params.publicUrl ? `\nView details & payment info: ${params.publicUrl}` : '';

  if (params.tone === 'firm') {
    return (
      `Hello ${customer}, this is a follow-up from ${biz}. ` +
      `Your balance of ${params.amountFormatted}${refPart}${duePart} is now overdue. ` +
      `Kindly make payment today and share your transfer reference so we can issue your receipt.${linkPart}`
    );
  }

  return (
    `Hello ${customer}, a kind reminder from ${biz} about your balance of ${params.amountFormatted}${refPart}${duePart}. ` +
    `Please let us know once you have paid so we can send your receipt. Thank you.${linkPart}`
  );
}

export function buildWhatsAppUrl(phone: string | null | undefined, message: string): string {
  const digits = normalizeWhatsAppPhone(phone);
  const encoded = encodeURIComponent(message);
  return digits ? `https://wa.me/${digits}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

export interface StatementInvoiceInput {
  id: string;
  referenceNumber: string;
  issueDate: string;
  totalKobo: number;
  writtenOffKobo: number;
  writtenOffDate: string | null;
  writeOffReason?: string | null;
  status: string;
  sourceType: 'INVOICE' | 'CREDIT_SALE' | 'RECEIPT';
  createdAt?: string;
}

export interface StatementPaymentInput {
  id: string;
  referenceNumber: string;
  receiptNumber?: string | null;
  paymentDate: string;
  amountKobo: number;
  paymentMethod: string;
  isVoided?: boolean;
  createdAt?: string;
}

export interface StatementLineComputed {
  id: string;
  date: string;
  kind: 'INVOICE' | 'CREDIT_SALE' | 'RECEIPT_BALANCE' | 'PAYMENT' | 'WRITE_OFF';
  reference: string;
  description: string;
  debitKobo: number;
  creditKobo: number;
  runningBalanceKobo: number;
}

export interface ComputedStatement {
  fromDate: string;
  toDate: string;
  openingBalanceKobo: number;
  periodDebitsKobo: number;
  periodPaymentsKobo: number;
  periodWriteOffsKobo: number;
  closingBalanceKobo: number;
  lines: StatementLineComputed[];
}

/**
 * Pure deterministic Customer Statement calculator.
 * - Opening balance = sum of debits - payments - write-offs strictly before `fromDate`.
 * - Period lines include invoices/credits (debit), payments (credit), and write-offs (separate credit line)
 *   sorted chronologically by date, then debits before credits/write-offs, then createdAt/id.
 * - Running balance reconciles exactly: closing = opening + periodDebits - periodPayments - periodWriteOffs.
 */
export function computeCustomerStatement(params: {
  fromDate: string;
  toDate: string;
  documents: StatementInvoiceInput[];
  payments: StatementPaymentInput[];
}): ComputedStatement {
  const { fromDate, toDate, documents, payments } = params;

  interface RawEvent {
    id: string;
    date: string;
    sortRank: number;
    createdAt: string;
    kind: StatementLineComputed['kind'];
    reference: string;
    description: string;
    debitKobo: number;
    creditKobo: number;
  }

  const events: RawEvent[] = [];

  for (const doc of documents) {
    if (doc.status === 'DRAFT' || doc.status === 'VOID') continue;
    if (doc.totalKobo > 0) {
      const kind: StatementLineComputed['kind'] =
        doc.sourceType === 'INVOICE'
          ? 'INVOICE'
          : doc.sourceType === 'CREDIT_SALE'
          ? 'CREDIT_SALE'
          : 'RECEIPT_BALANCE';
      const label =
        doc.sourceType === 'INVOICE'
          ? `Invoice ${doc.referenceNumber}`
          : doc.sourceType === 'CREDIT_SALE'
          ? `Credit sale ${doc.referenceNumber}`
          : `Part-paid receipt ${doc.referenceNumber}`;
      events.push({
        id: `doc:${doc.id}`,
        date: doc.issueDate,
        sortRank: 1,
        createdAt: doc.createdAt || `${doc.issueDate}T00:00:00.000Z`,
        kind,
        reference: doc.referenceNumber,
        description: label,
        debitKobo: Math.round(doc.totalKobo),
        creditKobo: 0,
      });
    }

    if (doc.writtenOffKobo > 0) {
      const woDate =
        doc.writtenOffDate && /^\d{4}-\d{2}-\d{2}$/.test(doc.writtenOffDate)
          ? doc.writtenOffDate
          : doc.issueDate;
      const reasonSuffix = doc.writeOffReason ? ` — ${doc.writeOffReason}` : '';
      events.push({
        id: `wo:${doc.id}`,
        date: woDate,
        sortRank: 3,
        createdAt: `${woDate}T23:59:59.000Z`,
        kind: 'WRITE_OFF',
        reference: doc.referenceNumber,
        description: `Balance write-off (${doc.referenceNumber})${reasonSuffix}`,
        debitKobo: 0,
        creditKobo: Math.round(doc.writtenOffKobo),
      });
    }
  }

  for (const pay of payments) {
    if (pay.isVoided) continue;
    if (pay.amountKobo <= 0) continue;
    const refLabel = pay.receiptNumber || pay.referenceNumber || 'Payment';
    events.push({
      id: `pay:${pay.id}`,
      date: pay.paymentDate,
      sortRank: 2,
      createdAt: pay.createdAt || `${pay.paymentDate}T12:00:00.000Z`,
      kind: 'PAYMENT',
      reference: refLabel,
      description: `Payment (${pay.paymentMethod})${pay.referenceNumber ? ` · ${pay.referenceNumber}` : ''}`,
      debitKobo: 0,
      creditKobo: Math.round(pay.amountKobo),
    });
  }

  events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.sortRank - b.sortRank ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id)
  );

  let openingBalanceKobo = 0;
  let periodDebitsKobo = 0;
  let periodPaymentsKobo = 0;
  let periodWriteOffsKobo = 0;
  const periodEvents: RawEvent[] = [];

  for (const ev of events) {
    if (ev.date < fromDate) {
      openingBalanceKobo += ev.debitKobo - ev.creditKobo;
    } else if (ev.date <= toDate) {
      periodEvents.push(ev);
    }
  }

  let running = openingBalanceKobo;
  const lines: StatementLineComputed[] = periodEvents.map((ev) => {
    running += ev.debitKobo - ev.creditKobo;
    periodDebitsKobo += ev.debitKobo;
    if (ev.kind === 'WRITE_OFF') {
      periodWriteOffsKobo += ev.creditKobo;
    } else if (ev.kind === 'PAYMENT') {
      periodPaymentsKobo += ev.creditKobo;
    }
    return {
      id: ev.id,
      date: ev.date,
      kind: ev.kind,
      reference: ev.reference,
      description: ev.description,
      debitKobo: ev.debitKobo,
      creditKobo: ev.creditKobo,
      runningBalanceKobo: running,
    };
  });

  const closingBalanceKobo =
    openingBalanceKobo + periodDebitsKobo - periodPaymentsKobo - periodWriteOffsKobo;

  return {
    fromDate,
    toDate,
    openingBalanceKobo,
    periodDebitsKobo,
    periodPaymentsKobo,
    periodWriteOffsKobo,
    closingBalanceKobo,
    lines,
  };
}

