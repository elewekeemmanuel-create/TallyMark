import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { PDFDocument } from 'pdf-lib';
import { BusinessInputSchema, sanitizeRasterImageDataUrl } from '../src/shared/schemas.ts';
import type { PublicReceiptRecord } from '../src/shared/types.ts';
import { generateReceiptPdfBytes } from '../src/lib/pdf.ts';

// Minimal valid 1x1 transparent PNG
const SAMPLE_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const SAMPLE_SVG_DATA_URL =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4=';

function loadLocalFonts() {
  const read = (file: string): ArrayBuffer => {
    const buf = fs.readFileSync(path.join(process.cwd(), 'public', 'fonts', file));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  };
  return {
    sansRegular: read('IBMPlexSans-Regular.ttf'),
    sansSemiBold: read('IBMPlexSans-SemiBold.ttf'),
    monoRegular: read('IBMPlexMono-Regular.ttf'),
    monoSemiBold: read('IBMPlexMono-SemiBold.ttf'),
    serifRegular: read('InstrumentSerif-Regular.ttf'),
  };
}

function makeSampleReceipt(overrides: Partial<PublicReceiptRecord> = {}): PublicReceiptRecord {
  return {
    publicId: 'verify-test-0011223344',
    receiptNumber: 'RCT-0042',
    receiptKind: 'SALE',
    parentReceiptNumber: null,
    businessName: 'ZedTech Counter Store',
    businessLogoDataUrl: null,
    businessSignatureDataUrl: SAMPLE_PNG_DATA_URL,
    businessAddress: '14 Admiralty Way, Lekki Phase 1, Lagos',
    businessPhone: '0803 000 0142',
    businessEmail: 'sales@zedtech.ng',
    brandColor: '#064E3B',
    currency: 'NGN',
    customerName: 'Chinedu Okafor',
    customerPhone: '0809 111 2233',
    items: [
      {
        description: 'Premium Cotton Shirt (L)',
        qty: 2,
        unitPriceKobo: 1_500_000,
        discountKobo: 0,
        grossKobo: 3_000_000,
        lineTotalKobo: 3_000_000,
      },
    ],
    subtotalKobo: 3_000_000,
    discountTotalKobo: 0,
    vatEnabled: false,
    vatMode: 'exclusive',
    vatRateBps: 750,
    vatKobo: 0,
    totalKobo: 3_000_000,
    amountPaidKobo: 3_000_000,
    balanceDueKobo: 0,
    paymentMethod: 'Transfer',
    note: 'Thank you for your patronage.',
    soldBy: 'Tunde',
    template: 'modern',
    status: 'PAID',
    voidReason: null,
    voidedAt: null,
    issuedDateLagos: '2026-11-25',
    issuedAt: '2026-11-25T10:00:00.000Z',
    ...overrides,
  };
}

test('signatureDataUrl schema validation accepts raster PNG and rejects SVG/script payloads', () => {
  const ok = BusinessInputSchema.safeParse({
    name: 'Kemi Textiles',
    signatureDataUrl: SAMPLE_PNG_DATA_URL,
  });
  assert.equal(ok.success, true);

  const svgReject = BusinessInputSchema.safeParse({
    name: 'Kemi Textiles',
    signatureDataUrl: SAMPLE_SVG_DATA_URL,
  });
  assert.equal(svgReject.success, false);

  assert.equal(sanitizeRasterImageDataUrl(SAMPLE_PNG_DATA_URL), SAMPLE_PNG_DATA_URL);
  assert.equal(sanitizeRasterImageDataUrl(SAMPLE_SVG_DATA_URL), null);
  assert.equal(sanitizeRasterImageDataUrl('javascript:alert(1)'), null);
});

test('generateReceiptPdfBytes embeds issuer signature, customer signature space, and verification QR across all 3 templates', async () => {
  const fonts = loadLocalFonts();
  for (const tpl of ['modern', 'classic', 'compact'] as const) {
    const bytes = await generateReceiptPdfBytes(makeSampleReceipt({ template: tpl }), tpl, {
      origin: 'https://tallymark.app',
      fontBytes: fonts,
    });
    assert.ok(bytes.length > 2_000, `${tpl} PDF should have non-trivial content`);
    assert.ok(bytes.length < 180_000, `${tpl} PDF should stay compact (${bytes.length} bytes)`);
    assert.equal(Buffer.from(bytes.slice(0, 5)).toString('ascii'), '%PDF-');

    const loaded = await PDFDocument.load(bytes);
    assert.equal(loaded.getPageCount(), 1, `${tpl} receipt should fit on 1 page`);
  }

  // Unsafe non-raster signature URL must be safely ignored without throwing
  const safeBytes = await generateReceiptPdfBytes(
    makeSampleReceipt({ businessSignatureDataUrl: SAMPLE_SVG_DATA_URL }),
    'modern',
    { origin: 'https://tallymark.app', fontBytes: fonts }
  );
  assert.equal(Buffer.from(safeBytes.slice(0, 5)).toString('ascii'), '%PDF-');
});

