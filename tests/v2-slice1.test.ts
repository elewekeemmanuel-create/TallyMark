import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import test, { after, before } from 'node:test';
import cookieParser from 'cookie-parser';
import express from 'express';

// Isolate SQLite data directory before importing routes/db
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tallymark-v2-slice1-'));
process.env.TALLYMARK_DATA_DIR = TEST_DATA_DIR;

const { createApiRouter } = await import('../src/server/routes.ts');
const {
  roundHalfUpDiv,
  parseQtyToThousandths,
  formatQtyThousandths,
  calculateV2DocumentTotals,
  isInvoiceOverdue,
  sanitizeCsvCell,
} = await import('../src/shared/v2/money.ts');
const { canUse, isInvoicesQuotesModuleEnabled } = await import('../src/shared/v2/entitlements.ts');
const { getLagosDateString } = await import('../src/shared/money.ts');
const { buildInvoicePdfFilename, generateInvoicePdfBytes } = await import('../src/v2/pdf.ts');
const { PDFDocument } = await import('pdf-lib');

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
    // ignore cleanup errors
  }
});

async function apiCall(
  endpoint: string,
  options: { method?: string; token?: string; body?: unknown } = {}
) {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
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

async function createShop(email: string, name: string, vatOpts?: { enabled: boolean; mode: 'exclusive' | 'inclusive'; bps: number }) {
  const ml = await apiCall('/api/auth/magic-link', { method: 'POST', body: { email, name: 'Shop Owner' } });
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
      phone: '08031112222',
      email,
      brandColor: '#064E3B',
      receiptPrefix: 'RCT-',
      currency: 'NGN',
      vatEnabled: vatOpts?.enabled ?? false,
      vatMode: vatOpts?.mode ?? 'exclusive',
      vatRateBps: vatOpts?.bps ?? 750,
      openingCashKobo: 500_000,
    },
  });
  assert.equal(biz.status, 201);
  return { token, business: biz.json.business };
}

// =========================================================================
// 1. ROUNDING, 3-DECIMAL QUANTITIES, DISCOUNTS, VAT, OVERDUE BOUNDARY
// =========================================================================

test('Rounding: exact round-half-up, 3-decimal quantities, line & invoice discounts, exclusive & inclusive VAT', () => {
  // Exact half-up ties
  assert.equal(roundHalfUpDiv(1n, 2n), 1);
  assert.equal(roundHalfUpDiv(3n, 2n), 2);
  assert.equal(roundHalfUpDiv(5n, 2n), 3);
  assert.equal(roundHalfUpDiv(499n, 1000n), 0);
  assert.equal(roundHalfUpDiv(500n, 1000n), 1);

  // 3-decimal quantity parsing & formatting
  assert.equal(parseQtyToThousandths('0.125'), 125);
  assert.equal(parseQtyToThousandths('1.333'), 1333);
  assert.equal(parseQtyToThousandths('2.505'), 2505);
  assert.equal(formatQtyThousandths(125), '0.125');
  assert.equal(formatQtyThousandths(2000), '2');
  assert.equal(formatQtyThousandths(2500), '2.5');

  // Case A: 3-decimal qty + line discount + invoice discount BEFORE exclusive 7.5% VAT
  // Line 1: 1.333 × 1000 kobo = 1333 kobo; line discount 33 kobo -> lineTotal = 1300
  // Line 2: 0.125 × 5000 kobo = 625 kobo; line discount 0 -> lineTotal = 625
  // Line 3: 2.505 × 333 kobo = 834.165 -> rounds to 834 kobo
  // Line 4 (exact half tie): 0.005 × 100 kobo = 0.5 -> rounds half-up to 1 kobo
  // Net lines = 1300 + 625 + 834 + 1 = 2760 kobo
  // Invoice discount = 260 kobo -> taxable = 2500 kobo
  // Exclusive VAT 7.5% (750 bps): 2500 * 750 / 10000 = 187.5 -> rounds half-up to 188 kobo!
  // Total = 2500 + 188 = 2688 kobo
  const excl = calculateV2DocumentTotals({
    lines: [
      { description: 'Fabric', qtyThousandths: 1333, unitPriceKobo: 1000, discountKobo: 33 },
      { description: 'Oil', qtyThousandths: 125, unitPriceKobo: 5000, discountKobo: 0 },
      { description: 'Wire', qtyThousandths: 2505, unitPriceKobo: 333, discountKobo: 0 },
      { description: 'Pin', qtyThousandths: 5, unitPriceKobo: 100, discountKobo: 0 },
    ],
    invoiceDiscountKobo: 260,
    vatEnabled: true,
    vatMode: 'exclusive',
    vatRateBps: 750,
    depositType: 'percent',
    depositValue: 5000, // 50%
  });
  assert.equal(excl.lines[0].grossKobo, 1333);
  assert.equal(excl.lines[0].lineTotalKobo, 1300);
  assert.equal(excl.lines[2].lineTotalKobo, 834);
  assert.equal(excl.lines[3].lineTotalKobo, 1);
  assert.equal(excl.subtotalKobo, 2793);
  assert.equal(excl.lineDiscountTotalKobo, 33);
  assert.equal(excl.invoiceDiscountKobo, 260);
  assert.equal(excl.taxableKobo, 2500);
  assert.equal(excl.vatKobo, 188);
  assert.equal(excl.totalKobo, 2688);
  assert.equal(excl.amountDueNowKobo, 1344);

  // Case B: Inclusive VAT 7.5% (750 bps) after invoice discount
  // Net lines = 100,000 kobo, invoice discount = 10,000 -> gross taxable = 90,000 kobo
  // Inclusive VAT = roundHalfUp(90000 * 750 / 10750) = roundHalfUp(67500000 / 10750) = roundHalfUp(6279.0697...) = 6279
  // Total remains 90,000 kobo (VAT is included)
  const incl = calculateV2DocumentTotals({
    lines: [{ description: 'Solar inverter', qtyThousandths: 1000, unitPriceKobo: 100_000, discountKobo: 0 }],
    invoiceDiscountKobo: 10_000,
    vatEnabled: true,
    vatMode: 'inclusive',
    vatRateBps: 750,
    depositType: 'fixed',
    depositValue: 30_000,
  });
  assert.equal(incl.vatKobo, 6279);
  assert.equal(incl.totalKobo, 90_000);
  assert.equal(incl.amountDueNowKobo, 30_000);

  // Overdue boundary strictly at 23:59:59 Africa/Lagos (UTC+1 => 22:59:59Z)
  const beforeMidnightLagos = new Date('2026-06-15T22:59:59.000Z');
  const afterMidnightLagos = new Date('2026-06-15T23:00:00.000Z');
  assert.equal(isInvoiceOverdue('SENT', '2026-06-15', 10_000, beforeMidnightLagos), false);
  assert.equal(isInvoiceOverdue('SENT', '2026-06-15', 10_000, afterMidnightLagos), true);
  assert.equal(isInvoiceOverdue('PAID', '2026-06-15', 0, afterMidnightLagos), false);

  // CSV formula-injection neutralization
  assert.equal(sanitizeCsvCell('=CMD()'), "'=CMD()");
  assert.equal(sanitizeCsvCell('+2348012345678'), "'+2348012345678");
  assert.equal(sanitizeCsvCell('Normal Name'), 'Normal Name');
});

