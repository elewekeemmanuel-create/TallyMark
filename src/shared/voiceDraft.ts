import { z } from 'zod';
import {
  DateStringSchema,
  EXPENSE_CATEGORY_PRESETS,
  PaymentMethodEnum,
  type PaymentMethod,
} from './schemas';

export const VoiceEntryTypeEnum = z.enum([
  'sale',
  'expense',
  'credit_sale',
  'payment_received',
]);
export type VoiceEntryType = z.infer<typeof VoiceEntryTypeEnum>;

export const VoiceConfidenceEnum = z.enum(['high', 'medium', 'low']);
export type VoiceConfidence = z.infer<typeof VoiceConfidenceEnum>;

export const VoiceTranscriptRequestSchema = z.object({
  transcript: z
    .string()
    .trim()
    .min(2, 'Speak or type what happened today before drafting entries')
    .max(2500, 'Transcript is too long (maximum 2,500 characters)'),
});

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  a: 1,
  an: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const SCALE_WORDS: Record<string, number> = {
  hundred: 100,
  thousand: 1_000,
  k: 1_000,
  grand: 1_000,
  million: 1_000_000,
  m: 1_000_000,
  billion: 1_000_000_000,
};

const MAX_NAIRA = 100_000_000; // ₦100M single-entry safety ceiling

/**
 * Deterministic parser for spoken & written Nigerian / English monetary amounts.
 * Returns integer kobo (> 0) or null if unparseable, zero, or negative.
 *
 * Examples:
 * - "5k" -> 500_000
 * - "1k5" / "2k5" -> 150_000 / 250_000
 * - "five thousand" -> 500_000
 * - "twelve thousand five hundred" -> 1_250_000
 * - "₦20,000" -> 2_000_000
 * - "1.5 million" -> 150_000_000
 */
export function parseSpokenAmountToKobo(input: string): number | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim().toLowerCase();
  if (!raw) return null;

  // Reject explicit negative amounts
  if (/^-\s*\d/.test(raw) || /\bminus\s+\d/.test(raw) || /\bnegative\b/.test(raw)) {
    return null;
  }

  // Handle explicit kobo-only phrases like "50 kobo"
  const koboOnly = raw.match(/^(?:ngn|₦|n)?\s*(\d+(?:\.\d+)?)\s*kobo$/i);
  if (koboOnly) {
    const k = Math.round(Number(koboOnly[1]));
    return Number.isFinite(k) && k > 0 && k <= MAX_NAIRA * 100 ? k : null;
  }

  // Handle Nigerian compact mid-thousand shorthand: "1k5" = 1,500, "12k5" = 12,500
  const cleanCompact = raw.replace(/,/g, '').replace(/(?:ngn|₦|\bnaira\b)/gi, '').trim();
  const midK = cleanCompact.match(/^(\d+)k(\d{1,2})$/i);
  if (midK) {
    const thousands = Number(midK[1]);
    const fracDigits = midK[2];
    const hundreds = fracDigits.length === 1 ? Number(fracDigits) * 100 : Number(fracDigits) * 10;
    const naira = thousands * 1000 + hundreds;
    const kobo = Math.round(naira * 100);
    return Number.isFinite(kobo) && kobo > 0 && naira <= MAX_NAIRA ? kobo : null;
  }

  // Handle direct numeric + optional k/m suffix: "5k", "5.5k", "20,000", "₦12500.50", "1.2m"
  const directNumeric = cleanCompact.match(
    /^(?:n\s*)?(\d+(?:\.\d{1,2})?)\s*([km])?(?:\s*(?:naira|cash|only))?$/i
  );
  if (directNumeric) {
    const base = Number(directNumeric[1]);
    const suffix = directNumeric[2]?.toLowerCase();
    const mult = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1;
    const naira = base * mult;
    const kobo = Math.round(naira * 100);
    return Number.isFinite(kobo) && kobo > 0 && naira <= MAX_NAIRA ? kobo : null;
  }

  // Handle "half a million" / "half a thousand" / "two and a half thousand"
  const halfPhrase = raw
    .replace(/,/g, '')
    .replace(/\band\s+a\s+half\b/g, ' .5 ')
    .replace(/\bhalf\s+a\b/g, ' 0.5 ')
    .replace(/\ba\s+half\b/g, ' 0.5 ');

  // Normalize tokens for spoken-word + mixed number parsing
  const normalized = halfPhrase
    .replace(/₦/g, ' ')
    .replace(/\bngn\b|\bnaira\b|\bcash\b|\btransfer\b|\bpos\b|\bonly\b/gi, ' ')
    .replace(/(\d+(?:\.\d+)?)(k|m)\b/gi, (_, num, suf) => `${num} ${suf.toLowerCase()} `)
    .replace(/-/g, ' ')
    .replace(/,/g, '')
    .replace(/\band\b/g, ' ')
    .trim();

  if (!normalized) return null;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  let total = 0;
  let current = 0;
  let sawNumericToken = false;

  for (const tok of tokens) {
    // Support decimal fragments like ".5" produced from "two and a half"
    if (/^\.\d+$/.test(tok)) {
      current += Number(tok);
      sawNumericToken = true;
      continue;
    }

    if (/^\d+(?:\.\d+)?$/.test(tok)) {
      const val = Number(tok);
      if (!Number.isFinite(val)) return null;
      current += val;
      sawNumericToken = true;
      continue;
    }

    if (tok in NUMBER_WORDS) {
      current += NUMBER_WORDS[tok];
      sawNumericToken = true;
      continue;
    }

    if (tok in SCALE_WORDS) {
      const scale = SCALE_WORDS[tok];
      sawNumericToken = true;
      if (scale === 100) {
        current = (current === 0 ? 1 : current) * 100;
      } else {
        total += (current === 0 ? 1 : current) * scale;
        current = 0;
      }
      continue;
    }

    // Unknown word token in strict amount expression -> reject
    return null;
  }

  if (!sawNumericToken) return null;
  const nairaTotal = total + current;
  const kobo = Math.round(nairaTotal * 100);
  if (!Number.isFinite(kobo) || kobo <= 0 || nairaTotal > MAX_NAIRA) {
    return null;
  }
  return kobo;
}

