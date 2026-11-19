import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  validateAndNormalizeGeminiVoiceJson,
  type ValidatedVoiceDraftResult,
} from '../shared/voiceDraft.ts';

export class VoiceAiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const VOICE_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    entries: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: {
            type: Type.STRING,
            enum: ['sale', 'expense', 'credit_sale', 'payment_received'],
            description:
              'sale = cash/transfer/POS sale paid now; expense = business spending; credit_sale = customer bought on credit / owes / borrowed; payment_received = customer paid back an existing debt or balance.',
          },
          amountKobo: {
            type: Type.INTEGER,
            description:
              'Exact integer amount in Nigerian kobo (1 Naira = 100 kobo, e.g. 5,000 Naira = 500000 kobo, 5k = 500000 kobo). Set 0 if the amount is missing or genuinely ambiguous.',
          },
          spokenAmountHint: {
            type: Type.STRING,
            description:
              'Exact spoken number/currency phrase from the transcript for this entry, e.g. "five thousand" or "12k" or "twenty thousand".',
          },
          paymentMethod: {
            type: Type.STRING,
            enum: ['Cash', 'Transfer', 'POS', 'Card', 'Other'],
            description:
              'Payment method mentioned (default Cash when paid without method specified; Other for credit_sale).',
          },
          category: {
            type: Type.STRING,
            description:
              'For expenses only: one of Stock, Rent, Transport, Salaries, Utilities, Marketing, or Other. Use Other for non-expense entries.',
          },
          customerName: {
            type: Type.STRING,
            description:
              'Customer name for sales/credit_sale/payment_received, or payee/supplier name for expense if mentioned. Empty string if none.',
          },
          customerPhone: {
            type: Type.STRING,
            description: 'Customer phone number if explicitly spoken, else empty string.',
          },
          note: {
            type: Type.STRING,
            description:
              'Short, clear description of what was sold, bought, or paid (e.g. "Two bags of rice", "Transport fare", "Stock purchase").',
          },
          soldBy: {
            type: Type.STRING,
            description: 'Staff/seller name if mentioned, else empty string.',
          },
          confidence: {
            type: Type.STRING,
            enum: ['high', 'medium', 'low'],
          },
          ambiguous: {
            type: Type.BOOLEAN,
            description:
              'True if amount, entry type, customer name (on credit), or split is unclear and the owner should double-check before saving.',
          },
          ambiguityReason: {
            type: Type.STRING,
            description:
              'Short plain-English explanation of what the owner should verify when ambiguous is true, else empty string.',
          },
        },
        required: [
          'type',
          'amountKobo',
          'spokenAmountHint',
          'paymentMethod',
          'category',
          'customerName',
          'customerPhone',
          'note',
          'soldBy',
          'confidence',
          'ambiguous',
          'ambiguityReason',
        ],
      },
    },
    summaryNote: {
      type: Type.STRING,
      description: 'Optional brief 1-sentence note if any part of the transcript was unclear.',
    },
  },
  required: ['entries', 'summaryNote'],
} as const;

const SYSTEM_INSTRUCTION = `You extract Nigerian small-business daily bookkeeping entries from a spoken or typed transcript into strict JSON.
Privacy & scope rules:
- Only parse what is explicitly present in the transcript. Never invent entries, totals, customers, or amounts not mentioned.
- Convert Nigerian Naira amounts accurately into integer kobo (1 Naira = 100 kobo):
  - "5k", "5 grand", "five thousand" -> 500000
  - "12.5k", "12k5", "twelve thousand five hundred" -> 1250000
  - "20k", "twenty thousand" -> 2000000
  - "1.5 million" -> 150000000
- Understand common Nigerian English and market phrasing:
  - "spent ... on transport / waybill / okada / fuel / diesel" -> expense (category: Transport)
  - "bought goods / restocked / bought stock / paid supplier for bags" -> expense (category: Stock)
  - "NEPA / light / prepaid / airtime / data / gen" -> expense (category: Utilities)
  - "owes me / took on credit / borrowed / buy now pay later / credit" -> credit_sale
  - "paid balance / settled his debt / brought money she owed / paid back" -> payment_received
  - "sold / customer paid / bought from me / POS / transfer sale" -> sale
- If an entry's amount, category/type, or customer name (for credit_sale) is unclear, vague, garbled, or could be read two ways:
  - Still draft the closest item, set ambiguous: true, confidence: "low", and write a short ambiguityReason telling the owner what to check.
- If the transcript mentions zero financial transactions (e.g. greeting or gibberish), return an empty entries array is NOT valid — instead return a single low-confidence ambiguous entry with amountKobo: 0 so the UI flags it cleanly, OR let validation reject completely unusable input.`;

