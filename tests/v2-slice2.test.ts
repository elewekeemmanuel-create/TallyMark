import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import test, { after, before } from 'node:test';
import cookieParser from 'cookie-parser';
import express from 'express';
import { PDFDocument } from 'pdf-lib';

// Isolate SQLite data directory & private proof dir before importing db/routes
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tallymark-v2-slice2-'));
process.env.TALLYMARK_DATA_DIR = TEST_DATA_DIR;
process.env.VAPID_PUBLIC_KEY = 'BTestPublicKeyForV2Slice2UnitTests0123456789abcdefghijklmnopqrstuvwxyzABCDEF';
process.env.VAPID_PRIVATE_KEY = 'TestPrivateKeyForV2Slice2UnitTests0123456789';
process.env.VAPID_SUBJECT = 'mailto:alerts@tallymark.test';
process.env.RETENTION_CRON_SECRET = 'test-retention-secret-90d';

const { db } = await import('../src/server/db.ts');
const { createApiRouter } = await import('../src/server/routes.ts');
const { setPushSenderForTests } = await import('../src/server/v2/push.ts');
const { runProofRetentionJob } = await import('../src/server/v2/retention.ts');
const { resolveConfinedProofPath, verifyAndSanitizeProof } = await import(
  '../src/server/v2/proofSecurity.ts'
);

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
  delete process.env.DISABLE_PUBLIC_CLAIMS;
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
    rawBody?: Buffer;
    headers?: Record<string, string>;
    ip?: string;
    base?: string;
  } = {}
) {
  const headers: Record<string, string> = { ...(options.headers || {}) };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.ip) headers['X-Forwarded-For'] = options.ip;
  let body: BodyInit | undefined;
  if (options.rawBody !== undefined) {
    body = new Uint8Array(options.rawBody);
  } else if (options.body !== undefined) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    body = JSON.stringify(options.body);
  }
  const res = await fetch(`${options.base || baseUrl}${endpoint}`, {
    method: options.method || 'GET',
    headers,
    body,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString('utf8');
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, json, text, buf };
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

async function createShopAndSentInvoice(email: string, totalKobo = 500_000) {
  const ml = await apiCall('/api/auth/magic-link', {
    method: 'POST',
    body: { email, name: 'Ada Owner' },
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
      name: 'Ada Fabrics PH',
      address: '21 Ikwerre Rd, Port Harcourt',
      phone: '08035550101',
      email,
      brandColor: '#064E3B',
      receiptPrefix: 'RCT-',
      currency: 'NGN',
      vatEnabled: false,
      vatMode: 'exclusive',
      openingCashKobo: 0,
    },
  });
  assert.equal(biz.status, 201);

  const mod = await apiCall('/api/v2/settings/module', {
    method: 'PATCH',
    token,
    body: { enabled: true },
  });
  assert.equal(mod.status, 200);

  const inv = await apiCall('/api/v2/invoices', {
    method: 'POST',
    token,
    body: {
      customerName: 'Chidi Stores',
      customerPhone: '08090001111',
      termsKind: 'net_7',
      lines: [
        {
          description: 'Ankara Lace Bundle',
          qtyThousandths: 1000,
          unitPriceKobo: totalKobo,
          discountKobo: 0,
        },
      ],
      sendNow: true,
    },
  });
  assert.equal(inv.status, 201);
  return { token, business: biz.json.business, invoice: inv.json.invoice };
}

function buildMinimalJpegWithExif(): Buffer {
  // Minimal JPEG: SOI + APP1 (EXIF with GPS marker) + COM + SOF0 + SOS + EOI
  const soi = Buffer.from([0xff, 0xd8]);
  const exifPayload = Buffer.from('Exif\0\0GPS_SECRET_LOCATION_LAGOS', 'utf8');
  const app1Len = Buffer.alloc(2);
  app1Len.writeUInt16BE(exifPayload.length + 2, 0);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), app1Len, exifPayload]);

  const comPayload = Buffer.from('PRIVATE_CAMERA_COMMENT', 'utf8');
  const comLen = Buffer.alloc(2);
  comLen.writeUInt16BE(comPayload.length + 2, 0);
  const com = Buffer.concat([Buffer.from([0xff, 0xfe]), comLen, comPayload]);

  // Minimal DQT + SOF0 (1x1 grayscale) + SOS + entropy bytes + EOI
  const dqt = Buffer.from([0xff, 0xdb, 0x00, 0x05, 0x00, 0x10, 0x10]);
  const sof0 = Buffer.from([
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  ]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x00, 0x12, 0x34]);
  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([soi, app1, com, dqt, sof0, sos, eoi]);
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function buildMinimalPngWithTextMetadata(): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.from([
    0x00, 0x00, 0x00, 0x01, // 1px wide
    0x00, 0x00, 0x00, 0x01, // 1px high
    0x08, 0x02, 0x00, 0x00, 0x00,
  ]);
  const textMeta = pngChunk('tEXt', Buffer.from('Author\0SECRET_EXIF_PERSON', 'utf8'));
  const idat = pngChunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]));
  const iend = pngChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, pngChunk('IHDR', ihdrData), textMeta, idat, iend]);
}

