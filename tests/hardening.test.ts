import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import test, { after, before } from 'node:test';
import cookieParser from 'cookie-parser';
import express from 'express';
import {
  calculateReceiptTotals,
  formatKobo,
  getLagosDateString,
  koboToWords,
  parseAmountToKobo,
} from '../src/shared/money.ts';

// Isolate SQLite data directory before importing db/routes
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tallymark-phase5-'));
process.env.TALLYMARK_DATA_DIR = TEST_DATA_DIR;

const { createApiRouter } = await import('../src/server/routes.ts');

let baseUrl = '';
let server: ReturnType<express.Express['listen']>;

before(async () => {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use('/api', createApiRouter());

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup issues
  }
});

async function apiCall(
  endpoint: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {}
) {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
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

test('Money math, VAT modes, kobo parsing, amount-in-words, and Africa/Lagos midnight UTC boundary', () => {
  // Parse kobo accurately without floating-point drift
  assert.equal(parseAmountToKobo('19.99'), 1999);
  assert.equal(parseAmountToKobo('12,500.50'), 1_250_050);
  assert.equal(parseAmountToKobo('0.01'), 1);
  assert.equal(formatKobo(1_250_050, 'NGN'), '₦12,500.50');

  // Exclusive VAT (7.5% = 750 bps)
  const excl = calculateReceiptTotals(
    [
      { description: 'Bag of Rice', qty: 2, unitPriceKobo: 5_000_000, discountKobo: 500_000 },
      { description: 'Vegetable Oil', qty: 1.5, unitPriceKobo: 2_000_000, discountKobo: 0 },
    ],
    true,
    'exclusive',
    750
  );
  // Line 1 gross = 10,000,000, net = 9,500,000; Line 2 gross = 3,000,000, net = 3,000,000
  assert.equal(excl.subtotalKobo, 13_000_000);
  assert.equal(excl.discountTotalKobo, 500_000);
  // Net before VAT = 12,500,000 -> 7.5% VAT = 937,500 -> Total = 13,437,500
  assert.equal(excl.vatKobo, 937_500);
  assert.equal(excl.totalKobo, 13_437_500);

  // Inclusive VAT (7.5% extracted from 10,750,000 kobo = 750,000 kobo VAT)
  const incl = calculateReceiptTotals(
    [{ description: 'Generator', qty: 1, unitPriceKobo: 10_750_000, discountKobo: 0 }],
    true,
    'inclusive',
    750
  );
  assert.equal(incl.vatKobo, 750_000);
  assert.equal(incl.totalKobo, 10_750_000);

  // Amount in words
  assert.equal(
    koboToWords(1_250_050, 'NGN'),
    'Twelve Thousand, Five Hundred Naira and Fifty Kobo Only'
  );

  // Africa/Lagos (UTC+1) midnight boundary check:
  // 22:59:59 UTC is 23:59:59 WAT (same calendar day)
  // 23:00:00 UTC is 00:00:00 WAT (next calendar day in Lagos!)
  assert.equal(getLagosDateString(new Date('2026-11-18T22:59:59.000Z')), '2026-11-18');
  assert.equal(getLagosDateString(new Date('2026-11-18T23:00:00.000Z')), '2026-11-19');
});

test('Auth hardening: unverified /api/auth/google is blocked in production or when Google OAuth is configured, and magic links are single-use', async () => {
  // Temporarily simulate production mode without ALLOW_DEV_AUTH
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const blockedProd = await apiCall('/api/auth/google', {
      method: 'POST',
      body: { email: 'attacker@example.com', name: 'Attacker' },
    });
    assert.equal(blockedProd.status, 403);

    const cfgProd = await apiCall('/api/auth/config');
    assert.equal(cfgProd.json.directEmailSignInEnabled, false);
  } finally {
    process.env.NODE_ENV = prevEnv;
  }

  // Temporarily simulate configured Google OAuth credentials
  process.env.GOOGLE_CLIENT_ID = 'client-123';
  process.env.GOOGLE_CLIENT_SECRET = 'secret-456';
  try {
    const blockedOAuth = await apiCall('/api/auth/google', {
      method: 'POST',
      body: { email: 'attacker@example.com', name: 'Attacker' },
    });
    assert.equal(blockedOAuth.status, 403);
  } finally {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  }

  // Magic link single-use verification
  const mlReq = await apiCall('/api/auth/magic-link', {
    method: 'POST',
    body: { email: 'singleuse@tallymark.ng', name: 'Single Use' },
  });
  assert.equal(mlReq.status, 200);
  const magicToken = mlReq.json.token;
  assert.ok(magicToken);

  const firstVerify = await apiCall('/api/auth/magic-link/verify', {
    method: 'POST',
    body: { token: magicToken },
  });
  assert.equal(firstVerify.status, 200);
  assert.ok(firstVerify.json.sessionToken);

  const replayVerify = await apiCall('/api/auth/magic-link/verify', {
    method: 'POST',
    body: { token: magicToken },
  });
  assert.equal(replayVerify.status, 401);
});

