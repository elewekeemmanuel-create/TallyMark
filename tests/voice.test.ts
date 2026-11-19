import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConfirmVoiceEntriesSchema,
  parseSpokenAmountToKobo,
  validateAndNormalizeGeminiVoiceJson,
  VoiceTranscriptRequestSchema,
} from '../src/shared/voiceDraft.ts';

test('parseSpokenAmountToKobo parses Nigerian shorthand, spoken words, and currency formats', () => {
  assert.equal(parseSpokenAmountToKobo('5k'), 500_000);
  assert.equal(parseSpokenAmountToKobo('5.5k'), 550_000);
  assert.equal(parseSpokenAmountToKobo('1k5'), 150_000);
  assert.equal(parseSpokenAmountToKobo('12k5'), 1_250_000);
  assert.equal(parseSpokenAmountToKobo('five thousand'), 500_000);
  assert.equal(parseSpokenAmountToKobo('five thousand naira'), 500_000);
  assert.equal(parseSpokenAmountToKobo('twelve thousand five hundred'), 1_250_000);
  assert.equal(parseSpokenAmountToKobo('₦20,000'), 2_000_000);
  assert.equal(parseSpokenAmountToKobo('NGN 4,250.50'), 425_050);
  assert.equal(parseSpokenAmountToKobo('1.2m'), 120_000_000);
  assert.equal(parseSpokenAmountToKobo('two million five hundred thousand'), 250_000_000);
  assert.equal(parseSpokenAmountToKobo('fifteen hundred'), 150_000);
  assert.equal(parseSpokenAmountToKobo('two and a half thousand'), 250_000);
  assert.equal(parseSpokenAmountToKobo('half a million'), 50_000_000);
  assert.equal(parseSpokenAmountToKobo('50 kobo'), 50);

  // Invalid / negative / empty cases must safely return null
  assert.equal(parseSpokenAmountToKobo(''), null);
  assert.equal(parseSpokenAmountToKobo('0'), null);
  assert.equal(parseSpokenAmountToKobo('-5000'), null);
  assert.equal(parseSpokenAmountToKobo('some money'), null);
  assert.equal(parseSpokenAmountToKobo('twenty apples'), null);
});

test('validateAndNormalizeGeminiVoiceJson rejects malformed AI output without throwing', () => {
  const today = '2026-05-12';

  const malformedInputs = [
    '',
    'Sure! Here is your JSON:',
    '{not valid json',
    '{}',
    JSON.stringify({ entries: [] }),
    JSON.stringify({ entries: [{ type: 'bitcoin', amountKobo: 50000 }] }),
    JSON.stringify({ entries: [{ type: 'sale', amountKobo: -50000 }] }),
    JSON.stringify({ entries: [{ type: 'sale', amountKobo: 123.45 }] }),
    JSON.stringify({ entries: [{ type: 'sale', amountKobo: 500000, unexpectedKey: true }] }),
  ];

  for (const raw of malformedInputs) {
    const res = validateAndNormalizeGeminiVoiceJson(raw, today);
    assert.equal(res.ok, false, `Expected failure for input: ${raw}`);
  }
});

test('validateAndNormalizeGeminiVoiceJson rescues spoken hints, normalizes categories, and flags ambiguity', () => {
  const today = '2026-05-12';
  const fencedJson = `\`\`\`json
  {
    "entries": [
      {
        "type": "expense",
        "amountKobo": 0,
        "spokenAmountHint": "twelve thousand five hundred",
        "paymentMethod": "Cash",
        "category": "okada delivery",
        "customerName": "",
        "customerPhone": "",
        "note": "Waybill and okada",
        "soldBy": "",
        "confidence": "medium",
        "ambiguous": false,
        "ambiguityReason": ""
      },
      {
        "type": "credit_sale",
        "amountKobo": 800000,
        "spokenAmountHint": "eight thousand",
        "paymentMethod": "Cash",
        "category": "Other",
        "customerName": "",
        "customerPhone": "",
        "note": "Borrowed goods",
        "soldBy": "",
        "confidence": "high",
        "ambiguous": false,
        "ambiguityReason": ""
      }
    ],
    "summaryNote": "Check customer name on second item"
  }
  \`\`\``;

  const res = validateAndNormalizeGeminiVoiceJson(fencedJson, today, () => 'id-1');
  assert.equal(res.ok, true);
  if (!res.ok) return;

  assert.equal(res.data.entries.length, 2);
  // Rescued amountKobo from spokenAmountHint + mapped category to Transport
  assert.equal(res.data.entries[0].amountKobo, 1_250_000);
  assert.equal(res.data.entries[0].category, 'Transport');

  // Credit sale without customerName forced to Other + flagged ambiguous + low confidence
  assert.equal(res.data.entries[1].paymentMethod, 'Other');
  assert.equal(res.data.entries[1].ambiguous, true);
  assert.equal(res.data.entries[1].confidence, 'low');
  assert.ok(res.data.entries[1].ambiguityReason.length > 0);
});