let cachedClient: { apiKey: string; client: GoogleGenAI } | null = null;

function getGeminiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new VoiceAiError(
      'Voice AI drafting is not active yet because GEMINI_API_KEY is not configured. Use the manual entry forms below.',
      503,
      'AI_UNAVAILABLE'
    );
  }
  if (!cachedClient || cachedClient.apiKey !== apiKey) {
    cachedClient = {
      apiKey,
      client: new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: { 'User-Agent': 'aistudio-build' },
          timeout: 45_000,
          // Bound SDK retries (default is 5 attempts / up to 60s backoff) so transient
          // failures retry quickly once and real rate limits (429) surface immediately
          // instead of hitting the server abort timer and reporting AbortError (status 20).
          retryOptions: {
            attempts: 2,
            initialDelay: 0.5,
            maxDelay: 2.0,
            httpStatusCodes: [408, 500, 502, 503, 504],
          },
        },
      }),
    };
  }
  return cachedClient.client;
}

export async function parseTranscriptWithGemini(
  transcriptOnly: string,
  todayDateLagos: string
): Promise<ValidatedVoiceDraftResult> {
  const ai = getGeminiClient();

  let rawText: string | undefined;
  let lastErr: any = null;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), 55_000);
  try {
    // Privacy guarantee: ONLY the spoken/typed transcript string is transmitted to Gemini.
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: transcriptOnly,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: VOICE_RESPONSE_SCHEMA,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        abortSignal: controller.signal,
      },
    });
    rawText = response.text;
  } catch (err: any) {
    lastErr = err;
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (lastErr) {
    const status = Number(lastErr?.status || lastErr?.code || 0);
    const msg = String(lastErr?.message || lastErr || '');
    const isAbort = lastErr?.name === 'AbortError' || status === 20;

    if (isAbort) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          context: 'gemini_voice_timeout',
          status,
          name: lastErr?.name,
          message: msg.slice(0, 400),
        })
      );
      throw new VoiceAiError(
        'Voice AI took too long to respond. Try a shorter sentence or use the manual forms below.',
        504,
        'AI_TIMEOUT'
      );
    }

    console.error(
      JSON.stringify({
        level: 'error',
        context: 'gemini_voice_parse',
        status,
        name: lastErr?.name,
        message: msg.slice(0, 400),
      })
    );
    if (status === 429 || /RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(msg)) {
      throw new VoiceAiError(
        'Voice AI limit reached right now. Wait a minute or use manual entry below.',
        429,
        'AI_RATE_LIMITED'
      );
    }
    if (status === 401 || status === 403 || /PERMISSION_DENIED|API_KEY_INVALID|unauth/i.test(msg)) {
      throw new VoiceAiError(
        'Voice AI service credentials need attention. Please enter entries manually for now.',
        503,
        'AI_UNAVAILABLE'
      );
    }
    throw new VoiceAiError(
      'Could not reach Voice AI right now. Check your network or use manual entry.',
      502,
      status ? `AI_UPSTREAM_${status}` : 'AI_UPSTREAM_NETWORK'
    );
  }

  const validated = validateAndNormalizeGeminiVoiceJson(rawText || '', todayDateLagos);
  if (!validated.ok) {
    throw new VoiceAiError(
      `Draft could not be structured cleanly (${validated.error}). Try speaking each sale or expense clearly, or enter manually.`,
      422,
      'MALFORMED_AI_OUTPUT'
    );
  }

  return validated.data;
}
