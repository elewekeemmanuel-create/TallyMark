import { z } from 'zod';
import { DateStringSchema, PaymentMethodEnum, ReceiptTemplateEnum } from '../schemas';

export const BankAccountSchema = z.object({
  id: z.string().trim().min(1).max(64),
  bankName: z.string().trim().min(2, 'Bank name is required').max(80),
  accountName: z.string().trim().min(2, 'Account name is required').max(120),
  accountNumber: z
    .string()
    .trim()
    .min(6, 'Account number must be at least 6 digits')
    .max(24)
    .regex(/^[0-9A-Za-z\s-]+$/, 'Invalid account number format'),
  isDefault: z.boolean().optional().default(false),
});

export const TermsKindEnum = z.enum(['due_on_receipt', 'net_7', 'net_14', 'net_30', 'custom']);
export const DepositTypeEnum = z.enum(['none', 'percent', 'fixed']);

export const V2LineItemInputSchema = z.object({
  description: z.string().trim().min(1, 'Item description is required').max(160),
  qtyThousandths: z.number().int().positive('Quantity must be greater than zero').max(1_000_000_000),
  unitPriceKobo: z.number().int().min(0, 'Unit price cannot be negative').max(1_000_000_000_00),
  discountKobo: z.number().int().min(0).max(1_000_000_000_00).optional().default(0),
});

export const SaveInvoiceDraftSchema = z.object({
  customerId: z.string().trim().max(64).optional().nullable(),
  customerName: z.string().trim().min(1, 'Customer name is required').max(120),
  customerPhone: z.string().trim().max(40).optional().default(''),
  customerEmail: z
    .string()
    .trim()
    .max(120)
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address')
    .optional()
    .default(''),
  customerAddress: z.string().trim().max(240).optional().default(''),
  issueDate: DateStringSchema.optional(),
  termsKind: TermsKindEnum.default('net_7'),
  dueDate: DateStringSchema.optional().nullable(),
  lines: z.array(V2LineItemInputSchema).min(1, 'Add at least one line item').max(50),
  invoiceDiscountKobo: z.number().int().min(0).max(1_000_000_000_00).optional().default(0),
  depositType: DepositTypeEnum.optional().default('none'),
  depositValue: z.number().int().min(0).max(1_000_000_000_00).optional().default(0),
  notes: z.string().trim().max(600).optional().default(''),
  bankAccountIds: z.array(z.string().trim().min(1).max(64)).max(10).optional().default([]),
  template: ReceiptTemplateEnum.optional(),
  idempotencyKey: z.string().trim().min(6).max(120).optional(),
  sendNow: z.boolean().optional().default(false),
});

export const RecordPaymentSchema = z.object({
  debtId: z.string().trim().min(1, 'Debt reference is required').max(64),
  amountKobo: z.number().int().positive('Payment amount must be greater than zero').max(1_000_000_000_00),
  paymentMethod: PaymentMethodEnum.default('Transfer'),
  paymentDate: DateStringSchema.optional(),
  reference: z.string().trim().max(80).optional().default(''),
  idempotencyKey: z.string().trim().min(6, 'Idempotency key is required').max(120),
});

export const VoidOrWriteOffReasonSchema = z.object({
  reason: z.string().trim().min(3, 'Provide a reason (at least 3 characters)').max(240),
});

export const ReissueInvoiceSchema = z.object({
  reason: z.string().trim().max(240).optional().default('Reissued with corrections'),
});

export const ToggleModuleSchema = z.object({
  enabled: z.boolean().optional(),
  dismissPromo: z.boolean().optional(),
});

export const UpdateBillingSettingsSchema = z.object({
  tinRc: z.string().trim().max(60).optional(),
  bankAccounts: z.array(BankAccountSchema).max(10).optional(),
  invoicePrefix: z
    .string()
    .trim()
    .min(1, 'Invoice prefix is required')
    .max(12)
    .regex(/^[A-Za-z0-9_-]+$/, 'Prefix may only contain letters, numbers, hyphens, or underscores')
    .optional(),
  quotePrefix: z
    .string()
    .trim()
    .min(1, 'Quote prefix is required')
    .max(12)
    .regex(/^[A-Za-z0-9_-]+$/, 'Prefix may only contain letters, numbers, hyphens, or underscores')
    .optional(),
  defaultPaymentTermsDays: z.number().int().min(0).max(365).optional(),
  defaultInvoiceNotes: z.string().trim().max(600).optional(),
});