export const VoiceDraftItemSchema = z.object({
  id: z.string().min(1).max(80),
  type: VoiceEntryTypeEnum,
  amountKobo: z.number().int().min(0).max(MAX_NAIRA * 100),
  spokenAmountHint: z.string().trim().max(80).default(''),
  paymentMethod: PaymentMethodEnum.default('Cash'),
  category: z.string().trim().max(60).default('Other'),
  customerName: z.string().trim().max(120).default(''),
  customerPhone: z.string().trim().max(40).default(''),
  note: z.string().trim().max(240).default(''),
  soldBy: z.string().trim().max(80).default(''),
  entryDate: DateStringSchema,
  confidence: VoiceConfidenceEnum.default('medium'),
  ambiguous: z.boolean().default(false),
  ambiguityReason: z.string().trim().max(200).default(''),
});

export type VoiceDraftItem = z.infer<typeof VoiceDraftItemSchema>;

const RawAiEntrySchema = z
  .object({
    type: z.enum(['sale', 'expense', 'credit_sale', 'payment_received']),
    amountKobo: z.number().int().min(0).max(MAX_NAIRA * 100),
    spokenAmountHint: z.string().trim().max(80).optional().default(''),
    paymentMethod: z
      .enum(['Cash', 'Transfer', 'POS', 'Card', 'Other'])
      .optional()
      .default('Cash'),
    category: z.string().trim().max(60).optional().default('Other'),
    customerName: z.string().trim().max(120).optional().default(''),
    customerPhone: z.string().trim().max(40).optional().default(''),
    note: z.string().trim().max(240).optional().default(''),
    soldBy: z.string().trim().max(80).optional().default(''),
    confidence: z.enum(['high', 'medium', 'low']).optional().default('medium'),
    ambiguous: z.boolean().optional().default(false),
    ambiguityReason: z.string().trim().max(200).optional().default(''),
  })
  .strict();

const RawAiResponseSchema = z
  .object({
    entries: z.array(RawAiEntrySchema).min(1).max(30),
    summaryNote: z.string().trim().max(240).optional().default(''),
  })
  .strict();

export interface ValidatedVoiceDraftResult {
  entries: VoiceDraftItem[];
  summaryNote: string;
}

function normalizeExpenseCategory(rawCat: string): string {
  const trimmed = rawCat.trim();
  if (!trimmed) return 'Other';
  const matched = EXPENSE_CATEGORY_PRESETS.find(
    (preset) => preset.toLowerCase() === trimmed.toLowerCase()
  );
  if (matched) return matched;
  // Map common Nigerian phrasing to clean presets
  const lower = trimmed.toLowerCase();
  if (['fare', 'okada', 'bolt', 'uber', 'fuel', 'diesel', 'delivery', 'waybill'].some((k) => lower.includes(k))) {
    return 'Transport';
  }
  if (['goods', 'inventory', 'restock', 'market', 'bag', 'bags', 'carton', 'supplier'].some((k) => lower.includes(k))) {
    return 'Stock';
  }
  if (['nepa', 'phcn', 'light', 'electricity', 'water', 'data', 'airtime', 'generator'].some((k) => lower.includes(k))) {
    return 'Utilities';
  }
  if (['staff', 'salary', 'wage', 'apprentice'].some((k) => lower.includes(k))) {
    return 'Salaries';
  }
  if (['shop', 'lease', 'stall'].some((k) => lower.includes(k))) {
    return 'Rent';
  }
  return trimmed.slice(0, 60);
}