test('10 varied spoken/typed transcript payloads validate end-to-end across sales, expenses, credit, and ambiguity', () => {
  const today = '2026-05-12';

  // 10 realistic varied transcripts matching Phase 3 checklist
  const scenarios: Array<{
    transcript: string;
    aiPayload: unknown;
    expectAmbiguous?: boolean;
  }> = [
    {
      transcript:
        'I spent five thousand on transport and twelve thousand on stock, Mama Ngozi owes me eight thousand, and I sold two bags for twenty thousand cash.',
      aiPayload: {
        entries: [
          { type: 'expense', amountKobo: 500_000, spokenAmountHint: 'five thousand', paymentMethod: 'Cash', category: 'Transport', customerName: '', customerPhone: '', note: 'Transport', soldBy: '', confidence: 'high', ambiguous: false, ambiguityReason: '' },
          { type: 'expense', amountKobo: 1_200_000, spokenAmountHint: 'twelve thousand', paymentMethod: 'Cash', category: 'Stock', customerName: '', customerPhone: '', note: 'Stock', soldBy: '', confidence: 'high', ambiguous: false, ambiguityReason: '' },
          { type: 'credit_sale', amountKobo: 800_000, spokenAmountHint: 'eight thousand', paymentMethod: 'Other', category: 'Other', customerName: 'Mama Ngozi', customerPhone: '', note: 'Credit purchase', soldBy: '', confidence: 'high', ambiguous: false, ambiguityReason: '' },
          { type: 'sale', amountKobo: 2_000_000, spokenAmountHint: 'twenty thousand', paymentMethod: 'Cash', category: 'Other', customerName: '', customerPhone: '', note: 'Two bags', soldBy: '', confidence: 'high', ambiguous: false, ambiguityReason: '' },
        ],
        summaryNote: '',
      },
    },
    {
      transcript: 'Sold indomie carton 7.5k POS and recharge card 2k transfer',
      aiPayload: {
        entries: [
          { type: 'sale', amountKobo: 750_000, spokenAmountHint: '7.5k', paymentMethod: 'POS', category: 'Other', customerName: '', customerPhone: '', note: 'Indomie carton', soldBy: '', confidence: 'high', ambiguous: false, ambiguityReason: '' },
          { type: 'sale', amountKobo: 200_000, spokenAmountHint: '2k', paymentMethod: 'Transfer', category: 'Other', customerName: '', customerPhone: '', note: 'Recharge card', soldBy: '', confidence: 'high', ambiguous: false, ambiguityReason: '' },
        ],
        summaryNote: '',
      },
    },
    {
      transcript: 'Brother Tunde paid his 15k balance by transfer this morning',
      aiPayload: {
        entries: [
          { type: 'payment_received', amountKobo: 1_500_000, spokenAmountHint: '15k', paymentMethod: 'Transfer', category: 'Other', customerName: 'Brother Tunde', customerPhone: '', note: 'Balance payment', soldBy: '', confidence: 'high', ambiguous: false, ambiguityReason: '' },
        ],
        summaryNote: '',
      },
    },
    {
      transcript: 'Paid NEPA light bill twelve thousand five hundred and generator fuel 4k5 cash',
      aiPayload: {
        entries: [
          { type: 'expense', amountKobo: 1_250_000, spokenAmountHint: 'twelve thousand five hundred', paymentMethod: 'Cash', category: 'Utilities', customerName: 'NEPA', customerPhone: '', note: 'Light bill', soldBy: '', confidence: 'high', ambiguous: false, ambiguityReason: '' },
          { type: 'expense', amountKobo: 450_000, spokenAmountHint: '4k5', paymentMethod: 'Cash', category: 'Utilities', customerName: '', customerPhone: '', note: 'Generator fuel', soldBy: '', confidence: 'high', ambiguous: false, ambiguityReason: '' },
        ],
        summaryNote: '',
      },
    },
    {
      transcript: 'Chidi took cement on credit forty five thousand naira',
      aiPayload: {
        entries: [
          { type: 'credit_sale', amountKobo: 4_500_000, spokenAmountHint: 'forty five thousand', paymentMethod: 'Other', category: 'Other', customerName: 'Chidi', customerPhone: '', note: 'Cement', soldBy: '', confidence: 'high', ambiguous: false, ambiguityReason: '' },
        ],
        summaryNote: '',
      },
    },
    {
      transcript: 'Paid shop rent one hundred and eighty thousand by bank transfer',
      aiPayload: {
        entries: [
          { type: 'expense', amountKobo: 18_000_000, spokenAmountHint: 'one hundred and eighty thousand', paymentMethod: 'Transfer', category: 'Rent', customerName: 'Landlord', customerPhone: '', note: 'Shop rent', soldBy: '', confidence: 'high', ambiguous: false, ambiguityReason: '' },
        ],
        summaryNote: '',
      },
    },
    {
      transcript: 'Ada sold hair cream 6k cash and paid staff Musa 10k',
      aiPayload: {
        entries: [
          { type: 'sale', amountKobo: 600_000, spokenAmountHint: '6k', paymentMethod: 'Cash', category: 'Other', customerName: '', customerPhone: '', note: 'Hair cream', soldBy: 'Ada', confidence: 'high', ambiguous: false, ambiguityReason: '' },
          { type: 'expense', amountKobo: 1_000_000, spokenAmountHint: '10k', paymentMethod: 'Cash', category: 'Salaries', customerName: 'Musa', customerPhone: '', note: 'Staff pay', soldBy: '', confidence: 'high', ambiguous: false, ambiguityReason: '' },
        ],
        summaryNote: '',
      },
    },
    {
      transcript: 'Wholesale customer sent 1.5 million transfer for rice',
      aiPayload: {
        entries: [
          { type: 'sale', amountKobo: 150_000_000, spokenAmountHint: '1.5 million', paymentMethod: 'Transfer', category: 'Other', customerName: 'Wholesale customer', customerPhone: '', note: 'Rice', soldBy: '', confidence: 'high', ambiguous: false, ambiguityReason: '' },
        ],
        summaryNote: '',
      },
    },
    {
      transcript: 'Collected 3500 cash from Alhaja for her balance and spent 800 on nylon',
      aiPayload: {
        entries: [
          { type: 'payment_received', amountKobo: 350_000, spokenAmountHint: '3500', paymentMethod: 'Cash', category: 'Other', customerName: 'Alhaja', customerPhone: '', note: 'Debt balance payment', soldBy: '', confidence: 'high', ambiguous: false, ambiguityReason: '' },
          { type: 'expense', amountKobo: 80_000, spokenAmountHint: '800', paymentMethod: 'Cash', category: 'Stock', customerName: '', customerPhone: '', note: 'Packing nylon', soldBy: '', confidence: 'medium', ambiguous: false, ambiguityReason: '' },
        ],
        summaryNote: '',
      },
    },
    {
      // Ambiguous sentence
      transcript: 'I gave someone money around five or maybe six thousand for something today',
      aiPayload: {
        entries: [
          { type: 'expense', amountKobo: 500_000, spokenAmountHint: 'five or maybe six thousand', paymentMethod: 'Cash', category: 'Other', customerName: '', customerPhone: '', note: 'Unclear cash payout', soldBy: '', confidence: 'low', ambiguous: true, ambiguityReason: 'Exact amount (₦5,000 or ₦6,000) and purpose are unclear' },
        ],
        summaryNote: 'Check the exact amount and whether this was an expense or loan.',
      },
      expectAmbiguous: true,
    },
  ];

  assert.equal(scenarios.length, 10);

  for (const s of scenarios) {
    assert.equal(VoiceTranscriptRequestSchema.safeParse({ transcript: s.transcript }).success, true);
    const parsed = validateAndNormalizeGeminiVoiceJson(JSON.stringify(s.aiPayload), today);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) continue;

    if (s.expectAmbiguous) {
      assert.equal(parsed.data.entries.some((e) => e.ambiguous && e.confidence === 'low'), true);
    }

    // Also confirm every non-zero entry passes strict ConfirmVoiceEntriesSchema
    const confirmCheck = ConfirmVoiceEntriesSchema.safeParse({
      entries: parsed.data.entries.map((e) => ({
        type: e.type,
        amountKobo: e.amountKobo,
        paymentMethod: e.paymentMethod,
        category: e.category,
        customerName: e.customerName,
        customerPhone: e.customerPhone,
        note: e.note,
        soldBy: e.soldBy,
        entryDate: e.entryDate,
      })),
    });
    assert.equal(confirmCheck.success, true);
  }
});

test('ConfirmVoiceEntriesSchema rejects empty list, zero amounts, or missing customer on credit_sale', () => {
  assert.equal(ConfirmVoiceEntriesSchema.safeParse({ entries: [] }).success, false);
  assert.equal(
    ConfirmVoiceEntriesSchema.safeParse({
      entries: [{ type: 'sale', amountKobo: 0, paymentMethod: 'Cash' }],
    }).success,
    false
  );
  assert.equal(
    ConfirmVoiceEntriesSchema.safeParse({
      entries: [{ type: 'credit_sale', amountKobo: 500_000, customerName: '' }],
    }).success,
    false
  );
});
