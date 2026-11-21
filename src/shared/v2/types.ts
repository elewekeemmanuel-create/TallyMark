import type { CurrencyCode } from '../money';
import type { PaymentMethod, ReceiptTemplate, VatMode } from '../schemas';
import type { DepositType, PaymentTermsKind } from './money';

export interface BankAccount {
  id: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  isDefault?: boolean;
}

export interface ModulesEnabled {
  invoicesQuotes: boolean;
}

export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PART_PAID' | 'PAID' | 'SETTLED' | 'VOID';
export type InvoiceDisplayStatus = InvoiceStatus | 'OVERDUE';

export interface InvoiceLineRecord {
  id?: string;
  position?: number;
  description: string;
  qtyThousandths: number;
  unitPriceKobo: number;
  discountKobo: number;
  grossKobo: number;
  lineTotalKobo: number;
}

export interface InvoiceSnapshot {
  invoiceNumber: string;
  business: {
    name: string;
    logoDataUrl: string | null;
    address: string;
    phone: string;
    email: string;
    tinRc: string;
    brandColor: string;
    currency: CurrencyCode;
  };
  customer: {
    name: string;
    address: string;
  };
  bankAccounts: BankAccount[];
  issueDate: string;
  dueDate: string;
  termsKind: PaymentTermsKind;
  lines: InvoiceLineRecord[];
  subtotalKobo: number;
  lineDiscountTotalKobo: number;
  invoiceDiscountKobo: number;
  vatEnabled: boolean;
  vatMode: VatMode;
  vatRateBps: number;
  vatKobo: number;
  totalKobo: number;
  depositType: DepositType;
  depositValue: number;
  amountDueNowKobo: number;
  notes: string;
  template: ReceiptTemplate;
  showBranding: boolean;
}