// =========================================================================
// 2. MODULE TOGGLE, ENTITLEMENTS, AND V1 REGRESSION WITH MODULE OFF & ON
// =========================================================================

test('Module OFF by default, entitlements early_access, toggle OFF preserves data, V1 works both OFF & ON', async () => {
  const { token, business } = await createShop('modtoggle@tallymark.test', 'Okafor Stores');
  assert.equal(isInvoicesQuotesModuleEnabled(business), false);
  assert.equal(canUse(business, 'invoices_quotes'), true);
  assert.equal(canUse(business, 'hide_public_branding'), false);

  // V1 receipt works while module is OFF
  const rOff = await apiCall('/api/receipts', {
    method: 'POST',
    token,
    body: {
      customerName: 'Chidi Off',
      paymentMethod: 'Cash',
      items: [{ description: 'Cement', qty: 2, unitPriceKobo: 850_000, discountKobo: 0 }],
      amountPaidKobo: 1_700_000,
    },
  });
  assert.equal(rOff.status, 201);

  // Enable module
  const onRes = await apiCall('/api/v2/settings/module', {
    method: 'PATCH',
    token,
    body: { enabled: true },
  });
  assert.equal(onRes.status, 200);
  assert.equal(onRes.json.business.modulesEnabled.invoicesQuotes, true);

  // Create a draft invoice while ON
  const invRes = await apiCall('/api/v2/invoices', {
    method: 'POST',
    token,
    body: {
      customerName: 'Amaka Ltd',
      termsKind: 'net_7',
      lines: [{ description: 'Paint bucket', qtyThousandths: 2000, unitPriceKobo: 1_500_000, discountKobo: 0 }],
    },
  });
  assert.equal(invRes.status, 201);
  const invId = invRes.json.invoice.id as string;

  // V1 receipt & quick sale still work identically while module is ON
  const rOn = await apiCall('/api/receipts', {
    method: 'POST',
    token,
    body: {
      customerName: 'Chidi On',
      paymentMethod: 'Transfer',
      items: [{ description: 'Sand', qty: 1, unitPriceKobo: 500_000, discountKobo: 0 }],
      amountPaidKobo: 500_000,
    },
  });
  assert.equal(rOn.status, 201);

  // Turn module OFF — must NOT delete saved invoice data
  const offRes = await apiCall('/api/v2/settings/module', {
    method: 'PATCH',
    token,
    body: { enabled: false },
  });
  assert.equal(offRes.status, 200);
  assert.equal(offRes.json.business.modulesEnabled.invoicesQuotes, false);

  // Turn back ON — invoice is still intact
  await apiCall('/api/v2/settings/module', { method: 'PATCH', token, body: { enabled: true } });
  const fetched = await apiCall(`/api/v2/invoices/${invId}`, { token });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.json.invoice.customerName, 'Amaka Ltd');
});