export const SubmitPaymentClaimSchema = z
  .object({
    payerName: z
      .string()
      .trim()
      .min(1, 'Enter your name')
      .max(80, 'Name must be 80 characters or fewer'),
    amountKobo: z
      .number()
      .int('Amount must be a whole number of kobo')
      .positive('Payment amount must be greater than zero')
      .max(1_000_000_000_00),
    reference: z
      .string()
      .trim()
      .max(40, 'Reference must be 40 characters or fewer')
      .optional()
      .default(''),
    hasProof: z.boolean().optional().default(false),
    botChallenge: z.string().trim().min(10, 'Bot verification is required').max(512),
    botSolution: z.string().trim().min(1, 'Bot verification is required').max(128),
    turnstileToken: z.string().trim().max(2048).optional(),
    website: z.string().max(200).optional().default(''),
  })
  .refine((val) => val.reference.length > 0 || val.hasProof === true, {
    message: 'Enter a payment reference or attach proof of payment',
    path: ['reference'],
  });

export const ConfirmClaimSchema = z.object({
  amountKobo: z
    .number()
    .int()
    .positive('Confirmed amount must be greater than zero')
    .max(1_000_000_000_00)
    .optional(),
  paymentMethod: PaymentMethodEnum.optional().default('Transfer'),
  paymentDate: DateStringSchema.optional(),
  reference: z.string().trim().max(80).optional(),
  idempotencyKey: z.string().trim().min(6).max(120).optional(),
});

export const RejectClaimSchema = z.object({
  reason: z.string().trim().min(3, 'Enter a short private reason (at least 3 characters)').max(240),
});

export const PushSubscribeSchema = z.object({
  endpoint: z
    .string()
    .trim()
    .url('Invalid push endpoint URL')
    .max(1000)
    .refine((u) => u.startsWith('https://'), 'Push endpoint must use HTTPS'),
  keys: z.object({
    p256dh: z.string().trim().min(16).max(256),
    auth: z.string().trim().min(8).max(128),
  }),
});

export const PushUnsubscribeSchema = z.object({
  endpoint: z.string().trim().url().max(1000),
});

export const SaveQuoteDraftSchema = z.object({
  customerId: z.string().trim().max(64).optional().nullable(),
  customerName: z.string().trim().min(1, 'Customer name is required').max(120),
  customerPhone: z.string().trim().max(40).optional().default(''),
  customerEmail: z
    .string()
    .trim()
    .max(120)
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address')
    .optional()
    .default(''),
  customerAddress: z.string().trim().max(240).optional().default(''),
  issueDate: DateStringSchema.optional(),
  validUntil: DateStringSchema.optional().nullable(),
  termsKind: TermsKindEnum.default('net_7'),
  lines: z.array(V2LineItemInputSchema).min(1, 'Add at least one line item').max(50),
  invoiceDiscountKobo: z.number().int().min(0).max(1_000_000_000_00).optional().default(0),
  depositType: DepositTypeEnum.optional().default('none'),
  depositValue: z.number().int().min(0).max(1_000_000_000_00).optional().default(0),
  notes: z.string().trim().max(600).optional().default(''),
  bankAccountIds: z.array(z.string().trim().min(1).max(64)).max(10).optional().default([]),
  template: ReceiptTemplateEnum.optional(),
  idempotencyKey: z.string().trim().min(6).max(120).optional(),
  sendNow: z.boolean().optional().default(false),
});

export const ReviseQuoteSchema = z.object({
  reason: z.string().trim().max(240).optional().default('Revised with updated pricing'),
});

export const ConvertQuoteSchema = z.object({
  sendNow: z.boolean().optional().default(false),
});

export const PublicQuoteDecisionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter your name')
    .max(80, 'Name must be 80 characters or fewer'),
  note: z.string().trim().max(240, 'Note must be 240 characters or fewer').optional().default(''),
  botChallenge: z.string().trim().min(10, 'Bot verification is required').max(512),
  botSolution: z.string().trim().min(1, 'Bot verification is required').max(128),
  turnstileToken: z.string().trim().max(2048).optional(),
  website: z.string().max(200).optional().default(''),
});

export const LogReminderSchema = z.object({
  debtId: z.string().trim().min(1, 'Debt reference is required').max(64),
  tone: z.enum(['gentle', 'firm']).default('gentle'),
  channel: z.enum(['whatsapp']).default('whatsapp'),
});

export const UpdateCustomerSchema = z.object({
  name: z.string().trim().min(1, 'Customer name is required').max(120),
  phone: z.string().trim().max(40).optional().default(''),
  email: z
    .string()
    .trim()
    .max(120)
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address')
    .optional()
    .default(''),
  address: z.string().trim().max(240).optional().default(''),
  notes: z.string().trim().max(400).optional().default(''),
});

