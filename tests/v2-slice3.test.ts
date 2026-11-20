import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import test, { after, before } from 'node:test';
import cookieParser from 'cookie-parser';
import express from 'express';

// Isolate SQLite data directory before importing db/routes
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tallymark-v2-slice3-'));
process.env.TALLYMARK_DATA_DIR = TEST_DATA_DIR;
process.env.VAPID_PUBLIC_KEY =
  'BTestPublicKeyForV2Slice3UnitTests0123456789abcdefghijklmnopqrstuvwxyzABCDEF';
process.env.VAPID_PRIVATE_KEY = 'TestPrivateKeyForV2Slice3UnitTests0123456789';
process.env.VAPID_SUBJECT = 'mailto:alerts@tallymark.test';

const { db } = await import('../src/server/db.ts');
const { createApiRouter } = await import('../src/server/routes.ts');
const { setPushSenderForTests } = await import('../src/server/v2/push.ts');
const { computeValidUntilDate, isQuoteExpired } = await import('../src/shared/v2/money.ts');
const { generateQuotePdfBytes } = await import('../src/v2/pdf.ts');

let baseUrl = '';
let server: ReturnType<express.Express['listen']>;

function makeApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use('/api', createApiRouter());
  return app;
}

before(async () => {
  const app = makeApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  setPushSenderForTests(null);
  delete process.env.DISABLE_PUBLIC_QUOTE_ACTIONS;
  await new Promise<void>((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

async function apiCall(
  endpoint: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
    ip?: string;
    base?: string;
  } = {}
) {
  const headers: Record<string, string> = { ...(options.headers || {}) };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.ip) headers['X-Forwarded-For'] = options.ip;
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    body = JSON.stringify(options.body);
  }
  const res = await fetch(`${options.base || baseUrl}${endpoint}`, {
    method: options.method || 'GET',
    headers,
    body,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, json, text };
}

function solveChallengeNode(challenge: string, difficulty: number): string {
  const prefix = '0'.repeat(difficulty);
  for (let i = 0; i < 1_000_000; i += 1) {
    const sol = i.toString(36);
    const hex = crypto.createHash('sha256').update(`${challenge}:${sol}`).digest('hex');
    if (hex.startsWith(prefix)) return sol;
  }
  throw new Error('Failed to solve PoW');
}

async function getSolvedBotCheck(ip = '198.51.100.10', base?: string) {
  const chal = await apiCall('/api/v2/public/bot-challenge', { ip, base });
  assert.equal(chal.status, 200);
  const botSolution = solveChallengeNode(chal.json.challenge, chal.json.difficulty);
  return { botChallenge: chal.json.challenge as string, botSolution };
}

async function createShopWithV2(email: string, name = 'Chinedu Electricals') {
  const ml = await apiCall('/api/auth/magic-link', {
    method: 'POST',
    body: { email, name: 'Shop Owner' },
  });
  assert.equal(ml.status, 200);
  const ver = await apiCall('/api/auth/magic-link/verify', {
    method: 'POST',
    body: { token: ml.json.token },
  });
  assert.equal(ver.status, 200);
  const token = ver.json.sessionToken as string;

  const biz = await apiCall('/api/business', {
    method: 'POST',
    token,
    body: {
      name,
      address: '14 Aba Road, Port Harcourt',
      phone: '08035550199',
      email,
      currency: 'NGN',
      receiptPrefix: 'TM-',
      vatEnabled: false,
      vatRate: 7.5,
      brandColor: '#064E3B',
    },
  });
  assert.equal(biz.status, 201);

  const modToggle = await apiCall('/api/v2/settings/module', {
    method: 'PATCH',
    token,
    body: { enabled: true },
  });
  assert.equal(modToggle.status, 200);

  const billing = await apiCall('/api/v2/settings/billing', {
    method: 'PATCH',
    token,
    body: {
      bankAccounts: [
        {
          id: 'bank-gtb-1',
          bankName: 'GTBank',
          accountNumber: '0123456789',
          accountName: name,
          isDefault: true,
        },
      ],
    },
  });
  assert.equal(billing.status, 200);

  return { token, business: biz.json.business };
}

function makeQuotePayload(overrides: Record<string, unknown> = {}) {
  return {
    customerName: 'Amaka Interiors Ltd',
    customerPhone: '08091234567',
    customerEmail: 'amaka@interiors.example',
    customerAddress: '8 GRA Phase 2, Port Harcourt',
    issueDate: '2026-05-01',
    validUntil: '2026-05-15',
    termsKind: 'net_14',
    lines: [
      {
        description: '5kVA Hybrid Solar Inverter',
        qtyThousandths: 2000,
        unitPriceKobo: 45_000_000,
        discountKobo: 0,
      },
      {
        description: 'Installation & Cabling',
        qtyThousandths: 1000,
        unitPriceKobo: 15_000_000,
        discountKobo: 5_000_000,
      },
    ],
    invoiceDiscountKobo: 0,
    depositType: 'percent',
    depositValue: 5000,
    bankAccountIds: ['bank-gtb-1'],
    notes: 'Delivery within 3 business days after acceptance.',
    template: 'classic',
    sendNow: true,
    ...overrides,
  };
}

// =========================================================================
// 1. CREATE, SEND, GAP-FREE QUO- NUMBERING, SNAPSHOT, ZERO LEDGER IMPACT
// =========================================================================
test('1. Create & send quotes: gap-free QUO- numbering, idempotency, snapshot immutability, zero ledger/debt impact', async () => {
  const { token, business } = await createShopWithV2('quote1@example.com');

  const idempKey = 'quo-idemp-key-001';
  const q1 = await apiCall('/api/v2/quotes', {
    method: 'POST',
    token,
    body: makeQuotePayload({ idempotencyKey: idempKey }),
  });
  assert.equal(q1.status, 201);
  assert.equal(q1.json.quote.quoteNumber, 'QUO-0001');
  assert.equal(q1.json.quote.status, 'SENT');
  // 2 * 450,000 + (150,000 - 50,000) = 1,000,000 NGN = 100,000,000 kobo
  assert.equal(q1.json.quote.totalKobo, 100_000_000);
  // 50% deposit = 50,000,000 kobo
  assert.equal(q1.json.quote.amountDueNowKobo, 50_000_000);
  assert.ok(q1.json.quote.snapshot);
  assert.equal(q1.json.quote.snapshot.bankAccounts[0].accountNumber, '0123456789');

  // Same idempotency key returns the exact same quote without burning a number
  const q1Dup = await apiCall('/api/v2/quotes', {
    method: 'POST',
    token,
    body: makeQuotePayload({ idempotencyKey: idempKey }),
  });
  assert.equal(q1Dup.status, 200);
  assert.equal(q1Dup.json.quote.id, q1.json.quote.id);
  assert.equal(q1Dup.json.quote.quoteNumber, 'QUO-0001');

  // Create draft (no number yet), then send -> QUO-0002 (no gaps)
  const q2Draft = await apiCall('/api/v2/quotes', {
    method: 'POST',
    token,
    body: makeQuotePayload({ sendNow: false }),
  });
  assert.equal(q2Draft.status, 201);
  assert.equal(q2Draft.json.quote.status, 'DRAFT');
  assert.equal(q2Draft.json.quote.quoteNumber, null);

  const q2Sent = await apiCall(`/api/v2/quotes/${q2Draft.json.quote.id}/send`, {
    method: 'POST',
    token,
  });
  assert.equal(q2Sent.status, 200);
  assert.equal(q2Sent.json.quote.quoteNumber, 'QUO-0002');
  assert.equal(q2Sent.json.quote.status, 'SENT');

  // Prefix change affects only new quotes, never already-sent quotes
  const prefixUpdate = await apiCall('/api/v2/settings/billing', {
    method: 'PATCH',
    token,
    body: {
      quotePrefix: 'EST-',
      bankAccounts: [
        {
          id: 'bank-gtb-1',
          bankName: 'Zenith Bank',
          accountNumber: '9999888877',
          accountName: 'Updated Bank Name',
          isDefault: true,
        },
      ],
    },
  });
  assert.equal(prefixUpdate.status, 200);

  const q3 = await apiCall('/api/v2/quotes', {
    method: 'POST',
    token,
    body: makeQuotePayload({ sendNow: true }),
  });
  assert.equal(q3.status, 201);
  assert.equal(q3.json.quote.quoteNumber, 'EST-0003');
  assert.equal(q3.json.quote.snapshot.bankAccounts[0].accountNumber, '9999888877');

  // Already-sent q1 snapshot MUST still hold the original GTBank details
  const q1Check = await apiCall(`/api/v2/quotes/${q1.json.quote.id}`, { token });
  assert.equal(q1Check.status, 200);
  assert.equal(q1Check.json.quote.quoteNumber, 'QUO-0001');
  assert.equal(q1Check.json.quote.snapshot.bankAccounts[0].accountNumber, '0123456789');

  // Quotes NEVER create ledger entries or debts
  const ledgerRows = db
    .prepare('SELECT COUNT(*) AS cnt FROM ledger_entries WHERE business_id = ?')
    .get(business.id) as { cnt: number };
  const debtRows = db
    .prepare('SELECT COUNT(*) AS cnt FROM debts WHERE business_id = ?')
    .get(business.id) as { cnt: number };
  assert.equal(ledgerRows.cnt, 0);
  assert.equal(debtRows.cnt, 0);
});

// =========================================================================
// 2. PUBLIC QUOTE PAGE API: SNAPSHOT ONLY, HEADERS, REGENERATE LINK
// =========================================================================
test('2. Public quote API serves snapshot only, hides PII/IP hash, sets noindex headers, and invalidates old links on regenerate', async () => {
  const { token } = await createShopWithV2('quote2@example.com');

  // Draft quote must return identical 404 to unknown ID
  const draft = await apiCall('/api/v2/quotes', {
    method: 'POST',
    token,
    body: makeQuotePayload({ sendNow: false }),
  });
  const pubDraft = await apiCall(`/api/v2/public/quotes/${draft.json.quote.publicId}`);
  const pubUnknown = await apiCall('/api/v2/public/quotes/doesnotexist1234567890');
  assert.equal(pubDraft.status, 404);
  assert.equal(pubUnknown.status, 404);
  assert.equal(pubDraft.json.error, pubUnknown.json.error);

  // Send the quote
  const sent = await apiCall(`/api/v2/quotes/${draft.json.quote.id}/send`, {
    method: 'POST',
    token,
  });
  const oldPublicId = sent.json.quote.publicId as string;

  const pubRes = await apiCall(`/api/v2/public/quotes/${oldPublicId}`);
  assert.equal(pubRes.status, 200);
  assert.equal(pubRes.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(pubRes.headers.get('referrer-policy'), 'no-referrer');
  assert.match(pubRes.headers.get('cache-control') || '', /no-store/);
  assert.equal(pubRes.json.quote.snapshot.quoteNumber, 'QUO-0001');
  assert.equal(pubRes.json.quote.snapshot.customer.name, 'Amaka Interiors Ltd');
  // Customer phone & email and IP hash MUST NOT appear in public response
  assert.equal(pubRes.text.includes('08091234567'), false);
  assert.equal(pubRes.text.includes('amaka@interiors.example'), false);
  assert.equal(pubRes.text.includes('decisionIpHash'), false);
  assert.equal(pubRes.text.includes('decision_ip_hash'), false);

  // Regenerate link invalidates old link at once
  const regen = await apiCall(`/api/v2/quotes/${draft.json.quote.id}/regenerate-link`, {
    method: 'POST',
    token,
  });
  assert.equal(regen.status, 200);
  const newPublicId = regen.json.quote.publicId as string;
  assert.notEqual(newPublicId, oldPublicId);

  const oldAfterRegen = await apiCall(`/api/v2/public/quotes/${oldPublicId}`);
  assert.equal(oldAfterRegen.status, 404);
  const newAfterRegen = await apiCall(`/api/v2/public/quotes/${newPublicId}`);
  assert.equal(newAfterRegen.status, 200);
});

// =========================================================================
// 3. PUBLIC ACCEPT/DECLINE: METADATA, BOT CHECK, 10/HR LIMIT, KILL SWITCH, NON-PII PUSH
// =========================================================================
test('3. Accept & Decline record name/timestamp/hashed IP, enforce bot check, 10/hr persistent IP limit, kill switch, and non-PII push', async () => {
  const { token, business } = await createShopWithV2('quote3@example.com');

  // Register a push subscription to verify non-PII push on Accept & Decline
  const sub = await apiCall('/api/v2/push/subscribe', {
    method: 'POST',
    token,
    body: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/quote-slice3-sub',
      keys: { p256dh: 'BTestP256dhKeyValue0123456789abcdef', auth: 'TestAuthSecret012345' },
    },
  });
  assert.equal(sub.status, 201);

  const pushPayloads: string[] = [];
  setPushSenderForTests(async (_s, payload) => {
    pushPayloads.push(payload);
  });

  // Create two future-valid quotes (far future validUntil so never expired)
  const qAccept = await apiCall('/api/v2/quotes', {
    method: 'POST',
    token,
    body: makeQuotePayload({ validUntil: '2099-12-31' }),
  });
  const qDecline = await apiCall('/api/v2/quotes', {
    method: 'POST',
    token,
    body: makeQuotePayload({ validUntil: '2099-12-31' }),
  });

  // 3a. Kill switch returns 503 immediately
  process.env.DISABLE_PUBLIC_QUOTE_ACTIONS = '1';
  try {
    const blockedA = await apiCall(`/api/v2/public/quotes/${qAccept.json.quote.publicId}/accept`, {
      method: 'POST',
      ip: '198.51.100.31',
      body: { name: 'Amaka Obi' },
    });
    assert.equal(blockedA.status, 503);
    const blockedD = await apiCall(`/api/v2/public/quotes/${qDecline.json.quote.publicId}/decline`, {
      method: 'POST',
      ip: '198.51.100.31',
      body: { name: 'Amaka Obi' },
    });
    assert.equal(blockedD.status, 503);
  } finally {
    delete process.env.DISABLE_PUBLIC_QUOTE_ACTIONS;
  }

  // 3b. Missing/invalid bot check is rejected
  const noBot = await apiCall(`/api/v2/public/quotes/${qAccept.json.quote.publicId}/accept`, {
    method: 'POST',
    ip: '198.51.100.32',
    body: { name: 'Amaka Obi', note: 'Proceed please' },
  });
  assert.equal(noBot.status, 400);

  // Honeypot filled is rejected (403)
  const botHp = await getSolvedBotCheck('198.51.100.32');
  const hpRes = await apiCall(`/api/v2/public/quotes/${qAccept.json.quote.publicId}/accept`, {
    method: 'POST',
    ip: '198.51.100.32',
    body: { name: 'Bot', website: 'http://spam.invalid', ...botHp },
  });
  assert.equal(hpRes.status, 403);

  // 3c. Valid Accept records name, note, timestamp, and hashed IP
  const botOk1 = await getSolvedBotCheck('198.51.100.33');
  const acceptRes = await apiCall(`/api/v2/public/quotes/${qAccept.json.quote.publicId}/accept`, {
    method: 'POST',
    ip: '198.51.100.33',
    body: { name: 'Amaka Obi', note: 'Please start Monday', ...botOk1 },
  });
  assert.equal(acceptRes.status, 200);
  assert.equal(acceptRes.json.quote.status, 'ACCEPTED');
  assert.equal(acceptRes.json.quote.decisionName, 'Amaka Obi');
  assert.equal(acceptRes.json.quote.decisionNote, 'Please start Monday');
  assert.ok(acceptRes.json.quote.decisionAt);

  // DB stores decision_ip_hash (64-char hex sha256), never raw IP, and public payload never exposes hash
  const acceptRow = db
    .prepare('SELECT decision_name, decision_note, decision_at, decision_ip_hash FROM quotes WHERE id = ?')
    .get(qAccept.json.quote.id) as any;
  assert.equal(acceptRow.decision_name, 'Amaka Obi');
  assert.equal(acceptRow.decision_note, 'Please start Monday');
  assert.ok(acceptRow.decision_at);
  assert.match(acceptRow.decision_ip_hash, /^[a-f0-9]{32,64}$/);
  assert.equal(acceptRow.decision_ip_hash.includes('198.51.100.33'), false);
  assert.equal(acceptRes.text.includes(acceptRow.decision_ip_hash), false);

  // Replaying the same solved bot challenge fails (403)
  const replay = await apiCall(`/api/v2/public/quotes/${qDecline.json.quote.publicId}/decline`, {
    method: 'POST',
    ip: '198.51.100.33',
    body: { name: 'Replay Bot', ...botOk1 },
  });
  assert.equal(replay.status, 403);

  // Second action on already-accepted quote is rejected (409)
  const botDouble = await getSolvedBotCheck('198.51.100.34');
  const secondAccept = await apiCall(`/api/v2/public/quotes/${qAccept.json.quote.publicId}/decline`, {
    method: 'POST',
    ip: '198.51.100.34',
    body: { name: 'Late Change', ...botDouble },
  });
  assert.equal(secondAccept.status, 409);

  // 3d. Valid Decline records name, note, timestamp, hashed IP
  const botOk2 = await getSolvedBotCheck('198.51.100.35');
  const declineRes = await apiCall(`/api/v2/public/quotes/${qDecline.json.quote.publicId}/decline`, {
    method: 'POST',
    ip: '198.51.100.35',
    body: { name: 'Bola Ade', note: 'Price above budget', ...botOk2 },
  });
  assert.equal(declineRes.status, 200);
  assert.equal(declineRes.json.quote.status, 'DECLINED');
  assert.equal(declineRes.json.quote.decisionName, 'Bola Ade');

  const declineRow = db
    .prepare('SELECT decision_ip_hash FROM quotes WHERE id = ?')
    .get(qDecline.json.quote.id) as any;
  assert.match(declineRow.decision_ip_hash, /^[a-f0-9]{32,64}$/);

  // Wait a tick for async push notifications & confirm zero PII
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(pushPayloads.length, 2);
  for (const payload of pushPayloads) {
    assert.equal(payload.includes('Amaka'), false);
    assert.equal(payload.includes('Bola'), false);
    assert.equal(payload.includes('budget'), false);
    assert.equal(payload.includes('Monday'), false);
    const parsed = JSON.parse(payload);
    assert.match(parsed.body, /Quote response on QUO-000[12]/);
  }
  setPushSenderForTests(null);

  // 3e. Persistent 10/hour per IP rate limit (survives server restart)
  const rateIp = '198.51.100.99';
  const freshQuotes: string[] = [];
  for (let i = 0; i < 11; i += 1) {
    const q = await apiCall('/api/v2/quotes', {
      method: 'POST',
      token,
      body: makeQuotePayload({ validUntil: '2099-12-31' }),
    });
    assert.equal(q.status, 201);
    freshQuotes.push(q.json.quote.publicId);
  }

  for (let i = 0; i < 10; i += 1) {
    const bot = await getSolvedBotCheck(rateIp);
    const r = await apiCall(`/api/v2/public/quotes/${freshQuotes[i]}/accept`, {
      method: 'POST',
      ip: rateIp,
      body: { name: `Buyer ${i}`, ...bot },
    });
    assert.equal(r.status, 200, `Expected attempt ${i + 1} to succeed`);
  }

  // Spin up a brand new Express instance against the same DB to prove limit survives restart
  const restartedApp = makeApp();
  let restartedServer: ReturnType<express.Express['listen']> | null = null;
  const restartedBase = await new Promise<string>((resolve) => {
    restartedServer = restartedApp.listen(0, '127.0.0.1', () => {
      const addr = restartedServer!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });

  try {
    const bot11 = await getSolvedBotCheck(rateIp, restartedBase);
    const eleventh = await apiCall(`/api/v2/public/quotes/${freshQuotes[10]}/accept`, {
      method: 'POST',
      ip: rateIp,
      base: restartedBase,
      body: { name: 'Buyer 11', ...bot11 },
    });
    assert.equal(eleventh.status, 429);
  } finally {
    await new Promise<void>((resolve) => restartedServer?.close(() => resolve()));
  }
});

// =========================================================================
// 4. SENT IMMUTABILITY, REVISE (VOID & COPY), AND AFRICA/LAGOS EXPIRY
// =========================================================================
test('4. Sent quote cannot be edited; revising voids and copies; Africa/Lagos expiry boundary is exact', async () => {
  // 4a. Unit test Africa/Lagos (UTC+1) expiry boundary
  assert.equal(computeValidUntilDate('2026-05-01', 14), '2026-05-15');
  // 2026-05-15 23:59:59 WAT == 2026-05-15T22:59:59Z -> NOT expired
  assert.equal(isQuoteExpired('SENT', '2026-05-15', new Date('2026-05-15T22:59:59Z')), false);
  // 2026-05-16 00:00:01 WAT == 2026-05-15T23:00:01Z -> EXPIRED
  assert.equal(isQuoteExpired('SENT', '2026-05-15', new Date('2026-05-15T23:00:01Z')), true);
  // Accepted/Converted quotes never flip to expired
  assert.equal(isQuoteExpired('ACCEPTED', '2026-05-15', new Date('2026-06-01T12:00:00Z')), false);
  assert.equal(isQuoteExpired('CONVERTED', '2026-05-15', new Date('2026-06-01T12:00:00Z')), false);

  const { token } = await createShopWithV2('quote4@example.com');
  const qSent = await apiCall('/api/v2/quotes', {
    method: 'POST',
    token,
    body: makeQuotePayload({ validUntil: '2099-12-31' }),
  });
  assert.equal(qSent.status, 201);

  // 4b. Editing a sent quote is rejected (409)
  const editAttempt = await apiCall(`/api/v2/quotes/${qSent.json.quote.id}`, {
    method: 'PATCH',
    token,
    body: makeQuotePayload({ customerName: 'Tampered Name' }),
  });
  assert.equal(editAttempt.status, 409);

  // 4c. Revising voids the original and creates an editable draft copy linked via revisedFromId
  const rev = await apiCall(`/api/v2/quotes/${qSent.json.quote.id}/revise`, {
    method: 'POST',
    token,
    body: { reason: 'Customer requested 3 inverters instead of 2' },
  });
  assert.equal(rev.status, 201);
  assert.equal(rev.json.quote.status, 'DRAFT');
  assert.equal(rev.json.quote.quoteNumber, null);
  assert.equal(rev.json.quote.revisedFromId, qSent.json.quote.id);
  assert.equal(rev.json.quote.lines.length, 2);

  const origAfterRevise = await apiCall(`/api/v2/quotes/${qSent.json.quote.id}`, { token });
  assert.equal(origAfterRevise.status, 200);
  assert.equal(origAfterRevise.json.quote.status, 'VOID');

  // The revised draft IS editable and can be sent as QUO-0002
  const updatedRev = await apiCall(`/api/v2/quotes/${rev.json.quote.id}`, {
    method: 'PATCH',
    token,
    body: makeQuotePayload({
      sendNow: false,
      customerName: 'Amaka Interiors Ltd (Revised)',
      validUntil: '2099-12-31',
    }),
  });
  assert.equal(updatedRev.status, 200);
  assert.equal(updatedRev.json.quote.customerName, 'Amaka Interiors Ltd (Revised)');

  // 4d. Expired quote rejects public accept/decline (409) and owner convert (409)
  const qExpired = await apiCall('/api/v2/quotes', {
    method: 'POST',
    token,
    body: makeQuotePayload({ issueDate: '2020-01-01', validUntil: '2020-01-15', sendNow: true }),
  });
  assert.equal(qExpired.status, 201);
  assert.equal(qExpired.json.quote.isExpired, true);

  const botExp = await getSolvedBotCheck('198.51.100.41');
  const expAccept = await apiCall(`/api/v2/public/quotes/${qExpired.json.quote.publicId}/accept`, {
    method: 'POST',
    ip: '198.51.100.41',
    body: { name: 'Too Late', ...botExp },
  });
  assert.equal(expAccept.status, 409);

  const expConvert = await apiCall(`/api/v2/quotes/${qExpired.json.quote.id}/convert`, {
    method: 'POST',
    token,
    body: { sendNow: false },
  });
  assert.equal(expConvert.status, 409);
});

// =========================================================================
// 5. CONVERT TO INVOICE: COPIES EVERYTHING, LINKS DOCS, EXACTLY ONCE UNDER PARALLEL TAPS
// =========================================================================
test('5. Convert to invoice copies customer, lines & terms, links both documents, and works exactly once under parallel taps', async () => {
  const { token, business } = await createShopWithV2('quote5@example.com');

  const q = await apiCall('/api/v2/quotes', {
    method: 'POST',
    token,
    body: makeQuotePayload({
      validUntil: '2099-12-31',
      invoiceDiscountKobo: 2_500_000,
      termsKind: 'net_30',
      notes: 'Warranty 24 months on inverter',
    }),
  });
  assert.equal(q.status, 201);

  // Customer accepts the quote first
  const bot = await getSolvedBotCheck('198.51.100.51');
  const acc = await apiCall(`/api/v2/public/quotes/${q.json.quote.publicId}/accept`, {
    method: 'POST',
    ip: '198.51.100.51',
    body: { name: 'Chief Okoro', ...bot },
  });
  assert.equal(acc.status, 200);

  // Fire 5 parallel conversion requests at the exact same time
  const parallel = await Promise.all(
    Array.from({ length: 5 }, () =>
      apiCall(`/api/v2/quotes/${q.json.quote.id}/convert`, {
        method: 'POST',
        token,
        body: { sendNow: false },
      })
    )
  );

  const created = parallel.filter((r) => r.status === 201);
  const rejected = parallel.filter((r) => r.status === 409);
  assert.equal(created.length, 1, 'Exactly one parallel conversion must succeed');
  assert.equal(rejected.length, 4, 'All other parallel conversions must be rejected with 409');

  const invoice = created[0].json.invoice;
  const convertedQuote = created[0].json.quote;

  // Verify bidirectional link
  assert.equal(invoice.sourceQuoteId, q.json.quote.id);
  assert.equal(convertedQuote.status, 'CONVERTED');
  assert.equal(convertedQuote.convertedInvoiceId, invoice.id);

  // Verify customer, lines, terms, discounts, deposit, notes, bank accounts copied identically
  assert.equal(invoice.customerName, q.json.quote.customerName);
  assert.equal(invoice.customerPhone, q.json.quote.customerPhone);
  assert.equal(invoice.customerAddress, q.json.quote.customerAddress);
  assert.equal(invoice.lines.length, q.json.quote.lines.length);
  assert.equal(invoice.lines[0].description, q.json.quote.lines[0].description);
  assert.equal(invoice.lines[1].discountKobo, q.json.quote.lines[1].discountKobo);
  assert.equal(invoice.termsKind, 'net_30');
  assert.equal(invoice.invoiceDiscountKobo, 2_500_000);
  assert.equal(invoice.totalKobo, q.json.quote.totalKobo);
  assert.equal(invoice.depositType, 'percent');
  assert.equal(invoice.depositValue, 5000);
  assert.equal(invoice.notes, 'Warranty 24 months on inverter');
  assert.deepEqual(invoice.bankAccountIds, ['bank-gtb-1']);

  // Confirm DB has strictly 1 invoice row for this source_quote_id
  const dbCount = db
    .prepare('SELECT COUNT(*) AS cnt FROM invoices WHERE business_id = ? AND source_quote_id = ?')
    .get(business.id, q.json.quote.id) as { cnt: number };
  assert.equal(dbCount.cnt, 1);

  // Another sequential convert attempt also returns 409
  const retry = await apiCall(`/api/v2/quotes/${q.json.quote.id}/convert`, {
    method: 'POST',
    token,
    body: { sendNow: false },
  });
  assert.equal(retry.status, 409);
});

// =========================================================================
// 6. VECTOR QUOTE PDF (< 150 KB, VALID PDF, SELECTABLE TEXT, SNAPSHOT ONLY)
// =========================================================================
test('6. Vector quote PDF is valid, selectable, snapshot-only, and strictly under 150 KB', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (url.startsWith('/fonts/')) {
      const filePath = path.resolve(process.cwd(), 'public', url.slice(1));
      const data = fs.readFileSync(filePath);
      return new Response(data, { status: 200 });
    }
    return origFetch(input, init);
  }) as typeof fetch;

  try {
    const bytes = await generateQuotePdfBytes(
      {
        publicId: 'quote-pdf-test-id-123456',
        status: 'SENT',
        isExpired: false,
        sentAt: '2026-05-01T10:00:00.000Z',
        decisionName: null,
        decisionNote: null,
        decisionAt: null,
        voidReason: null,
        voidedAt: null,
        snapshot: {
          quoteNumber: 'QUO-0001',
          business: {
            name: 'Chinedu Electricals',
            logoDataUrl: null,
            address: '14 Aba Road, Port Harcourt',
            phone: '08035550199',
            email: 'sales@chinedu.ng',
            tinRc: 'RC-998877',
            brandColor: '#064E3B',
            currency: 'NGN',
          },
          customer: {
            name: 'Amaka Interiors Ltd',
            address: '8 GRA Phase 2, Port Harcourt',
          },
          bankAccounts: [
            {
              id: 'b1',
              bankName: 'GTBank',
              accountNumber: '0123456789',
              accountName: 'Chinedu Electricals',
              isDefault: true,
            },
          ],
          issueDate: '2026-05-01',
          validUntil: '2026-05-15',
          termsKind: 'net_14',
          lines: [
            {
              id: 'line-1',
              position: 0,
              description: '5kVA Hybrid Solar Inverter',
              qtyThousandths: 2000,
              unitPriceKobo: 45_000_000,
              discountKobo: 0,
              grossKobo: 90_000_000,
              lineTotalKobo: 90_000_000,
            },
          ],
          subtotalKobo: 90_000_000,
          lineDiscountTotalKobo: 0,
          invoiceDiscountKobo: 0,
          vatEnabled: false,
          vatMode: 'exclusive',
          vatRateBps: 750,
          vatKobo: 0,
          totalKobo: 90_000_000,
          depositType: 'none',
          depositValue: 0,
          amountDueNowKobo: 90_000_000,
          notes: 'Valid for 14 days.',
          template: 'classic',
          showBranding: true,
        },
      },
      'https://tallymark.app'
    );

    assert.ok(bytes.length > 2000, 'PDF should contain embedded font & document content');
    assert.ok(bytes.length < 150 * 1024, `PDF size ${bytes.length} bytes must be < 150 KB`);
    const header = Buffer.from(bytes.slice(0, 5)).toString('ascii');
    const tail = Buffer.from(bytes.slice(bytes.length - 16)).toString('ascii');
    assert.equal(header, '%PDF-');
    assert.ok(tail.includes('%%EOF'));
  } finally {
    globalThis.fetch = origFetch;
  }
});

// =========================================================================
// 7. TWO-USER ISOLATION, ANON DENIAL, ACCOUNT EXPORT, MIGRATION 007 SECURITY
// =========================================================================
test('7. Two-user RLS/tenant isolation, anon denial, account export includes quotes, and Migration 007 + rollback security checks', async () => {
  const shopA = await createShopWithV2('quoteA@example.com', 'Shop Alpha');
  const shopB = await createShopWithV2('quoteB@example.com', 'Shop Beta');

  const qA = await apiCall('/api/v2/quotes', {
    method: 'POST',
    token: shopA.token,
    body: makeQuotePayload({ validUntil: '2099-12-31' }),
  });
  assert.equal(qA.status, 201);

  // Unauthenticated (anon) cannot access any owner quote route
  assert.equal((await apiCall('/api/v2/quotes')).status, 401);
  assert.equal((await apiCall(`/api/v2/quotes/${qA.json.quote.id}`)).status, 401);
  assert.equal(
    (await apiCall(`/api/v2/quotes/${qA.json.quote.id}/convert`, { method: 'POST', body: {} }))
      .status,
    401
  );

  // Shop B cannot read, edit, revise, regenerate, void, or convert Shop A's quote
  const listB = await apiCall('/api/v2/quotes', { token: shopB.token });
  assert.equal(listB.status, 200);
  assert.equal(listB.json.quotes.length, 0);

  assert.equal(
    (await apiCall(`/api/v2/quotes/${qA.json.quote.id}`, { token: shopB.token })).status,
    404
  );
  assert.equal(
    (
      await apiCall(`/api/v2/quotes/${qA.json.quote.id}/void`, {
        method: 'POST',
        token: shopB.token,
        body: { reason: 'Cross-tenant attempt' },
      })
    ).status,
    404
  );
  assert.equal(
    (
      await apiCall(`/api/v2/quotes/${qA.json.quote.id}/revise`, {
        method: 'POST',
        token: shopB.token,
        body: {},
      })
    ).status,
    404
  );
  assert.equal(
    (
      await apiCall(`/api/v2/quotes/${qA.json.quote.id}/regenerate-link`, {
        method: 'POST',
        token: shopB.token,
      })
    ).status,
    404
  );
  assert.equal(
    (
      await apiCall(`/api/v2/quotes/${qA.json.quote.id}/convert`, {
        method: 'POST',
        token: shopB.token,
        body: { sendNow: false },
      })
    ).status,
    404
  );

  // Account export for Shop A includes quotes; Shop B's export does not include Shop A's quote
  const expA = await apiCall('/api/account/export', { token: shopA.token });
  assert.equal(expA.status, 200);
  assert.equal(expA.json.quotes.length, 1);
  assert.equal(expA.json.quotes[0].id, qA.json.quote.id);

  const expB = await apiCall('/api/account/export', { token: shopB.token });
  assert.equal(expB.status, 200);
  assert.equal(expB.json.quotes.length, 0);

  // Verify Migration 007 and rollback SQL structure & security invariants
  const mig = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/007_v2_slice3_quotations.sql'),
    'utf8'
  );
  const rb = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/007_v2_slice3_quotations.rollback.sql'),
    'utf8'
  );

  assert.match(mig, /^begin;/im);
  assert.match(mig, /commit;\s*$/i);
  assert.match(rb, /^begin;/im);
  assert.match(rb, /commit;\s*$/i);

  assert.match(mig, /idx_invoices_source_quote_unique/i);
  assert.match(mig, /set search_path = public/i);
  assert.match(mig, /for update/i);
  assert.match(mig, /revoke all on function public\.v2_save_quote_draft.*from public/is);
  assert.match(mig, /revoke all on function public\.v2_send_quote.*from public/is);
  assert.match(mig, /revoke all on function public\.v2_convert_quote_to_invoice.*from public/is);
  assert.match(mig, /revoke all on function public\.v2_record_public_quote_decision.*from public/is);
  assert.match(mig, /perform pg_notify\('pgrst', 'reload schema'\)/i);

  // get_public_quote must NEVER return decision_ip_hash, customer_phone, or customer_email
  const getPubStart = mig.indexOf('create or replace function public.get_public_quote');
  const getPubEnd = mig.indexOf('create or replace function public.v2_record_public_quote_decision');
  assert.ok(getPubStart > 0 && getPubEnd > getPubStart);
  const getPubBody = mig.slice(getPubStart, getPubEnd);
  assert.equal(getPubBody.includes('decision_ip_hash'), false);
  assert.equal(getPubBody.includes('customer_phone'), false);
  assert.equal(getPubBody.includes('customer_email'), false);
});