test('Cross-tenant isolation, public receipt field whitelist, gap-free numbering, voiding & closed-day locks', async () => {
  // Sign in Owner A and Owner B via magic links
  const mlA = await apiCall('/api/auth/magic-link', {
    method: 'POST',
    body: { email: 'owner.a@shop.ng', name: 'Owner A' },
  });
  const authA = await apiCall('/api/auth/magic-link/verify', {
    method: 'POST',
    body: { token: mlA.json.token },
  });
  const tokenA = authA.json.sessionToken as string;
  const userIdA = authA.json.user.id as string;

  const mlB = await apiCall('/api/auth/magic-link', {
    method: 'POST',
    body: { email: 'owner.b@shop.ng', name: 'Owner B' },
  });
  const authB = await apiCall('/api/auth/magic-link/verify', {
    method: 'POST',
    body: { token: mlB.json.token },
  });
  const tokenB = authB.json.sessionToken as string;

  // Onboard both businesses
  const bizARes = await apiCall('/api/business', {
    method: 'POST',
    token: tokenA,
    body: {
      name: 'Adaeze Fabrics',
      address: '14 Balogun Street, Lagos',
      phone: '08031234567',
      email: 'adaeze@shop.ng',
      brandColor: '#064E3B',
      receiptPrefix: 'ADF-',
      currency: 'NGN',
      vatEnabled: false,
      vatMode: 'exclusive',
      openingCashKobo: 1_000_000, // ₦10,000
      defaultTemplate: 'modern',
    },
  });
  assert.equal(bizARes.status, 201);

  const bizBRes = await apiCall('/api/business', {
    method: 'POST',
    token: tokenB,
    body: {
      name: 'Bello Electronics',
      address: '22 Computer Village, Ikeja',
      phone: '08090001111',
      email: 'bello@shop.ng',
      brandColor: '#1E3A8A',
      receiptPrefix: 'BEL-',
      currency: 'NGN',
      vatEnabled: false,
      vatMode: 'exclusive',
      openingCashKobo: 0,
      defaultTemplate: 'classic',
    },
  });
  assert.equal(bizBRes.status, 201);

  // 1. Owner A issues a part-paid receipt (total ₦50,000, paid ₦30,000 Cash, balance ₦20,000)
  const r1Res = await apiCall('/api/receipts', {
    method: 'POST',
    token: tokenA,
    body: {
      customerName: 'Chief Obi',
      customerPhone: '08035556666',
      items: [{ description: 'Swiss Voile Lace', qty: 1, unitPriceKobo: 5_000_000, discountKobo: 0 }],
      paymentMethod: 'Cash',
      amountPaidKobo: 3_000_000,
      note: 'Part payment',
      soldBy: 'Adaeze',
      issuedDateLagos: '2026-05-10',
      template: 'modern',
      source: 'manual',
    },
  });
  assert.equal(r1Res.status, 201);
  const receipt1 = r1Res.json.receipt;
  assert.equal(receipt1.receiptNumber, 'ADF-0001');
  assert.equal(receipt1.status, 'PART_PAID');
  assert.equal(receipt1.balanceDueKobo, 2_000_000);

  // 2. Owner B cannot read, receive-balance, or void Owner A's receipt
  const bReadA = await apiCall(`/api/receipts/${receipt1.id}`, { token: tokenB });
  assert.equal(bReadA.status, 404);

  const bList = await apiCall('/api/receipts', { token: tokenB });
  assert.equal(bList.status, 200);
  assert.equal(bList.json.receipts.length, 0);

  const bReceiveA = await apiCall(`/api/receipts/${receipt1.id}/receive-balance`, {
    method: 'POST',
    token: tokenB,
    body: { amountKobo: 1_000_000, paymentMethod: 'Cash', note: '', soldBy: '' },
  });
  assert.equal(bReceiveA.status, 404);

  const bVoidA = await apiCall(`/api/receipts/${receipt1.id}/void`, {
    method: 'POST',
    token: tokenB,
    body: { reason: 'Malicious void attempt' },
  });
  assert.equal(bVoidA.status, 404);

  // 3. Public receipt endpoint works logged-out and exposes ONLY printed fields
  const pubRes = await apiCall(`/api/rpc/get_public_receipt/${receipt1.publicId}`);
  assert.equal(pubRes.status, 200);
  const pubReceipt = pubRes.json.receipt;
  assert.equal(pubReceipt.receiptNumber, 'ADF-0001');
  assert.equal(pubReceipt.businessName, 'Adaeze Fabrics');
  assert.equal(pubReceipt.totalKobo, 5_000_000);
  // Ensure internal fields are strictly omitted from public payload
  assert.equal('businessId' in pubReceipt, false);
  assert.equal('createdBy' in pubReceipt, false);
  assert.equal('sequenceNumber' in pubReceipt, false);
  assert.equal('initialPaidKobo' in pubReceipt, false);
  assert.equal('source' in pubReceipt, false);

  // 4. Owner A receives balance of ₦20,000 via Transfer -> issues ADF-0002, marks ADF-0001 PAID
  const r2Res = await apiCall(`/api/receipts/${receipt1.id}/receive-balance`, {
    method: 'POST',
    token: tokenA,
    body: {
      amountKobo: 2_000_000,
      paymentMethod: 'Transfer',
      note: 'Final balance',
      soldBy: 'Adaeze',
      issuedDateLagos: '2026-05-10',
    },
  });
  assert.equal(r2Res.status, 201);
  const receipt2 = r2Res.json.receipt;
  assert.equal(receipt2.receiptNumber, 'ADF-0002');
  assert.equal(receipt2.receiptKind, 'BALANCE_PAYMENT');
  assert.equal(r2Res.json.parentReceipt.status, 'PAID');
  assert.equal(r2Res.json.parentReceipt.balanceDueKobo, 0);

  // 5. Voiding the balance receipt ADF-0002 restores parent ADF-0001 balance back to ₦20,000 PART_PAID
  const voidR2 = await apiCall(`/api/receipts/${receipt2.id}/void`, {
    method: 'POST',
    token: tokenA,
    body: { reason: 'Transfer reversed by bank' },
  });
  assert.equal(voidR2.status, 200);
  assert.equal(voidR2.json.receipt.status, 'VOID');

  const checkParent = await apiCall(`/api/receipts/${receipt1.id}`, { token: tokenA });
  assert.equal(checkParent.json.receipt.status, 'PART_PAID');
  assert.equal(checkParent.json.receipt.balanceDueKobo, 2_000_000);

  //Next receipt issued by Owner A is ADF-0003 (gap-free sequential numbering even after void!)
  const r3Res = await apiCall('/api/receipts', {
    method: 'POST',
    token: tokenA,
    body: {
      customerName: 'Walk-in',
      customerPhone: '',
      items: [{ description: 'Silk Scarf', qty: 1, unitPriceKobo: 800_000, discountKobo: 0 }],
      paymentMethod: 'POS',
      amountPaidKobo: 800_000,
      note: '',
      soldBy: 'Adaeze',
      issuedDateLagos: '2026-05-10',
      template: 'compact',
      source: 'manual',
    },
  });
  assert.equal(r3Res.status, 201);
  assert.equal(r3Res.json.receipt.receiptNumber, 'ADF-0003');

  // 6. Private expense proof storage isolation
  const tinyPngBase64 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const uploadA = await apiCall('/api/expenses/proof', {
    method: 'POST',
    token: tokenA,
    body: { dataUrl: tinyPngBase64 },
  });
  assert.equal(uploadA.status, 201);
  const proofPathA = uploadA.json.proofPath as string;
  assert.ok(proofPathA.startsWith(`${userIdA}/`));

  // Owner B cannot fetch Owner A's proof file
  const bFetchProof = await apiCall(`/api/expenses/proof/${encodeURIComponent(proofPathA)}`, {
    token: tokenB,
  });
  assert.equal(bFetchProof.status, 403);

  // Owner B cannot attach Owner A's proofPath to Owner B's expense
  const bForgeProof = await apiCall('/api/expenses', {
    method: 'POST',
    token: tokenB,
    body: {
      entryDate: '2026-05-10',
      amountKobo: 100_000,
      category: 'Transport',
      payee: 'Bolt',
      paymentMethod: 'Cash',
      note: 'Attempt cross-tenant proof attach',
      proofPath: proofPathA,
      source: 'manual',
    },
  });
  assert.equal(bForgeProof.status, 403);

  // Owner A records expense with valid proofPath
  const expARes = await apiCall('/api/expenses', {
    method: 'POST',
    token: tokenA,
    body: {
      entryDate: '2026-05-10',
      amountKobo: 500_000, // ₦5,000 Cash expense
      category: 'Transport',
      payee: 'Dispatch Rider',
      paymentMethod: 'Cash',
      note: 'Delivery to Victoria Island',
      proofPath: proofPathA,
      source: 'manual',
    },
  });
  assert.equal(expARes.status, 201);
  const expenseA = expARes.json.expense;

  // Owner B cannot edit or delete Owner A's expense
  const bEditExpA = await apiCall(`/api/expenses/${expenseA.id}`, {
    method: 'PATCH',
    token: tokenB,
    body: { amountKobo: 1000 },
  });
  assert.equal(bEditExpA.status, 404);

  const bDelExpA = await apiCall(`/api/expenses/${expenseA.id}`, {
    method: 'DELETE',
    token: tokenB,
  });
  assert.equal(bDelExpA.status, 404);

  // 7. Close Day math & closed-day immutability lock
  // On 2026-05-10 for Owner A:
  // Opening Cash: ₦10,000 (1,000,000)
  // ADF-0001 Cash received: +₦30,000 (3,000,000)
  // ADF-0002 Transfer received (+2,000,000) then voided (-2,000,000) -> 0 net
  // ADF-0003 POS received: +₦8,000 (800,000) -> does not affect physical Cash in Hand
  // Transport Expense (Cash): -₦5,000 (500,000)
  // Expected Cash in Hand = 1,000,000 + 3,000,000 - 500,000 = 3,500,000 kobo (₦35,000)
  const cbBeforeClose = await apiCall('/api/cashbook?date=2026-05-10', { token: tokenA });
  assert.equal(cbBeforeClose.status, 200);
  assert.equal(cbBeforeClose.json.dayView.closingCashInHandKobo, 3_500_000);
  assert.equal(cbBeforeClose.json.dayView.posInKobo, 800_000);

  const closeRes = await apiCall('/api/cashbook/close', {
    method: 'POST',
    token: tokenA,
    body: {
      closeDate: '2026-05-10',
      countedCashKobo: 3_450_000, // ₦500 short
      note: 'Closed for the evening',
    },
  });
  assert.equal(closeRes.status, 201);
  assert.equal(closeRes.json.closure.varianceKobo, -50_000);

  // Attempting to add or delete an expense on a closed day returns 409 CLOSED_DAY
  const expOnClosedDay = await apiCall('/api/expenses', {
    method: 'POST',
    token: tokenA,
    body: {
      entryDate: '2026-05-10',
      amountKobo: 100_000,
      category: 'Other',
      payee: '',
      paymentMethod: 'Cash',
      note: 'Late entry',
      source: 'manual',
    },
  });
  assert.equal(expOnClosedDay.status, 409);
  assert.equal(expOnClosedDay.json.code, 'CLOSED_DAY');

  const delOnClosedDay = await apiCall(`/api/expenses/${expenseA.id}`, {
    method: 'DELETE',
    token: tokenA,
  });
  assert.equal(delOnClosedDay.status, 409);

  // Posting a visible correction entry on a closed day succeeds
  const corrRes = await apiCall('/api/cashbook/correction', {
    method: 'POST',
    token: tokenA,
    body: {
      entryDate: '2026-05-10',
      direction: 'OUT',
      amountKobo: 50_000,
      paymentMethod: 'Cash',
      reason: 'Forgot ₦500 pure water expense before closing',
      soldBy: 'Adaeze',
      expenseId: expenseA.id,
    },
  });
  assert.equal(corrRes.status, 201);
  assert.equal(corrRes.json.entry.isCorrection, true);

  // 8. Export-all-data and Delete-account privacy flows
  const exportA = await apiCall('/api/account/export', { token: tokenA });
  assert.equal(exportA.status, 200);
  assert.equal(exportA.json.business.name, 'Adaeze Fabrics');
  assert.equal(exportA.json.receipts.length, 3);
  assert.ok(Array.isArray(exportA.json.ledgerEntries));
  assert.ok(Array.isArray(exportA.json.dayClosures));
  assert.equal(exportA.json.dayClosures.length, 1);

  const delA = await apiCall('/api/account', { method: 'DELETE', token: tokenA });
  assert.equal(delA.status, 200);
  assert.equal(delA.json.ok, true);

  // Token A is immediately invalidated and proof directory is wiped
  const meAfterDel = await apiCall('/api/auth/me', { token: tokenA });
  assert.equal(meAfterDel.status, 401);
  assert.equal(fs.existsSync(path.join(TEST_DATA_DIR, 'expense-proofs', userIdA)), false);
});

test('Input validation and magic-link rate limiting reject malformed or excessive requests', async () => {
  const badMagic = await apiCall('/api/auth/magic-link', {
    method: 'POST',
    body: { email: 'not-an-email' },
  });
  assert.equal(badMagic.status, 400);

  // Hit /api/auth/magic-link until magicLinkLimiter (15 per 5 min) returns 429
  let hit429 = false;
  for (let i = 0; i < 18; i++) {
    const res = await apiCall('/api/auth/magic-link', {
      method: 'POST',
      body: { email: `ratelimit${i}@tallymark.ng` },
    });
    if (res.status === 429) {
      hit429 = true;
      break;
    }
  }
  assert.equal(hit429, true, 'Expected 429 from magic-link rate limiter');
});
