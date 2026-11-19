import { z } from 'zod';

export const PaymentMethodEnum = z.enum(['Cash', 'Transfer', 'POS', 'Card', 'Other']);
export type PaymentMethod = z.infer<typeof PaymentMethodEnum>;

export const ReceiptTemplateEnum = z.enum(['modern', 'classic', 'compact']);
export type ReceiptTemplate = z.infer<typeof ReceiptTemplateEnum>;

export const ReceiptStatusEnum = z.enum(['PAID', 'PART_PAID', 'VOID']);
export type ReceiptStatus = z.infer<typeof ReceiptStatusEnum>;

export const EntrySourceEnum = z.enum(['manual', 'voice']);
export type EntrySource = z.infer<typeof EntrySourceEnum>;

export const VatModeEnum = z.enum(['inclusive', 'exclusive']);
export type VatMode = z.infer<typeof VatModeEnum>;

export const CurrencyEnum = z.enum(['NGN', 'USD', 'GBP', 'EUR']);

export const EXPENSE_CATEGORY_PRESETS = [
  'Stock',
  'Rent',
  'Transport',
  'Salaries',
  'Utilities',
  'Marketing',
  'Other',
] as const;

export const DateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

export const BusinessInputSchema = z.object({
  name: z.string().trim().min(2, 'Business name is required').max(100),
  logoDataUrl: z
    .string()
    .max(700000, 'Logo image must be under 500 KB')
    .refine(
      (val) => !val || /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(val),
      'Invalid image data format'
    )
    .optional()
    .nullable(),
  address: z.string().trim().max(240).optional().default(''),
  phone: z.string().trim().max(40).optional().default(''),
  email: z
    .string()
    .trim()
    .max(120)
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address')
    .optional()
    .default(''),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Brand color must be a valid hex code')
    .default('#064E3B'),
  receiptPrefix: z
    .string()
    .trim()
    .min(1, 'Receipt prefix is required')
    .max(12, 'Prefix max 12 characters')
    .regex(/^[A-Za-z0-9_-]+$/, 'Prefix may only contain letters, numbers, hyphens, or underscores')
    .default('RCT-'),
  currency: CurrencyEnum.default('NGN'),
  vatEnabled: z.boolean().default(false),
  vatMode: VatModeEnum.default('exclusive'),
  openingCashKobo: z.number().int().min(0).max(1_000_000_000_00).default(0),
  defaultTemplate: ReceiptTemplateEnum.default('modern'),
  closeDayReminderTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Reminder time must be HH:MM')
    .optional()
    .default('19:00'),
});

export type BusinessInput = z.infer<typeof BusinessInputSchema>;

export const LineItemInputSchema = z.object({
  description: z.string().trim().min(1, 'Item description is required').max(160),
  qty: z.number().positive('Quantity must be greater than 0').max(100000),
  unitPriceKobo: z.number().int().min(0).max(1_000_000_000_00),
  discountKobo: z.number().int().min(0).max(1_000_000_000_00).optional().default(0),
});

export const CreateReceiptSchema = z.object({
  customerName: z.string().trim().max(120).optional().default(''),
  customerPhone: z.string().trim().max(40).optional().default(''),
  items: z.array(LineItemInputSchema).min(1, 'Add at least one item').max(50),
  paymentMethod: PaymentMethodEnum.default('Cash'),
  amountPaidKobo: z.number().int().min(0).max(1_000_000_000_00),
  note: z.string().trim().max(400).optional().default(''),
  soldBy: z.string().trim().max(80).optional().default(''),
  issuedDateLagos: DateStringSchema.optional(),
  template: ReceiptTemplateEnum.optional(),
  source: EntrySourceEnum.default('manual'),
});

export type CreateReceiptInput = z.infer<typeof CreateReceiptSchema>;

export const ReceiveBalanceSchema = z.object({
  amountKobo: z.number().int().positive('Payment amount must be greater than zero').max(1_000_000_000_00),
  paymentMethod: PaymentMethodEnum.default('Cash'),
  note: z.string().trim().max(400).optional().default(''),
  soldBy: z.string().trim().max(80).optional().default(''),
  issuedDateLagos: DateStringSchema.optional(),
  template: ReceiptTemplateEnum.optional(),
});

export const VoidReceiptSchema = z.object({
  reason: z.string().trim().min(3, 'Provide a reason for voiding').max(240),
});

export const QuickSaleSchema = z.object({
  amountKobo: z.number().int().positive('Amount must be greater than zero').max(1_000_000_000_00),
  itemNote: z.string().trim().max(240).optional().default(''),
  paymentMethod: PaymentMethodEnum.default('Cash'),
  customerName: z.string().trim().max(120).optional().default(''),
  customerPhone: z.string().trim().max(40).optional().default(''),
  soldBy: z.string().trim().max(80).optional().default(''),
  entryDate: DateStringSchema.optional(),
  source: EntrySourceEnum.default('manual'),
});