// =========================================================================
// 3. END-TO-END INVOICES, CASH BOOK ZERO-MONEY, IMMUTABLE SNAPSHOT, LINK REGEN,
//    DEPOSIT PART-PAYMENT + LINKED RECEIPT + PAID STAMP + REVERSAL + WRITE-OFF
// =========================================================================

test('Invoices E2E: gap-free numbering, cash book isolation, bank immutability, link regen, deposit payment, reversal, write-off', async () => {
  const { token } = await createShop('e2e@tallymark.test', 'ZedTech Hardware Ltd', {
    enabled: true,
    mode: 'exclusive',
    bps: 750,
  });

  await apiCall('/api/v2/settings/module', { method: 'PATCH', token, body: { enabled: true } });

  // Configure initial bank account & TIN
  const bankRes = await apiCall('/api/v2/settings/billing', {
    method: 'PATCH',
    token,
    body: {
      tinRc: 'RC-998877',
      bankAccounts: [
        {
          id: 'bank-1',
          bankName: 'GTBank',
          accountName: 'ZedTech Hardware Ltd',
          accountNumber: '0123456789',
          isDefault: true,
        },
      ],
      invoicePrefix: 'INV-',
    },
  });
  assert.equal(bankRes.status, 200);

  const today = getLagosDateString();

  // Create and send Invoice #1 with 50% deposit
  const inv1Res = await apiCall('/api/v2/invoices', {
    method: 'POST',
    token,
    body: {
      customerName: 'Ngozi Builders',
      customerPhone: '08099998888',
      customerEmail: 'ngozi@example.com',
      customerAddress: '22 Trans Amadi, Port Harcourt',
      issueDate: today,
      termsKind: 'net_7',
      lines: [
        { description: 'Copper Cable (100m)', qtyThousandths: 2000, unitPriceKobo: 5_000_000, discountKobo: 0 },
      ],
      invoiceDiscountKobo: 0,
      depositType: 'percent',
      depositValue: 5000, // 50%
      bankAccountIds: ['bank-1'],
      idempotencyKey: 'inv-create-key-1',
      sendNow: true,
    },
  });
  assert.equal(inv1Res.status, 201);
  const inv1 = inv1Res.json.invoice;
  assert.equal(inv1.invoiceNumber, 'INV-0001');
  assert.equal(inv1.status, 'SENT');
  assert.equal(inv1.totalKobo, 10_750_000); // 10,000,000 + 7.5% VAT
  assert.equal(inv1.amountDueNowKobo, 5_375_000);
  assert.equal(inv1.balanceDueKobo, 10_750_000);
  assert.ok(inv1.debtId);

  // Idempotent invoice create replay returns same invoice without creating a duplicate or gap
  const inv1Replay = await apiCall('/api/v2/invoices', {
    method: 'POST',
    token,
    body: {
      customerName: 'Ngozi Builders',
      issueDate: today,
      termsKind: 'net_7',
      lines: [
        { description: 'Copper Cable (100m)', qtyThousandths: 2000, unitPriceKobo: 5_000_000, discountKobo: 0 },
      ],
      idempotencyKey: 'inv-create-key-1',
      sendNow: true,
    },
  });
  assert.equal(inv1Replay.json.invoice.id, inv1.id);
  assert.equal(inv1Replay.json.invoice.invoiceNumber, 'INV-0001');

  // Cash Book MUST show ZERO money for unpaid invoice!
  const cbBefore = await apiCall(`/api/cashbook?date=${today}`, { token });
  assert.equal(cbBefore.status, 200);
  assert.equal(cbBefore.json.dayView.moneyInTotalKobo, 0);
  assert.equal(cbBefore.json.dayView.rows.length, 0);

  // Change business bank details AFTER sending INV-0001
  await apiCall('/api/v2/settings/billing', {
    method: 'PATCH',
    token,
    body: {
      bankAccounts: [
        {
          id: 'bank-2',
          bankName: 'Access Bank',
          accountName: 'ZedTech New Account',
          accountNumber: '9988776655',
          isDefault: true,
        },
      ],
    },
  });

  // Public invoice MUST still show ORIGINAL bank details (GTBank 0123456789) and NEVER customer phone/email!
  const pub1 = await apiCall(`/api/v2/public/invoices/${inv1.publicId}`);
  assert.equal(pub1.status, 200);
  assert.equal(pub1.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(pub1.headers.get('referrer-policy'), 'no-referrer');
  assert.match(pub1.headers.get('cache-control') || '', /no-store/);
  assert.equal(pub1.json.invoice.snapshot.bankAccounts[0].bankName, 'GTBank');
  assert.equal(pub1.json.invoice.snapshot.bankAccounts[0].accountNumber, '0123456789');
  assert.equal(pub1.json.invoice.snapshot.customer.phone, undefined);
  assert.equal(pub1.json.invoice.snapshot.customer.email, undefined);
  assert.equal(pub1.text.includes('08099998888'), false);
  assert.equal(pub1.text.includes('ngozi@example.com'), false);

  // Regenerate link kills old publicId immediately
  const oldPublicId = inv1.publicId as string;
  const regen = await apiCall(`/api/v2/invoices/${inv1.id}/regenerate-link`, { method: 'POST', token });
  assert.equal(regen.status, 200);
  const newPublicId = regen.json.invoice.publicId as string;
  assert.notEqual(newPublicId, oldPublicId);

  const oldLinkCheck = await apiCall(`/api/v2/public/invoices/${oldPublicId}`);
  const randomLinkCheck = await apiCall('/api/v2/public/invoices/nonexistent1234567890');
  assert.equal(oldLinkCheck.status, 404);
  assert.equal(randomLinkCheck.status, 404);
  assert.deepEqual(oldLinkCheck.json, randomLinkCheck.json);

  const newLinkCheck = await apiCall(`/api/v2/public/invoices/${newPublicId}`);
  assert.equal(newLinkCheck.status, 200);

  // Reject overpayment, future date, and date before issue date
  const overpay = await apiCall('/api/v2/payments', {
    method: 'POST',
    token,
    body: {
      debtId: inv1.debtId,
      amountKobo: 10_750_001,
      paymentMethod: 'Transfer',
      paymentDate: today,
      idempotencyKey: 'pay-over-1',
    },
  });
  assert.equal(overpay.status, 400);

  const futurePay = await apiCall('/api/v2/payments', {
    method: 'POST',
    token,
    body: {
      debtId: inv1.debtId,
      amountKobo: 100_000,
      paymentMethod: 'Transfer',
      paymentDate: '2099-12-31',
      idempotencyKey: 'pay-future-1',
    },
  });
  assert.equal(futurePay.status, 400);

  const preIssuePay = await apiCall('/api/v2/payments', {
    method: 'POST',
    token,
    body: {
      debtId: inv1.debtId,
      amountKobo: 100_000,
      paymentMethod: 'Transfer',
      paymentDate: '2020-01-01',
      idempotencyKey: 'pay-pre-1',
    },
  });
  assert.equal(preIssuePay.status, 400);

  // Record Deposit part-payment (₦53,750 = 5,375,000 kobo)
  const depPay = await apiCall('/api/v2/payments', {
    method: 'POST',
    token,
    body: {
      debtId: inv1.debtId,
      amountKobo: 5_375_000,
      paymentMethod: 'Transfer',
      paymentDate: today,
      reference: 'GTB-TXN-100',
      idempotencyKey: 'pay-dep-1',
    },
  });
  assert.equal(depPay.status, 201);
  assert.equal(depPay.json.idempotentReplay, false);
  assert.ok(depPay.json.receipt);
  assert.equal(depPay.json.receipt.receiptKind, 'BALANCE_PAYMENT');
  assert.match(depPay.json.receipt.items[0].description, /Payment for INV-0001/);
  assert.equal(depPay.json.debt.balanceDueKobo, 5_375_000);
  const firstPaymentReceiptId = depPay.json.receipt.id as string;

  // Check invoice is PART_PAID with exact remaining balance
  const afterDep = await apiCall(`/api/v2/invoices/${inv1.id}`, { token });
  assert.equal(afterDep.json.invoice.status, 'PART_PAID');
  assert.equal(afterDep.json.invoice.amountPaidKobo, 5_375_000);
  assert.equal(afterDep.json.invoice.balanceDueKobo, 5_375_000);

  // Cash Book now shows exactly 5,375,000 kobo received
  const cbAfterDep = await apiCall(`/api/cashbook?date=${today}`, { token });
  assert.equal(cbAfterDep.json.dayView.moneyInTotalKobo, 5_375_000);

  // Invoice with a payment CANNOT be voided!
  const voidPaidInv = await apiCall(`/api/v2/invoices/${inv1.id}/void`, {
    method: 'POST',
    token,
    body: { reason: 'Trying to void paid invoice' },
  });
  assert.equal(voidPaidInv.status, 409);

  // Voiding the payment receipt creates reversing ledger entry & reopens balance to 10,750,000
  const voidRcpt = await apiCall(`/api/receipts/${firstPaymentReceiptId}/void`, {
    method: 'POST',
    token,
    body: { reason: 'Bank transfer bounced' },
  });
  assert.equal(voidRcpt.status, 200);

  const afterReversal = await apiCall(`/api/v2/invoices/${inv1.id}`, { token });
  assert.equal(afterReversal.json.invoice.status, 'SENT');
  assert.equal(afterReversal.json.invoice.amountPaidKobo, 0);
  assert.equal(afterReversal.json.invoice.balanceDueKobo, 10_750_000);

  const cbAfterReversal = await apiCall(`/api/cashbook?date=${today}`, { token });
  assert.equal(cbAfterReversal.json.dayView.moneyInTotalKobo, 5_375_000);
  assert.equal(cbAfterReversal.json.dayView.moneyOutTotalKobo, 5_375_000);
  assert.equal(cbAfterReversal.json.dayView.netKobo, 0);

  // Now pay in two steps -> full payment flips public page to PAID!
  const step1 = await apiCall('/api/v2/payments', {
    method: 'POST',
    token,
    body: {
      debtId: inv1.debtId,
      amountKobo: 5_375_000,
      paymentMethod: 'Transfer',
      paymentDate: today,
      idempotencyKey: 'pay-full-step-1',
    },
  });
  assert.equal(step1.status, 201);

  const step2 = await apiCall('/api/v2/payments', {
    method: 'POST',
    token,
    body: {
      debtId: inv1.debtId,
      amountKobo: 5_375_000,
      paymentMethod: 'Cash',
      paymentDate: today,
      idempotencyKey: 'pay-full-step-2',
    },
  });
  assert.equal(step2.status, 201);

  const pubPaid = await apiCall(`/api/v2/public/invoices/${newPublicId}`);
  assert.equal(pubPaid.status, 200);
  assert.equal(pubPaid.json.invoice.status, 'PAID');
  assert.equal(pubPaid.json.invoice.balanceDueKobo, 0);
  assert.equal(pubPaid.json.invoice.payments.length, 2);

  // Invoice #2: test Write-Off closes invoice as SETTLED without adding cash
  const inv2Res = await apiCall('/api/v2/invoices', {
    method: 'POST',
    token,
    body: {
      customerName: 'Emeka Logistics',
      issueDate: today,
      termsKind: 'net_7',
      lines: [{ description: 'Spare tyres', qtyThousandths: 1000, unitPriceKobo: 2_000_000, discountKobo: 0 }],
      sendNow: true,
    },
  });
  assert.equal(inv2Res.status, 201);
  assert.equal(inv2Res.json.invoice.invoiceNumber, 'INV-0002');
  const inv2 = inv2Res.json.invoice;

  // Partial payment then write off remainder
  await apiCall('/api/v2/payments', {
    method: 'POST',
    token,
    body: {
      debtId: inv2.debtId,
      amountKobo: 1_000_000,
      paymentMethod: 'Cash',
      paymentDate: today,
      idempotencyKey: 'pay-inv2-part',
    },
  });

  const cbBeforeWo = await apiCall(`/api/cashbook?date=${today}`, { token });
  const moneyInBeforeWo = cbBeforeWo.json.dayView.moneyInTotalKobo;

  const woRes = await apiCall(`/api/v2/invoices/${inv2.id}/write-off`, {
    method: 'POST',
    token,
    body: { reason: 'Agreed final settlement discount' },
  });
  assert.equal(woRes.status, 200);
  assert.equal(woRes.json.invoice.status, 'SETTLED');
  assert.equal(woRes.json.invoice.balanceDueKobo, 0);
  assert.equal(woRes.json.invoice.writtenOffKobo, inv2.totalKobo - 1_000_000);

  // Write-off MUST NOT record cash in the Cash Book
  const cbAfterWo = await apiCall(`/api/cashbook?date=${today}`, { token });
  assert.equal(cbAfterWo.json.dayView.moneyInTotalKobo, moneyInBeforeWo);

  // Invoice #3: Reissue unpaid invoice -> voids INV-0003 and creates Draft -> sending gives INV-0004 (no gaps!)
  const inv3Res = await apiCall('/api/v2/invoices', {
    method: 'POST',
    token,
    body: {
      customerName: 'Tunde Ventures',
      issueDate: today,
      termsKind: 'due_on_receipt',
      lines: [{ description: 'Switchboard', qtyThousandths: 1000, unitPriceKobo: 400_000, discountKobo: 0 }],
      sendNow: true,
    },
  });
  assert.equal(inv3Res.json.invoice.invoiceNumber, 'INV-0003');

  const reissue = await apiCall(`/api/v2/invoices/${inv3Res.json.invoice.id}/reissue`, {
    method: 'POST',
    token,
    body: { reason: 'Updated quantity' },
  });
  assert.equal(reissue.status, 201);
  assert.equal(reissue.json.invoice.status, 'DRAFT');

  const send4 = await apiCall(`/api/v2/invoices/${reissue.json.invoice.id}/send`, {
    method: 'POST',
    token,
  });
  assert.equal(send4.status, 200);
  assert.equal(send4.json.invoice.invoiceNumber, 'INV-0004');
});

// =========================================================================
// 4. PARALLEL PAYMENT CONCURRENCY & IDEMPOTENCY DOUBLE-TAP
// =========================================================================

test('Concurrency & idempotency: parallel payments never overpay; double tap with same key creates one payment', async () => {
  const { token } = await createShop('race@tallymark.test', 'Delta Agro Supply');
  await apiCall('/api/v2/settings/module', { method: 'PATCH', token, body: { enabled: true } });

  const today = getLagosDateString();
  const invRes = await apiCall('/api/v2/invoices', {
    method: 'POST',
    token,
    body: {
      customerName: 'Sadiq Farms',
      issueDate: today,
      termsKind: 'net_7',
      lines: [{ description: 'Fertilizer bags', qtyThousandths: 1000, unitPriceKobo: 1_000_000, discountKobo: 0 }],
      sendNow: true,
    },
  });
  const inv = invRes.json.invoice;

  // Double tap with the SAME idempotency key in parallel -> strictly ONE payment
  const [tap1, tap2] = await Promise.all([
    apiCall('/api/v2/payments', {
      method: 'POST',
      token,
      body: {
        debtId: inv.debtId,
        amountKobo: 400_000,
        paymentMethod: 'Transfer',
        paymentDate: today,
        idempotencyKey: 'double-tap-same-key',
      },
    }),
    apiCall('/api/v2/payments', {
      method: 'POST',
      token,
      body: {
        debtId: inv.debtId,
        amountKobo: 400_000,
        paymentMethod: 'Transfer',
        paymentDate: today,
        idempotencyKey: 'double-tap-same-key',
      },
    }),
  ]);
  assert.equal(tap1.status === 200 || tap1.status === 201, true);
  assert.equal(tap2.status === 200 || tap2.status === 201, true);
  assert.equal(tap1.json.payment.id, tap2.json.payment.id);

  // Two parallel payments with DIFFERENT keys that would together overpay (600,000 remaining; both try 500,000)
  const [race1, race2] = await Promise.all([
    apiCall('/api/v2/payments', {
      method: 'POST',
      token,
      body: {
        debtId: inv.debtId,
        amountKobo: 500_000,
        paymentMethod: 'Cash',
        paymentDate: today,
        idempotencyKey: 'race-key-a',
      },
    }),
    apiCall('/api/v2/payments', {
      method: 'POST',
      token,
      body: {
        debtId: inv.debtId,
        amountKobo: 500_000,
        paymentMethod: 'POS',
        paymentDate: today,
        idempotencyKey: 'race-key-b',
      },
    }),
  ]);
  const statuses = [race1.status, race2.status].sort();
  assert.deepEqual(statuses, [201, 400]);

  const check = await apiCall(`/api/v2/invoices/${inv.id}`, { token });
  assert.equal(check.json.invoice.amountPaidKobo, 900_000);
  assert.equal(check.json.invoice.balanceDueKobo, 100_000);
  assert.equal(check.json.payments.length, 2);
});

// =========================================================================
// 5. TWO-USER ISOLATION & ANON LOCKDOWN + POSTGRES MIGRATION SECURITY AUDIT
// =========================================================================

test('Two-user isolation and anon denial across all V2 endpoints', async () => {
  const userA = await createShop('owner-a@tallymark.test', 'Shop Alpha');
  const userB = await createShop('owner-b@tallymark.test', 'Shop Beta');

  await apiCall('/api/v2/settings/module', { method: 'PATCH', token: userA.token, body: { enabled: true } });
  await apiCall('/api/v2/settings/module', { method: 'PATCH', token: userB.token, body: { enabled: true } });

  const today = getLagosDateString();
  const invA = await apiCall('/api/v2/invoices', {
    method: 'POST',
    token: userA.token,
    body: {
      customerName: 'Alpha Client',
      issueDate: today,
      termsKind: 'net_7',
      lines: [{ description: 'Item A', qtyThousandths: 1000, unitPriceKobo: 500_000, discountKobo: 0 }],
      sendNow: true,
    },
  });
  const invId = invA.json.invoice.id as string;
  const debtId = invA.json.invoice.debtId as string;

  // Unauthenticated (anon) rejected everywhere except public snapshot
  assert.equal((await apiCall('/api/v2/invoices')).status, 401);
  assert.equal((await apiCall(`/api/v2/invoices/${invId}`)).status, 401);
  assert.equal((await apiCall('/api/v2/summary')).status, 401);

  // Owner B cannot read, mutate, void, write-off, regenerate link, or pay Owner A's invoice
  assert.equal((await apiCall(`/api/v2/invoices/${invId}`, { token: userB.token })).status, 404);
  assert.equal(
    (await apiCall(`/api/v2/invoices/${invId}/void`, { method: 'POST', token: userB.token, body: { reason: 'Hack' } }))
      .status,
    404
  );
  assert.equal(
    (await apiCall(`/api/v2/invoices/${invId}/write-off`, { method: 'POST', token: userB.token, body: { reason: 'Hack' } }))
      .status,
    404
  );
  assert.equal(
    (await apiCall(`/api/v2/invoices/${invId}/regenerate-link`, { method: 'POST', token: userB.token })).status,
    404
  );
  assert.equal(
    (
      await apiCall('/api/v2/payments', {
        method: 'POST',
        token: userB.token,
        body: {
          debtId,
          amountKobo: 100_000,
          paymentMethod: 'Cash',
          paymentDate: today,
          idempotencyKey: 'cross-tenant-pay',
        },
      })
    ).status,
    404
  );

  // Owner B's invoice list contains zero rows from Owner A
  const listB = await apiCall('/api/v2/invoices', { token: userB.token });
  assert.equal(listB.status, 200);
  assert.equal(listB.json.invoices.length, 0);
});

test('Postgres migration 005 & rollback satisfy RLS, anon-deny, search_path, transaction, and backfill rules', () => {
  const upSql = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/005_v2_quotations_invoices.sql'),
    'utf-8'
  );
  const downSql = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/005_v2_quotations_invoices.rollback.sql'),
    'utf-8'
  );

  // Transactional
  assert.match(upSql, /^\s*begin;/im);
  assert.match(upSql, /commit;\s*$/im);
  assert.match(downSql, /^\s*begin;/im);
  assert.match(downSql, /commit;\s*$/im);

  // Every V2 table has RLS enabled and anon revoked
  const v2Tables = [
    'invoices',
    'invoice_lines',
    'quotes',
    'quote_lines',
    'debts',
    'payments',
    'payment_claims',
    'payment_reminders',
    'audit_log',
    'usage_counters',
    'push_subscriptions',
    'rate_limits',
  ];
  const revokeAnonMatch = /revoke all on([\s\S]*?)from anon;/i.exec(upSql);
  assert.ok(revokeAnonMatch, 'Missing REVOKE ALL ... FROM anon statement');
  const revokedAnonBlock = revokeAnonMatch[1];

  for (const tbl of v2Tables) {
    assert.match(
      upSql,
      new RegExp(`alter table public\\.${tbl} enable row level security;`, 'i'),
      `Missing RLS on ${tbl}`
    );
    assert.match(
      revokedAnonBlock,
      new RegExp(`public\\.${tbl}\\b`, 'i'),
      `Missing REVOKE anon on ${tbl}`
    );
    assert.match(
      downSql,
      new RegExp(`drop table if exists public\\.${tbl}(?:\\s+cascade)?;`, 'i'),
      `Missing rollback DROP TABLE for ${tbl}`
    );
  }

  // Every SECURITY DEFINER function has SET search_path = public immediately following it
  const strippedUpSql = upSql.replace(/--.*$/gm, '');
  const definerCount = (strippedUpSql.match(/\bsecurity\s+definer\b/gi) || []).length;
  const definerWithSearchPath = (
    strippedUpSql.match(/\bsecurity\s+definer\s+set\s+search_path\s*=\s*public\b/gi) || []
  ).length;
  assert.ok(definerCount >= 12, 'Expected SECURITY DEFINER RPCs');
  assert.equal(
    definerWithSearchPath,
    definerCount,
    'Every SECURITY DEFINER function must set search_path = public'
  );

  // Backfill exists for V1 open debts
  assert.match(upSql, /insert into public\.debts/i);
  assert.match(upSql, /on conflict \(source_type, source_id\) do nothing/i);
});