function buildMinimalWebpWithExif(): Buffer {
  const vp8Data = Buffer.from([0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x01, 0x00, 0x01, 0x00]);
  const vp8Chunk = Buffer.concat([
    Buffer.from('VP8 ', 'ascii'),
    Buffer.from([vp8Data.length, 0, 0, 0]),
    vp8Data,
  ]);
  const exifData = Buffer.from('SECRET_WEBP_EXIF_DATA!', 'utf8');
  const exifLen = Buffer.alloc(4);
  exifLen.writeUInt32LE(exifData.length, 0);
  const exifChunk = Buffer.concat([Buffer.from('EXIF', 'ascii'), exifLen, exifData]);

  const body = Buffer.concat([Buffer.from('WEBP', 'ascii'), vp8Chunk, exifChunk]);
  const riffLen = Buffer.alloc(4);
  riffLen.writeUInt32LE(body.length, 0);
  return Buffer.concat([Buffer.from('RIFF', 'ascii'), riffLen, body]);
}

async function buildMinimalPdfWithMetadata(): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle('Secret Bank Slip');
  pdfDoc.setAuthor('Private Payer Name');
  pdfDoc.setSubject('Internal Meta');
  const page = pdfDoc.addPage([200, 200]);
  page.drawText('Transfer receipt');
  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

// =========================================================================
// 1. LOGGED-OUT CLAIM: LEAVES INVOICE UNPAID, NO MONEY ENTRY, STATUS MESSAGE
// =========================================================================
test('1. Logged-out claim leaves invoice unpaid, creates zero ledger entries, shows awaiting confirmation', async () => {
  const { token, business, invoice } = await createShopAndSentInvoice('claim1@example.com', 500_000);

  const bot = await getSolvedBotCheck('198.51.100.11');
  const submit = await apiCall(`/api/v2/public/invoices/${invoice.publicId}/claims`, {
    method: 'POST',
    ip: '198.51.100.11',
    body: {
      payerName: 'Chidi Okafor',
      amountKobo: 250_000,
      reference: 'NIP-REF-001',
      hasProof: false,
      ...bot,
    },
  });

  assert.equal(submit.status, 201);
  assert.equal(submit.json.status, 'PENDING');
  assert.equal(submit.json.message, 'Payment reported, awaiting confirmation');
  assert.match(submit.json.claimRef, /^CLM-[A-F0-9]{6}$/);

  // Invoice remains SENT & unpaid
  const invCheck = await apiCall(`/api/v2/invoices/${invoice.id}`, { token });
  assert.equal(invCheck.json.invoice.status, 'SENT');
  assert.equal(invCheck.json.invoice.amountPaidKobo, 0);
  assert.equal(invCheck.json.invoice.balanceDueKobo, 500_000);

  // Zero money entries in ledger
  const ledgerRows = db
    .prepare('SELECT COUNT(*) AS cnt FROM ledger_entries WHERE business_id = ?')
    .get(business.id) as { cnt: number };
  assert.equal(Number(ledgerRows.cnt), 0);

  // Public invoice page reflects pending claim status without marking paid
  const pub = await apiCall(`/api/v2/public/invoices/${invoice.publicId}`, { ip: '198.51.100.11' });
  assert.equal(pub.status, 200);
  assert.equal(pub.json.invoice.status, 'SENT');
  assert.equal(pub.json.invoice.pendingClaimsCount, 1);
  assert.equal(pub.json.invoice.latestPendingClaimRef, submit.json.claimRef);
});

