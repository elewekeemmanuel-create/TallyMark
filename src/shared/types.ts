import type { CurrencyCode } from './money';
import type { EntrySource, PaymentMethod, ReceiptStatus, ReceiptTemplate, VatMode } from './schemas';
import type { BankAccount, ModulesEnabled } from './v2/types';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  authProvider: 'password' | 'google' | 'magic_link';
  createdAt: string;
}

export interface BusinessProfile {
  id: string;
  ownerId: string;
  name: string;
  logoDataUrl: string | null;
  signatureDataUrl?: string | null;
  address: string;
  phone: string;
  email: string;
  brandColor: string;
  receiptPrefix: string;
  nextSequence: number;
  currency: CurrencyCode;
  vatEnabled: boolean;
  vatMode: VatMode;
  vatRateBps: number;
  openingCashKobo: number;
  defaultTemplate: ReceiptTemplate;
  closeDayReminderTime: string;
  // Additive V2 fields (optional for backwards compatibility)
  tinRc?: string;
  bankAccounts?: BankAccount[];
  modulesEnabled?: ModulesEnabled;
  plan?: string;
  invoicePrefix?: string;
  nextInvoiceSequence?: number;
  quotePrefix?: string;
  nextQuoteSequence?: number;
  defaultPaymentTermsDays?: number;
  defaultInvoiceNotes?: string;
  v2PromoDismissed?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReceiptLineItem {
  description: string;
  qty: number;
  unitPriceKobo: number;
  discountKobo: number;
  grossKobo: number;
  lineTotalKobo: number;
}

export interface ReceiptRecord {
  id: string;
  businessId: string;
  publicId: string;
  sequenceNumber: number;
  receiptNumber: string;
  receiptKind: 'SALE' | 'BALANCE_PAYMENT';
  parentReceiptId: string | null;
  parentReceiptNumber: string | null;
  customerName: string;
  customerPhone: string;
  items: ReceiptLineItem[];
  subtotalKobo: number;
  discountTotalKobo: number;
  vatEnabled: boolean;
  vatMode: VatMode;
  vatRateBps: number;
  vatKobo: number;
  totalKobo: number;
  initialPaidKobo: number;
  amountPaidKobo: number;
  balanceDueKobo: number;
  paymentMethod: PaymentMethod;
  note: string;
  soldBy: string;
  source: EntrySource;
  template: ReceiptTemplate;
  status: ReceiptStatus;
  voidReason: string | null;
  voidedAt: string | null;
  issuedDateLagos: string;
  issuedAt: string;
  createdBy: string;
}

export interface PublicReceiptRecord {
  publicId: string;
  receiptNumber: string;
  receiptKind: 'SALE' | 'BALANCE_PAYMENT';
  parentReceiptNumber: string | null;
  businessName: string;
  businessLogoDataUrl: string | null;
  businessSignatureDataUrl?: string | null;
  businessAddress: string;
  businessPhone: string;
  businessEmail: string;
  brandColor: string;
  currency: CurrencyCode;
  customerName: string;
  customerPhone: string;
  items: ReceiptLineItem[];
  subtotalKobo: number;
  discountTotalKobo: number;
  vatEnabled: boolean;
  vatMode: VatMode;
  vatRateBps: number;
  vatKobo: number;
  totalKobo: number;
  amountPaidKobo: number;
  balanceDueKobo: number;
  paymentMethod: PaymentMethod;
  note: string;
  soldBy: string;
  template: ReceiptTemplate;
  status: ReceiptStatus;
  voidReason: string | null;
  voidedAt: string | null;
  issuedDateLagos: string;
  issuedAt: string;
}

export interface CustomerSuggestion {
  id: string;
  name: string;
  phone: string;
}

export interface CatalogItemSuggestion {
  id: string;
  description: string;
  unitPriceKobo: number;
  useCount: number;
}

export type LedgerEntryType = 'SALE' | 'PAYMENT_RECEIVED' | 'EXPENSE' | 'ADJUSTMENT';
export type LedgerEntryKind =
  | 'RECEIPT'
  | 'QUICK_SALE'
  | 'CREDIT_SALE'
  | 'DEBT_PAYMENT'
  | 'EXPENSE'
  | 'CORRECTION'
  | 'VOID_REVERSAL';

export interface LedgerEntryRecord {
  id: string;
  businessId: string;
  entryType: LedgerEntryType;
  entryKind: LedgerEntryKind;
  amountKobo: number;
  cashReceivedKobo: number;
  paymentMethod: PaymentMethod | null;
  receiptId: string | null;
  receiptNumber?: string | null;
  creditSaleId: string | null;
  expenseId: string | null;
  parentEntryId: string | null;
  customerName: string;
  customerPhone: string;
  note: string;
  soldBy: string;
  source: EntrySource;
  isCorrection: boolean;
  correctionReason: string;
  entryDate: string;
  createdAt: string;
  createdBy: string;
}

export interface CreditSaleRecord {
  id: string;
  businessId: string;
  customerName: string;
  customerPhone: string;
  itemNote: string;
  totalKobo: number;
  amountPaidKobo: number;
  balanceDueKobo: number;
  dueDate: string | null;
  soldBy: string;
  receiptId: string | null;
  status: 'UNPAID' | 'PART_PAID' | 'PAID' | 'VOID';
  entryDate: string;
  createdAt: string;
  createdBy: string;
}

export interface DebtItemSummary {
  debtKind: 'RECEIPT' | 'CREDIT_SALE';
  debtId: string;
  referenceLabel: string;
  description: string;
  totalKobo: number;
  amountPaidKobo: number;
  balanceDueKobo: number;
  issuedDate: string;
  dueDate: string | null;
  ageDays: number;
  status: string;
}

export interface DebtorCustomerGroup {
  customerKey: string;
  customerName: string;
  customerPhone: string;
  totalOwedKobo: number;
  oldestDebtDate: string;
  oldestDebtAgeDays: number;
  openCount: number;
  debts: DebtItemSummary[];
}

export interface CreditorRecord {
  id: string;
  businessId: string;
  supplierName: string;
  phone: string;
  description: string;
  amountKobo: number;
  dueDate: string | null;
  status: 'UNPAID' | 'PAID';
  paidAt: string | null;
  paidMethod: PaymentMethod | null;
  expenseId: string | null;
  createdAt: string;
  createdBy: string;
}

export interface ExpenseRecord {
  id: string;
  businessId: string;
  entryDate: string;
  amountKobo: number;
  category: string;
  payee: string;
  paymentMethod: PaymentMethod;
  note: string;
  proofPath: string | null;
  proofUrl: string | null;
  source: EntrySource;
  ledgerEntryId: string | null;
  isDeleted: boolean;
  deletedAt: string | null;
  isClosedDay?: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface ExpenseRevisionRecord {
  id: string;
  expenseId: string;
  businessId: string;
  action: 'EDIT' | 'DELETE' | 'CORRECTION';
  previousJson: string;
  nextJson: string | null;
  reason: string;
  changedAt: string;
  changedBy: string;
}

export interface DayClosureRecord {
  id: string;
  businessId: string;
  closeDate: string;
  openingCashKobo: number;
  expectedCashKobo: number;
  countedCashKobo: number;
  varianceKobo: number;
  totalSalesKobo: number;
  quickSalesKobo: number;
  receiptSalesKobo: number;
  creditSalesKobo: number;
  paymentsReceivedKobo: number;
  expensesKobo: number;
  netKobo: number;
  note: string;
  closedAt: string;
  closedBy: string;
}

export interface CashBookRow {
  entry: LedgerEntryRecord;
  moneyInKobo: number;
  moneyOutKobo: number;
  signedCashFlowKobo: number;
  runningBalanceKobo: number;
  runningCashInHandKobo: number;
}

export interface CashBookDayView {
  date: string;
  isClosed: boolean;
  closure: DayClosureRecord | null;
  openingCashKobo: number;
  closingCashInHandKobo: number;
  closingTotalBalanceKobo: number;
  moneyInTotalKobo: number;
  moneyOutTotalKobo: number;
  netKobo: number;
  cashInKobo: number;
  cashOutKobo: number;
  transferInKobo: number;
  transferOutKobo: number;
  posInKobo: number;
  posOutKobo: number;
  otherInKobo: number;
  otherOutKobo: number;
  receiptSalesKobo: number;
  quickSalesKobo: number;
  creditSalesGivenKobo: number;
  paymentsReceivedKobo: number;
  rows: CashBookRow[];
}

export interface ReportsSummary {
  dateFrom: string;
  dateTo: string;
  salesTotalKobo: number;
  receiptSalesKobo: number;
  quickSalesKobo: number;
  creditSalesGivenKobo: number;
  paymentsReceivedKobo: number;
  moneyInTotalKobo: number;
  expensesTotalKobo: number;
  netMoneyInMinusOutKobo: number;
  outstandingDebtsKobo: number;
  byPaymentMethod: Array<{ method: string; inKobo: number; outKobo: number; netKobo: number }>;
  byExpenseCategory: Array<{ category: string; totalKobo: number; count: number }>;
  bySoldBy: Array<{ soldBy: string; salesKobo: number; count: number }>;
  topCustomers: Array<{ customerName: string; totalKobo: number; count: number }>;
  dailySeries: Array<{ date: string; moneyInKobo: number; expensesKobo: number }>;
}

export interface HomeSummary {
  todayDateLagos: string;
  yesterdayDateLagos: string;
  yesterdayClosed: boolean;
  yesterdayHasActivity: boolean;
  todayReceiptsCount: number;
  todayMoneyReceivedKobo: number;
  todaySalesTotalKobo: number;
  todayExpensesKobo: number;
  todayNetKobo: number;
  cashInHandKobo: number;
  outstandingTotalKobo: number;
  outstandingCount: number;
  totalReceiptsCount: number;
}
