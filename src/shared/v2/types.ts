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