// =========================================================================
// 6. VECTOR PDF GENERATION (< 150 KB, SELECTABLE TEXT, SNAPSHOT-ONLY)
// =========================================================================

test('Vector Invoice PDF is valid PDF and strictly under 150 KB with font subsetting', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (urlStr.startsWith('/fonts/')) {
      const fontPath = path.resolve(process.cwd(), 'public', urlStr.slice(1));
      const buf = fs.readFileSync(fontPath);
      return new Response(buf, { status: 200 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    const bytes = await generateInvoicePdfBytes(
      {
        publicId: 'testpublicid1234567890',
        status: 'PART_PAID',
        isOverdue: false,
        amountPaidKobo: 5_000_000,
        writtenOffKobo: 0,
        balanceDueKobo: 5_750_000,
        sentAt: '2026-06-10T10:00:00.000Z',
        voidReason: null,
        voidedAt: null,
        pendingClaimsCount: 0,
        snapshot: {
          invoiceNumber: 'INV-0001',
          issueDate: '2026-06-10',
          dueDate: '2026-06-17',
          termsKind: 'net_7',
          template: 'modern',
          business: {
            name: 'ZedTech Hardware Ltd',
            logoDataUrl: null,
            address: '14 Aba Road, Port Harcourt',
            phone: '08031112222',
            email: 'sales@zedtech.ng',
            brandColor: '#064E3B',
            tinRc: 'RC-998877',
            currency: 'NGN',
          },
          customer: {
            name: 'Ngozi Builders',
            address: '22 Trans Amadi, Port Harcourt',
          },
          lines: [
            {
              description: 'Copper Cable (100m roll)',
              qtyThousandths: 2500,
              unitPriceKobo: 4_000_000,
              discountKobo: 0,
              grossKobo: 10_000_000,
              lineTotalKobo: 10_000_000,
            },
          ],
          subtotalKobo: 10_000_000,
          lineDiscountTotalKobo: 0,
          invoiceDiscountKobo: 0,
          vatEnabled: true,
          vatMode: 'exclusive',
          vatRateBps: 750,
          vatKobo: 750_000,
          totalKobo: 10_750_000,
          depositType: 'percent',
          depositValue: 5000,
          amountDueNowKobo: 5_375_000,
          bankAccounts: [
            {
              id: 'bank-1',
              bankName: 'GTBank',
              accountName: 'ZedTech Hardware Ltd',
              accountNumber: '0123456789',
              isDefault: true,
            },
          ],
          notes: 'Thank you for your business.',
          showBranding: true,
        },
        payments: [
          {
            amountKobo: 5_000_000,
            paymentMethod: 'Transfer',
            paymentDate: '2026-06-11',
            receiptNumber: 'RCT-0001',
            receiptPublicId: 'rcptpub123',
          },
        ],
      },
      'https://tallymark.app'
    );

    const header = new TextDecoder('ascii').decode(bytes.slice(0, 5));
    assert.equal(header, '%PDF-');
    assert.ok(bytes.byteLength < 150 * 1024, `PDF too large: ${bytes.byteLength} bytes (must be < 153600)`);

    // Sanitized filename check
    const sampleDoc = {
      publicId: 'testpublicid1234567890',
      status: 'DRAFT' as const,
      isOverdue: false,
      amountPaidKobo: 0,
      writtenOffKobo: 0,
      balanceDueKobo: 25_000_000,
      sentAt: null,
      voidReason: null,
      voidedAt: null,
      pendingClaimsCount: 0,
      snapshot: {
        invoiceNumber: 'INV-0009',
        issueDate: '2026-06-10',
        dueDate: '2026-06-17',
        termsKind: 'net_7' as const,
        template: 'modern' as const,
        business: {
          name: 'ZedTech Hardware Ltd',
          logoDataUrl: null,
          address: '14 Aba Road, Port Harcourt',
          phone: '08031112222',
          email: 'sales@zedtech.ng',
          brandColor: '#064E3B',
          tinRc: 'RC-998877',
          currency: 'NGN' as const,
        },
        customer: {
          name: 'Ngozi / Builders & Co.',
          address: '22 Trans Amadi, Port Harcourt',
        },
        lines: Array.from({ length: 25 }, (_, i) => ({
          description: `Supply item #${i + 1} - Heavy duty conduit pipe`,
          qtyThousandths: 1000,
          unitPriceKobo: 1_000_000,
          discountKobo: 0,
          grossKobo: 1_000_000,
          lineTotalKobo: 1_000_000,
        })),
        subtotalKobo: 25_000_000,
        lineDiscountTotalKobo: 0,
        invoiceDiscountKobo: 0,
        vatEnabled: false,
        vatMode: 'exclusive' as const,
        vatRateBps: 750,
        vatKobo: 0,
        totalKobo: 25_000_000,
        depositType: 'none' as const,
        depositValue: 0,
        amountDueNowKobo: 25_000_000,
        bankAccounts: [],
        notes: 'Draft invoice preview.',
        showBranding: true,
      },
      payments: [],
    };

    assert.equal(buildInvoicePdfFilename(sampleDoc), 'INV-0009-Ngozi_Builders_Co.pdf');

    // Draft + multi-page invoice paginates cleanly into 2+ pages
    const multiBytes = await generateInvoicePdfBytes(sampleDoc, 'https://tallymark.app');
    const loadedMulti = await PDFDocument.load(multiBytes);
    assert.ok(loadedMulti.getPageCount() >= 2, '25-line invoice should paginate across multiple pages');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// =========================================================================
// 7. ACCOUNT EXPORT & DELETE INCLUDE ALL V2 DATA (SECTION 10 QUALITY BAR)
// =========================================================================

test('Account export includes V2 invoices/payments/debts/auditLog and account deletion purges V2 data cleanly', async () => {
  const { token } = await createShop('export-del@tallymark.test', 'Export Test Shop');
  await apiCall('/api/v2/settings/module', { method: 'PATCH', token, body: { enabled: true } });

  const today = getLagosDateString();
  const invRes = await apiCall('/api/v2/invoices', {
    method: 'POST',
    token,
    body: {
      customerName: 'Export Client',
      issueDate: today,
      termsKind: 'net_7',
      lines: [{ description: 'Item', qtyThousandths: 1000, unitPriceKobo: 250_000, discountKobo: 0 }],
      sendNow: true,
    },
  });
  assert.equal(invRes.status, 201);
  const inv = invRes.json.invoice;

  await apiCall('/api/v2/payments', {
    method: 'POST',
    token,
    body: {
      debtId: inv.debtId,
      amountKobo: 100_000,
      paymentMethod: 'Cash',
      paymentDate: today,
      idempotencyKey: 'export-pay-1',
    },
  });

  const exp = await apiCall('/api/account/export', { token });
  assert.equal(exp.status, 200);
  assert.equal(exp.json.invoices.length, 1);
  assert.equal(exp.json.payments.length, 1);
  assert.ok(exp.json.debts.length >= 1);
  assert.ok(exp.json.auditLog.length >= 2);

  // Delete account cleanly cascades all V2 records and invalidates public link
  const del = await apiCall('/api/account', { method: 'DELETE', token });
  assert.equal(del.status, 200);
  const pubAfterDel = await apiCall(`/api/v2/public/invoices/${inv.publicId}`);
  assert.equal(pubAfterDel.status, 404);
});