/**
 * Validates raw JSON text from Gemini against the strict Zod schema,
 * applies deterministic Nigerian spoken-amount reconciliation,
 * and flags missing/unclear fields without ever throwing uncaught errors.
 */
export function validateAndNormalizeGeminiVoiceJson(
  rawJsonText: string,
  todayDateLagos: string,
  makeId: () => string = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `vd_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
):
  | { ok: true; data: ValidatedVoiceDraftResult }
  | { ok: false; error: string } {
  if (typeof rawJsonText !== 'string' || !rawJsonText.trim()) {
    return { ok: false, error: 'Empty AI response' };
  }

  // Strip optional markdown code fences if a model ever wraps JSON
  const cleaned = rawJsonText
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let jsonObj: unknown;
  try {
    jsonObj = JSON.parse(cleaned);
  } catch {
    return { ok: false, error: 'AI returned invalid JSON' };
  }

  const parsed = RawAiResponseSchema.safeParse(jsonObj);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message || 'AI output did not match expected structure',
    };
  }

  const normalizedEntries: VoiceDraftItem[] = parsed.data.entries.map((item) => {
    let amountKobo = item.amountKobo;
    let ambiguous = item.ambiguous;
    let confidence = item.confidence;
    let ambiguityReason = item.ambiguityReason;

    // Cross-check spokenAmountHint when amount is 0 or unclear
    if (amountKobo === 0 && item.spokenAmountHint) {
      const rescued = parseSpokenAmountToKobo(item.spokenAmountHint);
      if (rescued && rescued > 0) {
        amountKobo = rescued;
      }
    }

    if (amountKobo <= 0) {
      ambiguous = true;
      confidence = 'low';
      if (!ambiguityReason) {
        ambiguityReason = 'Amount missing or unclear — enter exact amount before saving';
      }
    }

    if (item.type === 'credit_sale' && !item.customerName.trim()) {
      ambiguous = true;
      confidence = 'low';
      if (!ambiguityReason) {
        ambiguityReason = 'Customer name is required for a credit sale';
      }
    }

    if (item.type === 'payment_received' && !item.customerName.trim()) {
      ambiguous = true;
      if (confidence === 'high') confidence = 'medium';
      if (!ambiguityReason) {
        ambiguityReason = 'Check who paid or add customer name';
      }
    }

    const paymentMethod: PaymentMethod =
      item.type === 'credit_sale' ? 'Other' : item.paymentMethod;

    const category =
      item.type === 'expense' ? normalizeExpenseCategory(item.category) : 'Other';

    return {
      id: makeId(),
      type: item.type,
      amountKobo,
      spokenAmountHint: item.spokenAmountHint,
      paymentMethod,
      category,
      customerName: item.customerName.trim(),
      customerPhone: item.customerPhone.trim(),
      note: item.note.trim(),
      soldBy: item.soldBy.trim(),
      entryDate: todayDateLagos,
      confidence,
      ambiguous,
      ambiguityReason: ambiguityReason.trim(),
    };
  });

  return {
    ok: true,
    data: {
      entries: normalizedEntries,
      summaryNote: parsed.data.summaryNote,
    },
  };
}

export const ConfirmVoiceEntryInputSchema = z
  .object({
    type: VoiceEntryTypeEnum,
    amountKobo: z
      .number()
      .int()
      .positive('Every saved entry must have an amount greater than zero')
      .max(MAX_NAIRA * 100),
    paymentMethod: PaymentMethodEnum.default('Cash'),
    category: z.string().trim().max(60).optional().default('Other'),
    customerName: z.string().trim().max(120).optional().default(''),
    customerPhone: z.string().trim().max(40).optional().default(''),
    note: z.string().trim().max(240).optional().default(''),
    soldBy: z.string().trim().max(80).optional().default(''),
    entryDate: DateStringSchema.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === 'credit_sale' && !val.customerName.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Customer name is required for credit sales',
        path: ['customerName'],
      });
    }
    if (val.type === 'expense' && !val.category.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Expense category is required',
        path: ['category'],
      });
    }
  });

export type ConfirmVoiceEntryInput = z.infer<typeof ConfirmVoiceEntryInputSchema>;

export const ConfirmVoiceEntriesSchema = z.object({
  entries: z
    .array(ConfirmVoiceEntryInputSchema)
    .min(1, 'Keep or add at least one entry before confirming')
    .max(30, 'Too many entries in a single batch (max 30)'),
});