// =========================================================================
// 2. LIMITS: 3 PENDING/INVOICE, 5/HR & 20/DAY/IP, OVERPAYMENT & MISSING REF/PROOF
// =========================================================================
test('2. Limits enforced: overpayment, neither ref nor proof, 3 pending per invoice, 5/hr and 20/day per IP', async () => {
  const { invoice } = await createShopAndSentInvoice('claim2@example.com', 300_000);

  // Overpayment (> remaining balance) rejected
  const botOver = await getSolvedBotCheck('198.51.100.21');
  const overRes = await apiCall(`/api/v2/public/invoices/${invoice.publicId}/claims`, {
    method: 'POST',
    ip: '198.51.100.21',
    body: {
      payerName: 'Over Payer',
      amountKobo: 300_001,
      reference: 'OVER-1',
      hasProof: false,
      ...botOver,
    },
  });
  assert.equal(overRes.status, 400);

  // Neither reference nor proof rejected
  const botEmpty = await getSolvedBotCheck('198.51.100.22');
  const emptyRes = await apiCall(`/api/v2/public/invoices/${invoice.publicId}/claims`, {
    method: 'POST',
    ip: '198.51.100.22',
    body: {
      payerName: 'No Ref Payer',
      amountKobo: 100_000,
      reference: '',
      hasProof: false,
      ...botEmpty,
    },
  });
  assert.equal(emptyRes.status, 400);

  // Max 3 pending claims per invoice (4th fails with 429)
  for (let i = 1; i <= 3; i += 1) {
    const ip = `198.51.100.${30 + i}`;
    const bot = await getSolvedBotCheck(ip);
    const res = await apiCall(`/api/v2/public/invoices/${invoice.publicId}/claims`, {
      method: 'POST',
      ip,
      body: {
        payerName: `Payer ${i}`,
        amountKobo: 50_000,
        reference: `REF-LIMIT-${i}`,
        hasProof: false,
        ...bot,
      },
    });
    assert.equal(res.status, 201);
  }
  const bot4 = await getSolvedBotCheck('198.51.100.39');
  const fourth = await apiCall(`/api/v2/public/invoices/${invoice.publicId}/claims`, {
    method: 'POST',
    ip: '198.51.100.39',
    body: {
      payerName: 'Payer 4',
      amountKobo: 50_000,
      reference: 'REF-LIMIT-4',
      hasProof: false,
      ...bot4,
    },
  });
  assert.equal(fourth.status, 429);

  // 5 per hour per IP (across multiple invoices) -> 6th fails with 429
  const ipHour = '203.0.113.55';
  const shopB = await createShopAndSentInvoice('claim2b@example.com', 900_000);
  const inv2 = await apiCall('/api/v2/invoices', {
    method: 'POST',
    token: shopB.token,
    body: {
      customerName: 'Second Cust',
      termsKind: 'net_7',
      lines: [{ description: 'Item', qtyThousandths: 1000, unitPriceKobo: 900_000, discountKobo: 0 }],
      sendNow: true,
    },
  });
  const pubIds = [shopB.invoice.publicId, inv2.json.invoice.publicId];
  for (let i = 0; i < 5; i += 1) {
    const bot = await getSolvedBotCheck(ipHour);
    const r = await apiCall(`/api/v2/public/invoices/${pubIds[i < 3 ? 0 : 1]}/claims`, {
      method: 'POST',
      ip: ipHour,
      body: {
        payerName: `Hourly ${i}`,
        amountKobo: 10_000,
        reference: `HR-${i}`,
        hasProof: false,
        ...bot,
      },
    });
    assert.equal(r.status, 201);
  }
  const bot6 = await getSolvedBotCheck(ipHour);
  const sixthHour = await apiCall(`/api/v2/public/invoices/${pubIds[1]}/claims`, {
    method: 'POST',
    ip: ipHour,
    body: {
      payerName: 'Hourly 6',
      amountKobo: 10_000,
      reference: 'HR-6',
      hasProof: false,
      ...bot6,
    },
  });
  assert.equal(sixthHour.status, 429);

  // 20 per day per IP: seed day counter at 20 for a fresh IP, next call returns 429
  const ipDay = '203.0.113.77';
  const { hashClientIp } = await import('../src/server/v2/botCheck.ts');
  const dayBucket = `claim_ip_day:${hashClientIp(ipDay)}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const dayStart = Math.floor(nowSec / 86400) * 86400;
  db.prepare(
    'INSERT OR REPLACE INTO rate_limits (bucket_key, window_start, hit_count, expires_at) VALUES (?, ?, ?, ?)'
  ).run(dayBucket, dayStart, 20, dayStart + 86400);

  const botDay = await getSolvedBotCheck(ipDay);
  const overDay = await apiCall(`/api/v2/public/invoices/${pubIds[1]}/claims`, {
    method: 'POST',
    ip: ipDay,
    body: {
      payerName: 'Day 21',
      amountKobo: 10_000,
      reference: 'DAY-21',
      hasProof: false,
      ...botDay,
    },
  });
  assert.equal(overDay.status, 429);
});

// =========================================================================
// 3. UPLOAD TOKEN: SINGLE-USE, CLAIM-BOUND, 5-MIN EXPIRY
// =========================================================================
test('3. Upload token is single-use, bound to its claim, and expires after 5 minutes', async () => {
  const { invoice } = await createShopAndSentInvoice('claim3@example.com', 400_000);
  const jpeg = buildMinimalJpegWithExif();

  // Create claim A & claim B with upload tokens
  const botA = await getSolvedBotCheck('198.51.100.61');
  const claimA = await apiCall(`/api/v2/public/invoices/${invoice.publicId}/claims`, {
    method: 'POST',
    ip: '198.51.100.61',
    body: {
      payerName: 'Claim A',
      amountKobo: 100_000,
      reference: '',
      hasProof: true,
      ...botA,
    },
  });
  assert.equal(claimA.status, 201);
  assert.ok(claimA.json.uploadToken);
  assert.equal(claimA.json.uploadExpiresInSeconds, 300);

  const botB = await getSolvedBotCheck('198.51.100.62');
  const claimB = await apiCall(`/api/v2/public/invoices/${invoice.publicId}/claims`, {
    method: 'POST',
    ip: '198.51.100.62',
    body: {
      payerName: 'Claim B',
      amountKobo: 100_000,
      reference: '',
      hasProof: true,
      ...botB,
    },
  });
  assert.equal(claimB.status, 201);

  // Cross-claim token use fails (token A on claim B)
  const cross = await apiCall(`/api/v2/public/claims/${claimB.json.claimId}/proof`, {
    method: 'POST',
    ip: '198.51.100.61',
    headers: {
      'Content-Type': 'image/jpeg',
      'x-upload-token': claimA.json.uploadToken,
    },
    rawBody: jpeg,
  });
  assert.equal(cross.status, 403);

  // Valid upload for claim A succeeds once
  const okUp = await apiCall(`/api/v2/public/claims/${claimA.json.claimId}/proof`, {
    method: 'POST',
    ip: '198.51.100.61',
    headers: {
      'Content-Type': 'image/jpeg',
      'x-upload-token': claimA.json.uploadToken,
    },
    rawBody: jpeg,
  });
  assert.equal(okUp.status, 200);
  assert.equal(okUp.json.uploaded, true);

  // Reusing the same upload token fails (single-use)
  const reuse = await apiCall(`/api/v2/public/claims/${claimA.json.claimId}/proof`, {
    method: 'POST',
    ip: '198.51.100.61',
    headers: {
      'Content-Type': 'image/jpeg',
      'x-upload-token': claimA.json.uploadToken,
    },
    rawBody: jpeg,
  });
  assert.equal(reuse.status, 403);

  // Expired upload token (> 5 min) fails
  db.prepare('UPDATE payment_claims SET upload_token_expires_at = ? WHERE id = ?').run(
    new Date(Date.now() - 60_000).toISOString(),
    claimB.json.claimId
  );
  const expired = await apiCall(`/api/v2/public/claims/${claimB.json.claimId}/proof`, {
    method: 'POST',
    ip: '198.51.100.62',
    headers: {
      'Content-Type': 'image/jpeg',
      'x-upload-token': claimB.json.uploadToken,
    },
    rawBody: jpeg,
  });
  assert.equal(expired.status, 403);
});

// =========================================================================
// 4. PROOF SECURITY: MAGIC BYTES, EXECUTABLES, POLYGLOTS, METADATA STRIP, SIGNED URL
// =========================================================================
test('4. Proof security rejects wrong types, >5MB, executables, polyglots; strips metadata; random names; private signed URL', async () => {
  // Unit verification of magic bytes + metadata stripping + polyglots
  const jpegWithExif = buildMinimalJpegWithExif();
  const cleanJpeg = await verifyAndSanitizeProof(jpegWithExif);
  assert.equal(cleanJpeg.mime, 'image/jpeg');
  assert.equal(cleanJpeg.sanitizedBytes.toString('utf8').includes('GPS_SECRET_LOCATION'), false);
  assert.equal(cleanJpeg.sanitizedBytes.toString('utf8').includes('PRIVATE_CAMERA_COMMENT'), false);

  const pngWithText = buildMinimalPngWithTextMetadata();
  const cleanPng = await verifyAndSanitizeProof(pngWithText);
  assert.equal(cleanPng.mime, 'image/png');
  assert.equal(cleanPng.sanitizedBytes.toString('utf8').includes('SECRET_EXIF_PERSON'), false);

  const webpWithExif = buildMinimalWebpWithExif();
  const cleanWebp = await verifyAndSanitizeProof(webpWithExif);
  assert.equal(cleanWebp.mime, 'image/webp');
  assert.equal(cleanWebp.sanitizedBytes.toString('utf8').includes('SECRET_WEBP_EXIF_DATA'), false);

  const pdfWithMeta = await buildMinimalPdfWithMetadata();
  const cleanPdf = await verifyAndSanitizeProof(pdfWithMeta);
  assert.equal(cleanPdf.mime, 'application/pdf');
  const reloadedPdf = await PDFDocument.load(cleanPdf.sanitizedBytes);
  assert.equal(reloadedPdf.getAuthor() || '', '');
  assert.equal(reloadedPdf.getTitle() || '', '');

  // Wrong types rejected (HTML / SVG / plain text)
  await assert.rejects(() => verifyAndSanitizeProof(Buffer.from('<svg onload=alert(1)></svg>')));
  await assert.rejects(() => verifyAndSanitizeProof(Buffer.from('<html><script>alert(1)</script></html>')));

  // Oversized file (> 5 MB) rejected
  const oversized = Buffer.alloc(5 * 1024 * 1024 + 128, 0x41);
  oversized[0] = 0xff;
  oversized[1] = 0xd8;
  await assert.rejects(() => verifyAndSanitizeProof(oversized), /5 MB/);

  // Renamed executables rejected (PE MZ & ELF)
  await assert.rejects(() => verifyAndSanitizeProof(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00])));
  await assert.rejects(() => verifyAndSanitizeProof(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01])));

  // Polyglot files rejected:
  // a) JPEG + appended ZIP archive after EOI
  const jpegPolyglotZip = Buffer.concat([jpegWithExif, Buffer.from('PK\x03\x04fake-zip-payload')]);
  await assert.rejects(
    () => verifyAndSanitizeProof(jpegPolyglotZip),
    /trailing|polyglot|appended|unsafe embedded/i
  );

  // b) PNG + appended script after IEND
  const pngPolyglot = Buffer.concat([pngWithText, Buffer.from('<script>evil()</script>')]);
  await assert.rejects(
    () => verifyAndSanitizeProof(pngPolyglot),
    /trailing|polyglot|unsafe embedded/i
  );

  // c) PDF containing active /JavaScript action
  const badPdf = Buffer.concat([pdfWithMeta, Buffer.from('\n/JavaScript (app.alert(1))')]);
  await assert.rejects(() => verifyAndSanitizeProof(badPdf), /active scripts|unsupported/i);

  // End-to-end private storage + random filename + unreachable without signed owner URL
  const { token, invoice } = await createShopAndSentInvoice('claim4@example.com', 200_000);
  const otherShop = await createShopAndSentInvoice('claim4other@example.com', 200_000);

  const bot = await getSolvedBotCheck('198.51.100.81');
  const claim = await apiCall(`/api/v2/public/invoices/${invoice.publicId}/claims`, {
    method: 'POST',
    ip: '198.51.100.81',
    body: {
      payerName: 'Proof Payer',
      amountKobo: 200_000,
      reference: '',
      hasProof: true,
      ...bot,
    },
  });
  assert.equal(claim.status, 201);

  const upload = await apiCall(`/api/v2/public/claims/${claim.json.claimId}/proof`, {
    method: 'POST',
    ip: '198.51.100.81',
    headers: { 'Content-Type': 'image/jpeg', 'x-upload-token': claim.json.uploadToken },
    rawBody: jpegWithExif,
  });
  assert.equal(upload.status, 200);

  // Verify stored filename is random hex and metadata was stripped on disk
  const row = db
    .prepare('SELECT proof_path FROM payment_claims WHERE id = ?')
    .get(claim.json.claimId) as { proof_path: string };
  assert.match(row.proof_path, /^[a-z0-9-]+\/[a-f0-9]{32}\.jpg$/);
  const absPath = resolveConfinedProofPath(row.proof_path);
  assert.ok(absPath && fs.existsSync(absPath));
  const diskBytes = fs.readFileSync(absPath);
  assert.equal(diskBytes.toString('utf8').includes('GPS_SECRET_LOCATION'), false);

  // Direct unsigned proof URL fails (403)
  const unsigned = await apiCall(`/api/v2/claims/${claim.json.claimId}/proof-file`);
  assert.equal(unsigned.status, 403);

  // Tampered signature fails (403)
  const tampered = await apiCall(
    `/api/v2/claims/${claim.json.claimId}/proof-file?exp=${Math.floor(Date.now() / 1000) + 120}&sig=${'a'.repeat(64)}`
  );
  assert.equal(tampered.status, 403);

  // Another business owner cannot request a signed URL (404)
  const otherOwnerUrl = await apiCall(`/api/v2/claims/${claim.json.claimId}/proof-url`, {
    token: otherShop.token,
  });
  assert.equal(otherOwnerUrl.status, 404);

  // Legitimate owner obtains signed URL and downloads proof
  const ownerUrl = await apiCall(`/api/v2/claims/${claim.json.claimId}/proof-url`, { token });
  assert.equal(ownerUrl.status, 200);
  assert.ok(ownerUrl.json.url.includes('sig='));

  const fetchedProof = await apiCall(ownerUrl.json.url);
  assert.equal(fetchedProof.status, 200);
  assert.equal(fetchedProof.headers.get('content-type'), 'image/jpeg');
  assert.equal(fetchedProof.headers.get('x-content-type-options'), 'nosniff');
});

// =========================================================================
// 5. BOT CHECK REQUIRED & RATE LIMITS SURVIVE SERVER RESTART
// =========================================================================
test('5. Bot check required (missing/invalid/replayed rejected) and rate limits survive server restart', async () => {
  const { invoice } = await createShopAndSentInvoice('claim5@example.com', 600_000);

  // Missing bot solution rejected
  const noBot = await apiCall(`/api/v2/public/invoices/${invoice.publicId}/claims`, {
    method: 'POST',
    ip: '198.51.100.91',
    body: {
      payerName: 'Bot',
      amountKobo: 50_000,
      reference: 'BOT-1',
      hasProof: false,
      botChallenge: 'bad',
      botSolution: 'bad',
    },
  });
  assert.equal(noBot.status, 400);

  // Honeypot filled rejected
  const hpBot = await getSolvedBotCheck('198.51.100.92');
  const hpRes = await apiCall(`/api/v2/public/invoices/${invoice.publicId}/claims`, {
    method: 'POST',
    ip: '198.51.100.92',
    body: {
      payerName: 'Spammer',
      amountKobo: 50_000,
      reference: 'HP-1',
      hasProof: false,
      website: 'https://spam.example',
      ...hpBot,
    },
  });
  assert.equal(hpRes.status, 400);

  // Replay of a previously used bot challenge rejected
  const ipReplay = '198.51.100.93';
  const replayBot = await getSolvedBotCheck(ipReplay);
  const firstUse = await apiCall(`/api/v2/public/invoices/${invoice.publicId}/claims`, {
    method: 'POST',
    ip: ipReplay,
    body: {
      payerName: 'Real User',
      amountKobo: 50_000,
      reference: 'REP-1',
      hasProof: false,
      ...replayBot,
    },
  });
  assert.equal(firstUse.status, 201);

  const secondUse = await apiCall(`/api/v2/public/invoices/${invoice.publicId}/claims`, {
    method: 'POST',
    ip: ipReplay,
    body: {
      payerName: 'Replay User',
      amountKobo: 50_000,
      reference: 'REP-2',
      hasProof: false,
      ...replayBot,
    },
  });
  assert.equal(secondUse.status, 400);

  // Rate limits survive a full server restart (brand new Express instance against same DB)
  const ipRestart = '203.0.113.200';
  const shopR = await createShopAndSentInvoice('claim5r@example.com', 900_000);
  const invR2 = await apiCall('/api/v2/invoices', {
    method: 'POST',
    token: shopR.token,
    body: {
      customerName: 'Restart Cust',
      termsKind: 'net_7',
      lines: [{ description: 'Item', qtyThousandths: 1000, unitPriceKobo: 900_000, discountKobo: 0 }],
      sendNow: true,
    },
  });

  // Use 5/hr quota on Server Instance 1
  for (let i = 0; i < 5; i += 1) {
    const b = await getSolvedBotCheck(ipRestart);
    const targetPub = i < 3 ? shopR.invoice.publicId : invR2.json.invoice.publicId;
    const r = await apiCall(`/api/v2/public/invoices/${targetPub}/claims`, {
      method: 'POST',
      ip: ipRestart,
      body: {
        payerName: `Restart ${i}`,
        amountKobo: 10_000,
        reference: `RST-${i}`,
        hasProof: false,
        ...b,
      },
    });
    assert.equal(r.status, 201);
  }

  // Spin up fresh Server Instance 2 (simulating server restart — fresh memory!)
  const freshApp = makeApp();
  let freshBase = '';
  const freshServer = await new Promise<ReturnType<express.Express['listen']>>((resolve) => {
    const s = freshApp.listen(0, '127.0.0.1', () => {
      const addr = s.address() as AddressInfo;
      freshBase = `http://127.0.0.1:${addr.port}`;
      resolve(s);
    });
  });

  try {
    const bAfter = await getSolvedBotCheck(ipRestart, freshBase);
    const blocked = await apiCall(`/api/v2/public/invoices/${invR2.json.invoice.publicId}/claims`, {
      method: 'POST',
      ip: ipRestart,
      base: freshBase,
      body: {
        payerName: 'After Restart',
        amountKobo: 10_000,
        reference: 'RST-6',
        hasProof: false,
        ...bAfter,
      },
    });
    assert.equal(blocked.status, 429);
  } finally {
    await new Promise<void>((resolve) => freshServer.close(() => resolve()));
  }
});