export interface InvoiceRecord {
  id: string;
  businessId: string;
  customerId: string | null;
  publicId: string;
  sequenceNumber: number | null;
  invoiceNumber: string | null;
  idempotencyKey: string | null;
  status: InvoiceStatus;
  isOverdue: boolean;
  issueDate: string;
  termsKind: PaymentTermsKind;
  dueDate: string;
  currency: CurrencyCode;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  lines: InvoiceLineRecord[];
  subtotalKobo: number;
  lineDiscountTotalKobo: number;
  invoiceDiscountKobo: number;
  vatEnabled: boolean;
  vatMode: VatMode;
  vatRateBps: number;
  vatKobo: number;
  totalKobo: number;
  depositType: DepositType;
  depositValue: number;
  amountDueNowKobo: number;
  amountPaidKobo: number;
  writtenOffKobo: number;
  balanceDueKobo: number;
  notes: string;
  bankAccountIds: string[];
  template: ReceiptTemplate;
  snapshot: InvoiceSnapshot | null;
  sourceQuoteId: string | null;
  reissuedFromId: string | null;
  sentAt: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  writeOffReason: string | null;
  writtenOffAt: string | null;
  debtId: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface DebtRecord {
  id: string;
  businessId: string;
  sourceType: 'INVOICE' | 'RECEIPT' | 'CREDIT_SALE';
  sourceId: string;
  referenceNumber: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  issueDate: string;
  dueDate: string | null;
  totalKobo: number;
  amountPaidKobo: number;
  writtenOffKobo: number;
  balanceDueKobo: number;
  status: 'OPEN' | 'PART_PAID' | 'PAID' | 'SETTLED' | 'VOID';
  createdAt: string;
  updatedAt: string;
}

export interface PaymentRecord {
  id: string;
  businessId: string;
  debtId: string;
  invoiceId: string | null;
  receiptId: string | null;
  receiptNumber?: string | null;
  receiptPublicId?: string | null;
  ledgerEntryId: string | null;
  amountKobo: number;
  paymentMethod: PaymentMethod;
  paymentDate: string;
  reference: string;
  idempotencyKey: string;
  isVoided: boolean;
  voidReason: string | null;
  voidedAt: string | null;
  createdAt: string;
  createdBy: string;
}

export interface PublicInvoicePaymentSummary {
  paymentDate: string;
  amountKobo: number;
  paymentMethod: PaymentMethod;
  receiptNumber: string | null;
  receiptPublicId: string | null;
}

export interface PublicInvoiceRecord {
  publicId: string;
  status: InvoiceStatus;
  isOverdue: boolean;
  amountPaidKobo: number;
  writtenOffKobo: number;
  balanceDueKobo: number;
  sentAt: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  pendingClaimsCount: number;
  latestPendingClaimRef?: string | null;
  hasRejectedClaim?: boolean;
  snapshot: InvoiceSnapshot;
  payments: PublicInvoicePaymentSummary[];
}

export type PaymentClaimStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED';

export interface DuplicateClaimWarning {
  reason: string;
  matchingClaimRefs: string[];
  matchingPaymentIds: string[];
}

export interface PaymentClaimRecord {
  id: string;
  businessId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceCustomerName: string;
  invoiceTotalKobo: number;
  invoiceBalanceDueKobo: number;
  invoiceCurrency: CurrencyCode;
  invoiceStatus: InvoiceStatus;
  claimRef: string;
  payerName: string;
  amountKobo: number;
  reference: string;
  hasProof: boolean;
  proofMime: string | null;
  proofSizeBytes: number | null;
  proofDeletedAt: string | null;
  status: PaymentClaimStatus;
  decisionReason: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  paymentId: string | null;
  duplicateWarning: DuplicateClaimWarning | null;
  createdAt: string;
}

export interface PushStatusRecord {
  vapidConfigured: boolean;
  publicKey: string | null;
  subscribedCount: number;
  endpoints: string[];
}

export interface AuditLogRecord {
  id: string;
  businessId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface UsageCounterRecord {
  monthKey: string;
  receiptsIssued: number;
  invoicesIssued: number;
  quotesIssued: number;
}

export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED' | 'CONVERTED' | 'VOID';
export type QuoteDisplayStatus = QuoteStatus | 'EXPIRED';

export interface QuoteSnapshot {
  quoteNumber: string;
  business: {
    name: string;
    logoDataUrl: string | null;
    address: string;
    phone: string;
    email: string;
    tinRc: string;
    brandColor: string;
    currency: CurrencyCode;
  };
  customer: {
    name: string;
    address: string;
  };
  bankAccounts: BankAccount[];
  issueDate: string;
  validUntil: string;
  termsKind: PaymentTermsKind;
  lines: InvoiceLineRecord[];
  subtotalKobo: number;
  lineDiscountTotalKobo: number;
  invoiceDiscountKobo: number;
  vatEnabled: boolean;
  vatMode: VatMode;
  vatRateBps: number;
  vatKobo: number;
  totalKobo: number;
  depositType: DepositType;
  depositValue: number;
  amountDueNowKobo: number;
  notes: string;
  template: ReceiptTemplate;
  showBranding: boolean;
}

export interface QuoteRecord {
  id: string;
  businessId: string;
  customerId: string | null;
  publicId: string;
  sequenceNumber: number | null;
  quoteNumber: string | null;
  idempotencyKey: string | null;
  status: QuoteStatus;
  isExpired: boolean;
  issueDate: string;
  validUntil: string;
  termsKind: PaymentTermsKind;
  currency: CurrencyCode;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  lines: InvoiceLineRecord[];
  subtotalKobo: number;
  lineDiscountTotalKobo: number;
  invoiceDiscountKobo: number;
  vatEnabled: boolean;
  vatMode: VatMode;
  vatRateBps: number;
  vatKobo: number;
  totalKobo: number;
  depositType: DepositType;
  depositValue: number;
  amountDueNowKobo: number;
  notes: string;
  bankAccountIds: string[];
  template: ReceiptTemplate;
  snapshot: QuoteSnapshot | null;
  convertedInvoiceId: string | null;
  convertedInvoiceNumber?: string | null;
  revisedFromId: string | null;
  sentAt: string | null;
  decisionName: string | null;
  decisionNote: string | null;
  decisionAt: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface PublicQuoteRecord {
  publicId: string;
  status: QuoteStatus;
  isExpired: boolean;
  sentAt: string | null;
  decisionName: string | null;
  decisionNote: string | null;
  decisionAt: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  snapshot: QuoteSnapshot;
}

// ============================================================================
// SLICE 4: RECEIVABLES, REMINDERS, CUSTOMERS DIRECTORY, STATEMENTS & REPORTS
// ============================================================================

export type ReceivableSourceFilter = 'ALL' | 'INVOICE' | 'CREDIT_SALE' | 'RECEIPT';
export type AgeingBucketFilter = 'ALL' | 'not_yet_due' | '1_7' | '8_30' | '30_plus';

export interface ReceivableItem {
  debtId: string;
  sourceType: 'INVOICE' | 'CREDIT_SALE' | 'RECEIPT';
  sourceId: string;
  referenceNumber: string;
  publicId: string | null;
  publicPath: string | null;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  issueDate: string;
  dueDate: string | null;
  effectiveDueDate: string;
  daysOverdue: number;
  ageingBucket: 'not_yet_due' | '1_7' | '8_30' | '30_plus';
  totalKobo: number;
  amountPaidKobo: number;
  writtenOffKobo: number;
  balanceDueKobo: number;
  status: 'OPEN' | 'PART_PAID';
  lastReminderAt: string | null;
  lastReminderTone: 'gentle' | 'firm' | null;
  reminderCount: number;
  remindedWithin3Days: boolean;
}

export interface AgeingBucketTotals {
  notYetDueKobo: number;
  notYetDueCount: number;
  days1To7Kobo: number;
  days1To7Count: number;
  days8To30Kobo: number;
  days8To30Count: number;
  days30PlusKobo: number;
  days30PlusCount: number;
  totalOutstandingKobo: number;
  totalOpenCount: number;
}

export interface PaymentReminderRecord {
  id: string;
  businessId: string;
  debtId: string;
  customerId: string | null;
  tone: 'gentle' | 'firm';
  channel: 'whatsapp';
  sentAt: string;
  sentBy: string;
}

export interface CustomerDirectoryItem {
  id: string;
  businessId: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  invoiceCount: number;
  quoteCount: number;
  receiptCount: number;
  creditSaleCount: number;
  openDebtCount: number;
  totalBilledKobo: number;
  totalPaidKobo: number;
  balanceOwedKobo: number;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerStatementLine {
  id: string;
  date: string;
  kind: 'INVOICE' | 'CREDIT_SALE' | 'RECEIPT_BALANCE' | 'PAYMENT' | 'WRITE_OFF';
  reference: string;
  description: string;
  debitKobo: number;
  creditKobo: number;
  runningBalanceKobo: number;
}

export interface CustomerStatementRecord {
  business: {
    name: string;
    logoDataUrl: string | null;
    address: string;
    phone: string;
    email: string;
    tinRc: string;
    brandColor: string;
    currency: CurrencyCode;
  };
  customer: {
    id: string;
    name: string;
    phone: string;
    email: string;
    address: string;
  };
  generatedDateLagos: string;
  fromDate: string;
  toDate: string;
  openingBalanceKobo: number;
  periodDebitsKobo: number;
  periodPaymentsKobo: number;
  periodWriteOffsKobo: number;
  closingBalanceKobo: number;
  lines: CustomerStatementLine[];
}

export interface V2ReportsSummary {
  dateFrom: string;
  dateTo: string;
  // Sold vs Received (strictly separated, reconciled with ledger)
  soldTotalKobo: number;
  invoicedSalesKobo: number;
  directSalesKobo: number; // quick sales + receipt sales + credit sales
  receivedTotalKobo: number; // actual money_in in ledger_entries (reconciles 1:1 with Cash Book)
  expensesTotalKobo: number;
  netCashFlowKobo: number;
  // Invoice Ageing (as of today Africa/Lagos)
  invoiceAgeing: AgeingBucketTotals;
  // Quote-to-Invoice Conversion (within dateFrom..dateTo by issue_date)
  quoteConversion: {
    quotesSent: number;
    quotesAccepted: number;
    quotesDeclined: number;
    quotesExpired: number;
    quotesConverted: number;
    conversionRatePct: number;
    quotedTotalKobo: number;
    convertedTotalKobo: number;
  };
}

export type V2CsvExportType = 'invoices' | 'quotes' | 'payments';