export const CreditSaleSchema = z.object({
  customerName: z.string().trim().min(1, 'Customer name is required for a credit sale').max(120),
  customerPhone: z.string().trim().max(40).optional().default(''),
  amountKobo: z.number().int().positive('Amount owed must be greater than zero').max(1_000_000_000_00),
  itemNote: z.string().trim().max(240).optional().default(''),
  dueDate: DateStringSchema.optional().nullable(),
  soldBy: z.string().trim().max(80).optional().default(''),
  entryDate: DateStringSchema.optional(),
  source: EntrySourceEnum.default('manual'),
});

export const RecordDebtPaymentSchema = z.object({
  debtKind: z.enum(['RECEIPT', 'CREDIT_SALE']),
  debtId: z.string().min(1),
  amountKobo: z.number().int().positive('Payment amount must be greater than zero').max(1_000_000_000_00),
  paymentMethod: PaymentMethodEnum.default('Cash'),
  note: z.string().trim().max(400).optional().default(''),
  soldBy: z.string().trim().max(80).optional().default(''),
  issuedDateLagos: DateStringSchema.optional(),
  template: ReceiptTemplateEnum.optional(),
});

export const CreditorInputSchema = z.object({
  supplierName: z.string().trim().min(1, 'Supplier name is required').max(120),
  phone: z.string().trim().max(40).optional().default(''),
  description: z.string().trim().max(240).optional().default(''),
  amountKobo: z.number().int().positive('Amount must be greater than zero').max(1_000_000_000_00),
  dueDate: DateStringSchema.optional().nullable(),
});

export const MarkCreditorPaidSchema = z.object({
  paymentMethod: PaymentMethodEnum.default('Cash'),
  recordAsExpense: z.boolean().default(true),
  entryDate: DateStringSchema.optional(),
  note: z.string().trim().max(240).optional().default(''),
});

export const ExpenseInputSchema = z.object({
  entryDate: DateStringSchema.optional(),
  amountKobo: z.number().int().positive('Amount must be greater than zero').max(1_000_000_000_00),
  category: z.string().trim().min(1, 'Category is required').max(60),
  payee: z.string().trim().max(120).optional().default(''),
  paymentMethod: PaymentMethodEnum.default('Cash'),
  note: z.string().trim().max(400).optional().default(''),
  proofPath: z.string().trim().max(300).optional().nullable(),
  proofUrl: z.string().trim().max(300).optional().nullable(),
  source: EntrySourceEnum.default('manual'),
});

export const CloseDaySchema = z.object({
  closeDate: DateStringSchema,
  countedCashKobo: z.number().int().min(0).max(1_000_000_000_00),
  note: z.string().trim().max(400).optional().default(''),
});

export const CorrectionEntrySchema = z.object({
  entryDate: DateStringSchema,
  direction: z.enum(['IN', 'OUT']),
  amountKobo: z.number().int().positive('Correction amount must be greater than zero').max(1_000_000_000_00),
  paymentMethod: PaymentMethodEnum.default('Cash'),
  reason: z.string().trim().min(3, 'Enter a reason for this correction').max(240),
  soldBy: z.string().trim().max(80).optional().default(''),
  expenseId: z.string().optional().nullable(),
});

export const AuthGoogleSchema = z.object({
  email: z.string().trim().email('Valid Google email required').max(160),
  name: z.string().trim().min(1).max(120).optional(),
});

export const MagicLinkRequestSchema = z.object({
  email: z.string().trim().email('Enter a valid email address').max(160),
  name: z.string().trim().max(120).optional(),
});

export const MagicLinkVerifySchema = z.object({
  token: z.string().trim().min(10).max(200),
});

export const ANALYTICS_EVENT_NAMES = [
  'landing_view',
  'hero_receipt_updated',
  'hero_receipt_stamped',
  'hero_template_switched',
  'hero_color_switched',
  'hero_qr_verified',
  'hero_make_yours_clicked',
  'cta_get_started_clicked',
  'cta_open_app_clicked',
  'summary_period_changed',
  'faq_toggled',
] as const;

export const AnalyticsEventSchema = z.object({
  eventName: z.enum(ANALYTICS_EVENT_NAMES),
  path: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^\/[A-Za-z0-9/_-]*$/, 'Path must be a clean relative route')
    .default('/'),
  timestamp: z
    .string()
    .datetime({ offset: true })
    .optional(),
});

export type AnalyticsEventInput = z.infer<typeof AnalyticsEventSchema>;