// =========================================================================
// 6. OWNER CONFIRM (RECORD_PAYMENT + RECEIPT), DUPLICATE WARNING, PRIVATE REJECT
// =========================================================================
test('6. Owner confirm records payment & issues receipt; duplicate warning fires; Reject keeps reason private', async () => {
  const { token, invoice } = await createShopAndSentInvoice('claim6@example.com', 400_000);

  // Submit 2 claims with same amount & ref -> duplicate warning must appear
  const bot1 = await getSolvedBotCheck('198.51.100.111');
  const c1 = await apiCall(`/api/v2/public/invoices/${invoice.publicId}/claims`, {
    method: 'POST',
    ip: '198.51.100.111',
    body: {
      payerName: 'Emeka Eze',
      amountKobo: 150_000,
      reference: 'DUP-REF-77',
      hasProof: false,
      ...bot1,
    },
  });
  assert.equal(c1.status, 201);

  const bot2 = await getSolvedBotCheck('198.51.100.112');
  const c2 = await apiCall(`/api/v2/public/invoices/${invoice.publicId}/claims`, {
    method: 'POST',
    ip: '198.51.100.112',
    body: {
      payerName: 'Emeka Eze',
      amountKobo: 150_000,
      reference: 'DUP-REF-77',
      hasProof: false,
      ...bot2,
    },
  });
  assert.equal(c2.status, 201);

  const list = await apiCall('/api/v2/claims?status=PENDING', { token });
  assert.equal(list.status, 200);
  assert.equal(list.json.claims.length, 2);
  for (const cl of list.json.claims) {
    assert.ok(cl.duplicateWarning, 'Duplicate warning should be present on repeated amount/ref');
    assert.match(cl.duplicateWarning.reason, /within 7 days/i);
  }

  // Owner confirms claim 1 with edited amount (₦1,400.00 instead of ₦1,500.00)
  const confirmed = await apiCall(`/api/v2/claims/${c1.json.claimId}/confirm`, {
    method: 'POST',
    token,
    body: {
      amountKobo: 140_000,
      paymentMethod: 'Transfer',
    },
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.json.claim.status, 'CONFIRMED');
  assert.equal(confirmed.json.payment.amountKobo, 140_000);
  assert.ok(confirmed.json.receipt?.receiptNumber);
  assert.equal(confirmed.json.debt.balanceDueKobo, 260_000);
  assert.equal(confirmed.json.debt.status, 'PART_PAID');

  // Owner rejects duplicate claim 2 with private internal reason
  const privateReason = 'INTERNAL: Duplicate transfer alert, already credited on first slip';
  const rejected = await apiCall(`/api/v2/claims/${c2.json.claimId}/reject`, {
    method: 'POST',
    token,
    body: { reason: privateReason },
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.json.claim.status, 'REJECTED');
  assert.equal(rejected.json.claim.decisionReason, privateReason);

  // Public invoice page NEVER leaks private rejection reason!
  const pubAfter = await apiCall(`/api/v2/public/invoices/${invoice.publicId}`, {
    ip: '198.51.100.115',
  });
  assert.equal(pubAfter.status, 200);
  assert.equal(pubAfter.json.invoice.pendingClaimsCount, 0);
  assert.equal(pubAfter.json.invoice.hasRejectedClaim, true);
  assert.equal(pubAfter.text.includes('INTERNAL'), false);
  assert.equal(pubAfter.text.includes('Duplicate transfer alert'), false);
});

// =========================================================================
// 7. OPT-IN WEB PUSH: NON-PII PAYLOAD, DEAD SUB REMOVAL, BADGE FALLBACK
// =========================================================================
test('7. Web Push is opt-in, zero-PII payload, removes dead 404/410 subs, and badge works when push is off', async () => {
  const { token, business, invoice } = await createShopAndSentInvoice('claim7@example.com', 300_000);

  // Opt-in: zero subscriptions by default, badge works while push is off
  const pushStatus0 = await apiCall('/api/v2/push/status', { token });
  assert.equal(pushStatus0.status, 200);
  assert.equal(pushStatus0.json.subscribedCount, 0);

  const botOff = await getSolvedBotCheck('198.51.100.121');
  const claimOff = await apiCall(`/api/v2/public/invoices/${invoice.publicId}/claims`, {
    method: 'POST',
    ip: '198.51.100.121',
    body: {
      payerName: 'Sensitive Customer Name',
      amountKobo: 123_400,
      reference: 'SECRET-BANK-REF',
      hasProof: false,
      ...botOff,
    },
  });
  assert.equal(claimOff.status, 201);

  // Badge count works even with push OFF
  const sumOff = await apiCall('/api/v2/summary', { token });
  assert.equal(sumOff.status, 200);
  assert.equal(sumOff.json.summary.pendingClaimsCount, 1);

  // Now opt-in two subscriptions (1 healthy, 1 dead returning 410 Gone)
  const healthyEndpoint = 'https://fcm.googleapis.com/fcm/send/healthy-sub-123';
  const deadEndpoint = 'https://fcm.googleapis.com/fcm/send/dead-sub-410';

  for (const ep of [healthyEndpoint, deadEndpoint]) {
    const sub = await apiCall('/api/v2/push/subscribe', {
      method: 'POST',
      token,
      body: {
        endpoint: ep,
        keys: {
          p256dh: 'BTestP256dhKeyValue0123456789abcdef',
          auth: 'TestAuthSecret012345',
        },
      },
    });
    assert.equal(sub.status, 201);
  }

  // Reject unsafe local SSRF push endpoint
  const ssrfSub = await apiCall('/api/v2/push/subscribe', {
    method: 'POST',
    token,
    body: {
      endpoint: 'http://127.0.0.1:8080/internal',
      keys: { p256dh: 'BTestP256dhKeyValue0123456789abcdef', auth: 'TestAuthSecret012345' },
    },
  });
  assert.equal(ssrfSub.status, 400);

  const sentPayloads: Array<{ endpoint: string; payload: string }> = [];
  setPushSenderForTests(async (sub, payload) => {
    sentPayloads.push({ endpoint: sub.endpoint, payload });
    if (sub.endpoint === deadEndpoint) {
      const err: any = new Error('Gone');
      err.statusCode = 410;
      throw err;
    }
  });

  const botPush = await getSolvedBotCheck('198.51.100.122');
  const claimPush = await apiCall(`/api/v2/public/invoices/${invoice.publicId}/claims`, {
    method: 'POST',
    ip: '198.51.100.122',
    body: {
      payerName: 'Ngozi Private Person',
      amountKobo: 99_900,
      reference: 'PRIVATE-REF-99',
      hasProof: false,
      ...botPush,
    },
  });
  assert.equal(claimPush.status, 201);

  // Give fire-and-forget push dispatch a tick to finish
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(sentPayloads.length, 2);
  for (const item of sentPayloads) {
    // Payload MUST contain zero personal data (no customer name, payer name, amount, phone, or reference)
    assert.equal(item.payload.includes('Ngozi'), false);
    assert.equal(item.payload.includes('Chidi'), false);
    assert.equal(item.payload.includes('999'), false);
    assert.equal(item.payload.includes('PRIVATE-REF'), false);
    const parsed = JSON.parse(item.payload);
    assert.equal(parsed.body, `New payment report on ${invoice.invoiceNumber}`);
    assert.equal(parsed.url, '/app/claims');
  }

  // Dead 410 subscription must be removed automatically; healthy subscription remains
  const remainingSubs = db
    .prepare('SELECT endpoint FROM push_subscriptions WHERE business_id = ?')
    .all(business.id) as Array<{ endpoint: string }>;
  assert.equal(remainingSubs.length, 1);
  assert.equal(remainingSubs[0].endpoint, healthyEndpoint);

  setPushSenderForTests(null);
});

// =========================================================================
// 8. BOTH KILL SWITCHES RETURN 503 IMMEDIATELY
// =========================================================================
test('8. Both kill switches (DISABLE_PUBLIC_CLAIMS and DISABLE_PUBLIC_QUOTE_ACTIONS) return 503 immediately', async () => {
  const { invoice } = await createShopAndSentInvoice('claim8@example.com', 200_000);

  process.env.DISABLE_PUBLIC_CLAIMS = 'true';
  process.env.DISABLE_PUBLIC_QUOTE_ACTIONS = 'true';
  try {
    const claimBlocked = await apiCall(`/api/v2/public/invoices/${invoice.publicId}/claims`, {
      method: 'POST',
      ip: '198.51.100.140',
      body: { payerName: 'Test', amountKobo: 1000, reference: 'X' },
    });
    assert.equal(claimBlocked.status, 503);

    const proofBlocked = await apiCall('/api/v2/public/claims/any-id/proof', {
      method: 'POST',
      ip: '198.51.100.140',
      headers: { 'Content-Type': 'image/jpeg', 'x-upload-token': 'a'.repeat(64) },
      rawBody: Buffer.from([0xff, 0xd8]),
    });
    assert.equal(proofBlocked.status, 503);

    const quoteAcceptBlocked = await apiCall('/api/v2/public/quotes/somepublicid123456/accept', {
      method: 'POST',
      ip: '198.51.100.140',
      body: {},
    });
    assert.equal(quoteAcceptBlocked.status, 503);

    const quoteDeclineBlocked = await apiCall('/api/v2/public/quotes/somepublicid123456/decline', {
      method: 'POST',
      ip: '198.51.100.140',
      body: {},
    });
    assert.equal(quoteDeclineBlocked.status, 503);
  } finally {
    delete process.env.DISABLE_PUBLIC_CLAIMS;
    delete process.env.DISABLE_PUBLIC_QUOTE_ACTIONS;
  }
});

// =========================================================================
// 9. RETENTION JOB DELETES PROOFS 90 DAYS AFTER DECISION, KEEPS METADATA
// =========================================================================
test('9. Retention job deletes proofs 90 days after decision while keeping claim metadata and preserving recent proofs', async () => {
  const { token, invoice } = await createShopAndSentInvoice('claim9@example.com', 400_000);
  const jpeg = buildMinimalJpegWithExif();

  // Create two claims with uploaded proofs and decide both
  const botOld = await getSolvedBotCheck('198.51.100.151');
  const oldClaim = await apiCall(`/api/v2/public/invoices/${invoice.publicId}/claims`, {
    method: 'POST',
    ip: '198.51.100.151',
    body: { payerName: 'Old Claim', amountKobo: 100_000, reference: 'OLD-90', hasProof: true, ...botOld },
  });
  await apiCall(`/api/v2/public/claims/${oldClaim.json.claimId}/proof`, {
    method: 'POST',
    ip: '198.51.100.151',
    headers: { 'Content-Type': 'image/jpeg', 'x-upload-token': oldClaim.json.uploadToken },
    rawBody: jpeg,
  });
  await apiCall(`/api/v2/claims/${oldClaim.json.claimId}/reject`, {
    method: 'POST',
    token,
    body: { reason: 'Old rejected claim' },
  });

  const botRecent = await getSolvedBotCheck('198.51.100.152');
  const recentClaim = await apiCall(`/api/v2/public/invoices/${invoice.publicId}/claims`, {
    method: 'POST',
    ip: '198.51.100.152',
    body: { payerName: 'Recent Claim', amountKobo: 100_000, reference: 'NEW-10', hasProof: true, ...botRecent },
  });
  await apiCall(`/api/v2/public/claims/${recentClaim.json.claimId}/proof`, {
    method: 'POST',
    ip: '198.51.100.152',
    headers: { 'Content-Type': 'image/jpeg', 'x-upload-token': recentClaim.json.uploadToken },
    rawBody: jpeg,
  });
  await apiCall(`/api/v2/claims/${recentClaim.json.claimId}/confirm`, {
    method: 'POST',
    token,
    body: { amountKobo: 100_000, paymentMethod: 'Transfer' },
  });

  const oldRowBefore = db
    .prepare('SELECT proof_path FROM payment_claims WHERE id = ?')
    .get(oldClaim.json.claimId) as { proof_path: string };
  const recentRowBefore = db
    .prepare('SELECT proof_path FROM payment_claims WHERE id = ?')
    .get(recentClaim.json.claimId) as { proof_path: string };

  const oldAbsPath = resolveConfinedProofPath(oldRowBefore.proof_path)!;
  const recentAbsPath = resolveConfinedProofPath(recentRowBefore.proof_path)!;
  assert.equal(fs.existsSync(oldAbsPath), true);
  assert.equal(fs.existsSync(recentAbsPath), true);

  // Backdate oldClaim's decided_at to 91 days ago; recentClaim to 10 days ago
  const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE payment_claims SET decided_at = ? WHERE id = ?').run(
    ninetyOneDaysAgo,
    oldClaim.json.claimId
  );
  db.prepare('UPDATE payment_claims SET decided_at = ? WHERE id = ?').run(
    tenDaysAgo,
    recentClaim.json.claimId
  );

  // Run retention job (and verify cron endpoint auth as well)
  const badCron = await apiCall('/api/v2/internal/retention-run', {
    method: 'POST',
    headers: { 'x-cron-secret': 'wrong-secret' },
  });
  assert.equal(badCron.status, 403);

  const cronRun = await apiCall('/api/v2/internal/retention-run', {
    method: 'POST',
    headers: { 'x-cron-secret': process.env.RETENTION_CRON_SECRET! },
  });
  assert.equal(cronRun.status, 200);
  assert.ok(cronRun.json.deletedCount >= 1);

  // Old claim proof deleted from disk & DB path cleared, metadata preserved!
  assert.equal(fs.existsSync(oldAbsPath), false);
  const oldRowAfter = db
    .prepare('SELECT * FROM payment_claims WHERE id = ?')
    .get(oldClaim.json.claimId) as any;
  assert.equal(oldRowAfter.proof_path, null);
  assert.ok(oldRowAfter.proof_deleted_at);
  assert.equal(oldRowAfter.payer_name, 'Old Claim');
  assert.equal(Number(oldRowAfter.amount_kobo), 100_000);
  assert.equal(oldRowAfter.reference, 'OLD-90');
  assert.equal(oldRowAfter.status, 'REJECTED');
  assert.equal(oldRowAfter.decision_reason, 'Old rejected claim');

  // Recent (< 90d) claim proof untouched
  assert.equal(fs.existsSync(recentAbsPath), true);
  const recentRowAfter = db
    .prepare('SELECT proof_path, proof_deleted_at FROM payment_claims WHERE id = ?')
    .get(recentClaim.json.claimId) as any;
  assert.equal(recentRowAfter.proof_path, recentRowBefore.proof_path);
  assert.equal(recentRowAfter.proof_deleted_at, null);

  // Idempotent second run purges 0
  const secondRun = await runProofRetentionJob();
  assert.equal(secondRun.deletedCount, 0);
});

// =========================================================================
// 10. MIGRATION 006 & ROLLBACK SECURITY CHECK
// =========================================================================
test('10. Migration 006 and rollback are transactional, search_path hardened, and never leak decision_reason', () => {
  const mig = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/006_v2_slice2_claims_push.sql'),
    'utf8'
  );
  const rb = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/006_v2_slice2_claims_push.rollback.sql'),
    'utf8'
  );

  assert.match(mig, /^BEGIN;/im);
  assert.match(mig, /COMMIT;\s*$/i);
  assert.match(rb, /^BEGIN;/im);
  assert.match(rb, /COMMIT;\s*$/i);

  assert.match(mig, /set search_path = public/i);
  assert.match(mig, /revoke all on function public\.v2_confirm_claim.*from public/is);
  assert.match(mig, /revoke all on function public\.v2_reject_claim.*from public/is);
  assert.match(mig, /revoke all on function public\.v2_purge_expired_claim_proofs.*from public/is);
  assert.match(mig, /perform pg_notify\('pgrst', 'reload schema'\)/i);

  // get_public_invoice must NOT expose decision_reason
  const getPubSection = mig.slice(
    mig.indexOf('create or replace function public.get_public_invoice'),
    mig.indexOf('create or replace function public.v2_confirm_claim')
  );
  assert.equal(getPubSection.includes('decision_reason'), false);
});