test('SQLite API persists issuer signature and exposes it on logged-out public verification endpoint', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tallymark-sig-qr-'));
  process.env.TALLYMARK_DATA_DIR = tmpDir;
  const { createApiRouter } = await import('../src/server/routes.ts');

  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api', createApiRouter());

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const addr = server.address() as { port: number };
    const base = `http://127.0.0.1:${addr.port}`;

    // 1. Sign up
    const signupRes = await fetch(`${base}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Amina Owner',
        email: `amina-${Date.now()}@example.com`,
        password: 'Password123!',
      }),
    });
    assert.equal(signupRes.status, 201);
    const { sessionToken } = (await signupRes.json()) as { sessionToken: string };
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    };

    // 2. Reject SVG signature
    const badBizRes = await fetch(`${base}/api/business`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Amina Boutique',
        signatureDataUrl: SAMPLE_SVG_DATA_URL,
      }),
    });
    assert.equal(badBizRes.status, 400);

    // 3. Save business with valid PNG signature
    const bizRes = await fetch(`${base}/api/business`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Amina Boutique',
        signatureDataUrl: SAMPLE_PNG_DATA_URL,
      }),
    });
    assert.equal(bizRes.status, 201);
    const bizJson = (await bizRes.json()) as { business: { signatureDataUrl: string | null } };
    assert.equal(bizJson.business.signatureDataUrl, SAMPLE_PNG_DATA_URL);

    // 4. Issue a receipt
    const rctRes = await fetch(`${base}/api/rpc/issue_receipt`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customerName: 'Bola Adeyemi',
        items: [{ description: 'Ankara Fabric (6 yds)', qty: 1, unitPriceKobo: 2_500_000, discountKobo: 0 }],
        paymentMethod: 'Transfer',
        amountPaidKobo: 2_500_000,
      }),
    });
    assert.equal(rctRes.status, 201);
    const rctJson = (await rctRes.json()) as { receipt: { publicId: string; receiptNumber: string } };
    assert.ok(rctJson.receipt.publicId.length >= 12);

    // 5. Fetch logged-out public verification page API (no Authorization header)
    const pubRes = await fetch(
      `${base}/api/public/receipts/${encodeURIComponent(rctJson.receipt.publicId)}`
    );
    assert.equal(pubRes.status, 200);
    const pubJson = (await pubRes.json()) as { receipt: PublicReceiptRecord };
    assert.equal(pubJson.receipt.publicId, rctJson.receipt.publicId);
    assert.equal(pubJson.receipt.receiptNumber, rctJson.receipt.receiptNumber);
    assert.equal(pubJson.receipt.businessSignatureDataUrl, SAMPLE_PNG_DATA_URL);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('UI components and migration 009 include issuer/customer signatures and QR verification modal', () => {
  const templatesSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/ReceiptTemplates.tsx'),
    'utf8'
  );
  assert.match(templatesSrc, /Authorized Signature/);
  assert.match(templatesSrc, /Customer Signature/);
  assert.match(templatesSrc, /Issuer Sign/);
  assert.match(templatesSrc, /Customer Sign/);
  assert.match(templatesSrc, /Scan to verify/);
  assert.match(templatesSrc, /Scan QR to verify/);
  assert.match(templatesSrc, /\/r\/\$\{receipt\.publicId\}/);

  const actionsSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/ReceiptActionsModal.tsx'),
    'utf8'
  );
  assert.match(actionsSrc, /ReceiptQrModal/);
  assert.match(actionsSrc, /Verify QR/);
  assert.match(actionsSrc, /Download QR/);
  assert.match(actionsSrc, /\/r\/\$\{receipt\.publicId\}/);

  const migrationSrc = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/009_receipt_issuer_signature.sql'),
    'utf8'
  );
  assert.match(migrationSrc, /signature_data_url/);
  assert.match(migrationSrc, /business_signature_data_url/);
  assert.match(migrationSrc, /trg_public_receipts_capture_signature/);
  assert.match(migrationSrc, /get_public_receipt/);
});
