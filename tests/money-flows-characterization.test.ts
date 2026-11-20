import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import test, { after, before } from 'node:test';
import cookieParser from 'cookie-parser';
import express from 'express';

// Isolate SQLite data directory before importing routes/db
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tallymark-v1-char-'));
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
  const rawBytes = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder('utf-8').decode(rawBytes);
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, json, text, rawBytes };
}

async function createOnboardedShop(email: string, prefix: string, openingCashKobo = 1_000_000, vatEnabled = false) {
  const ml = await apiCall('/api/auth/magic-link', {
    method: 'POST',
    body: { email, name: 'Shop Owner' },
  });
  assert.equal(ml.status, 200);
  const auth = await apiCall('/api/auth/magic-link/verify', {
    method: 'POST',
    body: { token: ml.json.token },
  });
  assert.equal(auth.status, 200);
  const token = auth.json.sessionToken as string;

  const biz = await apiCall('/api/business', {
    method: 'POST',
    token,
    body: {
      name: `Test Store ${prefix}`,
      address: '10 Aba Road, Port Harcourt',
      phone: '08030001111',
      email,
      brandColor: '#064E3B',
      receiptPrefix: prefix,
      currency: 'NGN',
      vatEnabled,
      vatMode: 'exclusive',
      openingCashKobo,
      defaultTemplate: 'modern',
    },
  });
  assert.equal(biz.status, 201);
  return { token, business: biz.json.business };
}

test('Characterization: Paid receipt with exclusive VAT, part-paid receipt, overpayment rejection, and sequential balance payments', async () => {
  const { token } = await createOnboardedShop('receipts.char@tallymark.ng', 'CHR-', 500_000, true);

  // 1. Issue PAID receipt with line discount and 7.5% exclusive VAT
  // Gross = 2 * ₦10,000 = ₦20,000; discount = ₦2,000; taxable = ₦18,000; VAT (7.5%) = ₦1,350; Total = ₦19,350 (1,935,000 kobo)
  const paidRes = await apiCall('/api/receipts', {
    method: 'POST',
    token,
    body: {
      customerName: 'Ngozi Okafor',
      customerPhone: '08031110000',
      items: [{ description: 'Ankara Wax Print', qty: 2, unitPriceKobo: 1_000_000, discountKobo: 200_000 }],
      paymentMethod: 'Cash',
      amountPaidKobo: 1_935_000,
      note: 'Paid in full',
      soldBy: 'Chidi',
      issuedDateLagos: '2026-06-01',
      template: 'modern',
      source: 'manual',
    },
  });
  assert.equal(paidRes.status, 201);
  assert.equal(paidRes.json.receipt.receiptNumber, 'CHR-0001');
  assert.equal(paidRes.json.receipt.subtotalKobo, 2_000_000);
  assert.equal(paidRes.json.receipt.discountTotalKobo, 200_000);
  assert.equal(paidRes.json.receipt.vatKobo, 135_000);
  assert.equal(paidRes.json.receipt.totalKobo, 1_935_000);
  assert.equal(paidRes.json.receipt.status, 'PAID');
  assert.equal(paidRes.json.receipt.balanceDueKobo, 0);

  // 2. Issue PART_PAID receipt: Total = ₦10,750 (1,075,000 kobo with 7.5% VAT), Paid = ₦4,000, Balance = ₦6,750
  const partRes = await apiCall('/api/receipts', {
    method: 'POST',
    token,
    body: {
      customerName: 'Emeka Obi',
      customerPhone: '08092223333',
      items: [{ description: 'Standing Fan', qty: 1, unitPriceKobo: 1_000_000, discountKobo: 0 }],
      paymentMethod: 'Transfer',
      amountPaidKobo: 400_000,
      note: 'Deposit received',
      soldBy: 'Chidi',
      issuedDateLagos: '2026-06-01',
      template: 'classic',
      source: 'manual',
    },
  });
  assert.equal(partRes.status, 201);
  const partReceipt = partRes.json.receipt;
  assert.equal(partReceipt.receiptNumber, 'CHR-0002');
  assert.equal(partReceipt.status, 'PART_PAID');
  assert.equal(partReceipt.totalKobo, 1_075_000);
  assert.equal(partReceipt.amountPaidKobo, 400_000);
  assert.equal(partReceipt.balanceDueKobo, 675_000);

  // 3. Overpayment is rejected and leaves receipt unchanged
  const overpayRes = await apiCall(`/api/receipts/${partReceipt.id}/receive-balance`, {
    method: 'POST',
    token,
    body: {
      amountKobo: 675_001,
      paymentMethod: 'Cash',
      issuedDateLagos: '2026-06-02',
    },
  });
  assert.equal(overpayRes.status, 400);

  // 4. Two balance payments settle CHR-0002 completely (CHR-0003 and CHR-0004)
  const bp1 = await apiCall(`/api/receipts/${partReceipt.id}/receive-balance`, {
    method: 'POST',
    token,
    body: {
      amountKobo: 275_000,
      paymentMethod: 'Cash',
      note: 'Second installment',
      issuedDateLagos: '2026-06-02',
    },
  });
  assert.equal(bp1.status, 201);
  assert.equal(bp1.json.receipt.receiptNumber, 'CHR-0003');
  assert.equal(bp1.json.receipt.receiptKind, 'BALANCE_PAYMENT');
  assert.equal(bp1.json.parentReceipt.status, 'PART_PAID');
  assert.equal(bp1.json.parentReceipt.balanceDueKobo, 400_000);

  const bp2 = await apiCall(`/api/receipts/${partReceipt.id}/receive-balance`, {
    method: 'POST',
    token,
    body: {
      amountKobo: 400_000,
      paymentMethod: 'POS',
      note: 'Final settlement',
      issuedDateLagos: '2026-06-03',
    },
  });
  assert.equal(bp2.status, 201);
  assert.equal(bp2.json.receipt.receiptNumber, 'CHR-0004');
  assert.equal(bp2.json.parentReceipt.status, 'PAID');
  assert.equal(bp2.json.parentReceipt.balanceDueKobo, 0);

  // 5. Voiding an already-paid SALE receipt marks it VOID, rejects double-void, and posts negative reversal
  const voidSale = await apiCall(`/api/receipts/${paidRes.json.receipt.id}/void`, {
    method: 'POST',
    token,
    body: { reason: 'Customer returned goods unopened' },
  });
  assert.equal(voidSale.status, 200);
  assert.equal(voidSale.json.receipt.status, 'VOID');

  const doubleVoid = await apiCall(`/api/receipts/${paidRes.json.receipt.id}/void`, {
    method: 'POST',
    token,
    body: { reason: 'Duplicate void attempt' },
  });
  assert.equal(doubleVoid.status, 400);

  // Public receipt reflects VOID status
  const pubVoid = await apiCall(`/api/rpc/get_public_receipt/${paidRes.json.receipt.publicId}`);
  assert.equal(pubVoid.status, 200);
  assert.equal(pubVoid.json.receipt.status, 'VOID');
});

test('Characterization: Quick sale and later receipt conversion do not double-count Cash Book money in', async () => {
  const { token } = await createOnboardedShop('quicksale.char@tallymark.ng', 'QSL-', 100_000, false);

  // Record ₦7,500 Cash quick sale
  const qsRes = await apiCall('/api/sales/quick', {
    method: 'POST',
    token,
    body: {
      amountKobo: 750_000,
      itemNote: '3 bags of semovita',
      paymentMethod: 'Cash',
      customerName: 'Mama Tunde',
      customerPhone: '08051234567',
      soldBy: 'Sadiq',
      entryDate: '2026-06-05',
      source: 'manual',
    },
  });
  assert.equal(qsRes.status, 201);
  const entry = qsRes.json.entry;
  assert.equal(entry.entryType, 'SALE');
  assert.equal(entry.entryKind, 'QUICK_SALE');
  assert.equal(entry.cashReceivedKobo, 750_000);
  assert.equal(entry.receiptId, null);

  const cbBefore = await apiCall('/api/cashbook?date=2026-06-05', { token });
  assert.equal(cbBefore.status, 200);
  assert.equal(cbBefore.json.dayView.moneyInTotalKobo, 750_000);
  assert.equal(cbBefore.json.dayView.closingCashInHandKobo, 850_000); // 100k opening + 750k

  // Issue an official receipt for that quick sale later
  const issued1 = await apiCall(`/api/ledger/${entry.id}/issue-receipt`, {
    method: 'POST',
    token,
  });
  assert.equal(issued1.status, 201);
  assert.equal(issued1.json.receipt.receiptNumber, 'QSL-0001');
  assert.equal(issued1.json.receipt.totalKobo, 750_000);
  assert.equal(issued1.json.receipt.status, 'PAID');

  // Calling issue-receipt again returns the exact same receipt (idempotent, no duplicate sequence)
  const issued2 = await apiCall(`/api/ledger/${entry.id}/issue-receipt`, {
    method: 'POST',
    token,
  });
  assert.equal(issued2.status, 201);
  assert.equal(issued2.json.receipt.id, issued1.json.receipt.id);
  assert.equal(issued2.json.receipt.receiptNumber, 'QSL-0001');

  // Cash Book money-in MUST remain ₦7,500 (zero double-counting!)
  const cbAfter = await apiCall('/api/cashbook?date=2026-06-05', { token });
  assert.equal(cbAfter.status, 200);
  assert.equal(cbAfter.json.dayView.moneyInTotalKobo, 750_000);
  assert.equal(cbAfter.json.dayView.closingCashInHandKobo, 850_000);
});

test('Characterization: Credit sales, balances owed grouping, debt payments, and overpayment protection', async () => {
  const { token } = await createOnboardedShop('credit.char@tallymark.ng', 'CRD-', 200_000, false);

  // 1. Credit sale of ₦25,000 to Musa Ibrahim (0 money received today!)
  const csRes = await apiCall('/api/sales/credit', {
    method: 'POST',
    token,
    body: {
      customerName: 'Musa Ibrahim',
      customerPhone: '08039998888',
      amountKobo: 2_500_000,
      itemNote: '10 cartons of noodles',
      dueDate: '2026-06-20',
      soldBy: 'Amina',
      entryDate: '2026-06-10',
      source: 'manual',
    },
  });
  assert.equal(csRes.status, 201);
  const creditSale = csRes.json.creditSale;
  assert.equal(creditSale.status, 'UNPAID');
  assert.equal(creditSale.balanceDueKobo, 2_500_000);

  // 2. Also issue a part-paid receipt to a second customer (total ₦10,000, paid ₦4,000 Cash, balance ₦6,000)
  // Note: Distinct customer name avoids pre-existing SQLite DQS=0 bug at src/server/routes.ts:371 (flagged in Step 0 audit).
  const rRes = await apiCall('/api/receipts', {
    method: 'POST',
    token,
    body: {
      customerName: 'Kemi Balogun',
      customerPhone: '08037771111',
      items: [{ description: 'Cooking Gas Refill', qty: 1, unitPriceKobo: 1_000_000, discountKobo: 0 }],
      paymentMethod: 'Cash',
      amountPaidKobo: 400_000,
      issuedDateLagos: '2026-06-10',
      source: 'manual',
    },
  });
  assert.equal(rRes.status, 201);

  // Cash book on 2026-06-10: money in = ONLY ₦4,000 (credit sale adds 0 to money in, recorded under creditSalesGivenKobo)
  const cb = await apiCall('/api/cashbook?date=2026-06-10', { token });
  assert.equal(cb.status, 200);
  assert.equal(cb.json.dayView.moneyInTotalKobo, 400_000);
  assert.equal(cb.json.dayView.creditSalesGivenKobo, 2_500_000);
  assert.equal(cb.json.dayView.closingCashInHandKobo, 600_000); // 200k open + 400k cash

  // Debtors endpoint tracks both open debts totaling ₦31,000 (3,100,000 kobo)
  const debtors1 = await apiCall('/api/debtors', { token });
  assert.equal(debtors1.status, 200);
  assert.equal(debtors1.json.totalOwedKobo, 3_100_000);
  assert.equal(debtors1.json.debtors.length, 2);

  // 3. Overpayment on credit sale is rejected
  const overpay = await apiCall('/api/debts/record-payment', {
    method: 'POST',
    token,
    body: {
      debtKind: 'CREDIT_SALE',
      debtId: creditSale.id,
      amountKobo: 2_600_000,
      paymentMethod: 'Transfer',
      issuedDateLagos: '2026-06-11',
    },
  });
  assert.equal(overpay.status, 400);

  // 4. Record partial payment of ₦10,000 via Transfer on credit sale -> issues linked receipt + reduces debt to ₦15,000
  const pay1 = await apiCall('/api/debts/record-payment', {
    method: 'POST',
    token,
    body: {
      debtKind: 'CREDIT_SALE',
      debtId: creditSale.id,
      amountKobo: 1_000_000,
      paymentMethod: 'Transfer',
      note: 'Part payment via GTBank',
      issuedDateLagos: '2026-06-11',
    },
  });
  assert.equal(pay1.status, 201);
  assert.equal(pay1.json.receipt.receiptKind, 'BALANCE_PAYMENT');
  assert.equal(pay1.json.receipt.totalKobo, 1_000_000);

  const debtors2 = await apiCall('/api/debtors', { token });
  assert.equal(debtors2.json.totalOwedKobo, 2_100_000); // 1.5m credit + 600k receipt

  // 5. Pay remaining ₦15,000 on credit sale and ₦6,000 on receipt -> totalOwedKobo drops to 0
  const pay2 = await apiCall('/api/debts/record-payment', {
    method: 'POST',
    token,
    body: {
      debtKind: 'CREDIT_SALE',
      debtId: creditSale.id,
      amountKobo: 1_500_000,
      paymentMethod: 'Cash',
      issuedDateLagos: '2026-06-12',
    },
  });
  assert.equal(pay2.status, 201);

  const pay3 = await apiCall('/api/debts/record-payment', {
    method: 'POST',
    token,
    body: {
      debtKind: 'RECEIPT',
      debtId: rRes.json.receipt.id,
      amountKobo: 600_000,
      paymentMethod: 'POS',
      issuedDateLagos: '2026-06-12',
    },
  });
  assert.equal(pay3.status, 201);

  const debtors3 = await apiCall('/api/debtors', { token });
  assert.equal(debtors3.json.totalOwedKobo, 0);
  assert.equal(debtors3.json.debtors.length, 0);
});

test('Characterization: Expenses lifecycle (create, edit with revision log, delete) and supplier creditor settlement', async () => {
  const { token } = await createOnboardedShop('expenses.char@tallymark.ng', 'EXP-', 1_000_000, false);

  // 1. Create Cash expense of ₦3,000
  const createExp = await apiCall('/api/expenses', {
    method: 'POST',
    token,
    body: {
      entryDate: '2026-06-15',
      amountKobo: 300_000,
      category: 'Transport',
      payee: 'Keke Rider',
      paymentMethod: 'Cash',
      note: 'Market run',
      source: 'manual',
    },
  });
  assert.equal(createExp.status, 201);
  const expId = createExp.json.expense.id;

  // Cash in hand drops from ₦10,000 to ₦7,000
  const cb1 = await apiCall('/api/cashbook?date=2026-06-15', { token });
  assert.equal(cb1.json.dayView.closingCashInHandKobo, 700_000);

  // 2. Edit expense amount to ₦4,500 -> updates ledger & logs EDIT revision
  const editExp = await apiCall(`/api/expenses/${expId}`, {
    method: 'PATCH',
    token,
    body: { amountKobo: 450_000, reason: 'Corrected fuel surcharge' },
  });
  assert.equal(editExp.status, 200);
  assert.equal(editExp.json.expense.amountKobo, 450_000);

  const cb2 = await apiCall('/api/cashbook?date=2026-06-15', { token });
  assert.equal(cb2.json.dayView.closingCashInHandKobo, 550_000);

  // 3. Soft-delete expense -> removes ledger impact & logs DELETE revision
  const delExp = await apiCall(`/api/expenses/${expId}`, { method: 'DELETE', token });
  assert.equal(delExp.status, 200);

  const cb3 = await apiCall('/api/cashbook?date=2026-06-15', { token });
  assert.equal(cb3.json.dayView.closingCashInHandKobo, 1_000_000);

  const revs = await apiCall(`/api/expenses/${expId}/revisions`, { token });
  assert.equal(revs.status, 200);
  assert.equal(revs.json.revisions.length, 2);
  assert.deepEqual(
    revs.json.revisions.map((r: any) => r.action).sort(),
    ['DELETE', 'EDIT']
  );

  // 4. Creditor creation & marking paid as an expense posts an EXPENSE ledger entry
  const credRes = await apiCall('/api/creditors', {
    method: 'POST',
    token,
    body: {
      supplierName: 'Dangote Depot',
      phone: '08021112222',
      description: '5 bags of flour',
      amountKobo: 250_000,
      dueDate: '2026-06-20',
    },
  });
  assert.equal(credRes.status, 201);

  const markPaid = await apiCall(`/api/creditors/${credRes.json.creditor.id}/mark-paid`, {
    method: 'POST',
    token,
    body: {
      paymentMethod: 'Cash',
      recordAsExpense: true,
      entryDate: '2026-06-15',
      note: 'Paid depot driver',
    },
  });
  assert.equal(markPaid.status, 200);
  assert.equal(markPaid.json.creditor.status, 'PAID');
  assert.ok(markPaid.json.creditor.expenseId);

  const cb4 = await apiCall('/api/cashbook?date=2026-06-15', { token });
  assert.equal(cb4.json.dayView.closingCashInHandKobo, 750_000); // 1,000,000 - 250,000
});

test('Characterization: Close-the-day anchors next-day opening cash, blocks mutations, and reports separate Sold vs Received + CSV exports', async () => {
  const { token } = await createOnboardedShop('reports.char@tallymark.ng', 'RPT-', 500_000, false);

  // Day 1 (2026-06-20):
  // - Opening Cash: ₦5,000 (500,000)
  // - Receipt sale (Cash): ₦12,000 (1,200,000) paid in full
  // - Quick sale (POS): ₦8,000 (800,000)
  // - Credit sale (unpaid): ₦15,000 (1,500,000) -> 0 money received!
  // - Expense (Cash): ₦2,000 (200,000)
  await apiCall('/api/receipts', {
    method: 'POST',
    token,
    body: {
      customerName: 'Tola Adebayo',
      items: [{ description: 'Blender', qty: 1, unitPriceKobo: 1_200_000, discountKobo: 0 }],
      paymentMethod: 'Cash',
      amountPaidKobo: 1_200_000,
      soldBy: 'Tunde',
      issuedDateLagos: '2026-06-20',
      source: 'manual',
    },
  });
  await apiCall('/api/sales/quick', {
    method: 'POST',
    token,
    body: {
      amountKobo: 800_000,
      itemNote: 'Extension box',
      paymentMethod: 'POS',
      soldBy: 'Tunde',
      entryDate: '2026-06-20',
      source: 'manual',
    },
  });
  await apiCall('/api/sales/credit', {
    method: 'POST',
    token,
    body: {
      customerName: 'Uche Nwosu',
      customerPhone: '08037776666',
      amountKobo: 1_500_000,
      itemNote: 'Stabilizer',
      soldBy: 'Tunde',
      entryDate: '2026-06-20',
      source: 'manual',
    },
  });
  await apiCall('/api/expenses', {
    method: 'POST',
    token,
    body: {
      entryDate: '2026-06-20',
      amountKobo: 200_000,
      category: 'Utilities',
      payee: 'NEPA',
      paymentMethod: 'Cash',
      note: 'Prepaid meter',
      source: 'manual',
    },
  });

  // Expected Cash in Hand = 500k + 1,200k - 200k = 1,500,000 (₦15,000)
  // Close Day 1 with counted cash = ₦14,800 (1,480,000) -> variance = -20,000 (-₦200)
  const close1 = await apiCall('/api/cashbook/close', {
    method: 'POST',
    token,
    body: {
      closeDate: '2026-06-20',
      countedCashKobo: 1_480_000,
      note: 'Short 200 naira',
    },
  });
  assert.equal(close1.status, 201);
  assert.equal(close1.json.closure.expectedCashKobo, 1_500_000);
  assert.equal(close1.json.closure.varianceKobo, -20_000);

  // Quick sale & credit sale are blocked on closed day 2026-06-20
  const qsClosed = await apiCall('/api/sales/quick', {
    method: 'POST',
    token,
    body: { amountKobo: 100_000, paymentMethod: 'Cash', entryDate: '2026-06-20' },
  });
  assert.equal(qsClosed.status, 409);
  assert.equal(qsClosed.json.code, 'CLOSED_DAY');

  const csClosed = await apiCall('/api/sales/credit', {
    method: 'POST',
    token,
    body: { customerName: 'Late Buyer', amountKobo: 100_000, entryDate: '2026-06-20' },
  });
  assert.equal(csClosed.status, 409);
  assert.equal(csClosed.json.code, 'CLOSED_DAY');

  // Day 2 (2026-06-21) opening cash anchors to Day 1's counted cash (₦14,800)
  const cbDay2 = await apiCall('/api/cashbook?date=2026-06-21', { token });
  assert.equal(cbDay2.status, 200);
  assert.equal(cbDay2.json.dayView.openingCashKobo, 1_480_000);

  // Reports accurately separate Sold (₦35,000) from Money Received (₦20,000)
  const repRes = await apiCall('/api/reports?dateFrom=2026-06-20&dateTo=2026-06-21', { token });
  assert.equal(repRes.status, 200);
  const report = repRes.json.report;
  assert.equal(report.receiptSalesKobo, 1_200_000);
  assert.equal(report.quickSalesKobo, 800_000);
  assert.equal(report.creditSalesGivenKobo, 1_500_000);
  assert.equal(report.salesTotalKobo, 3_500_000); // Sold = 1.2m + 0.8m + 1.5m
  assert.equal(report.moneyInTotalKobo, 2_000_000); // Received = 1.2m Cash + 0.8m POS (credit excluded!)
  assert.equal(report.expensesTotalKobo, 200_000);
  assert.equal(report.netMoneyInMinusOutKobo, 1_800_000);
  assert.equal(report.outstandingDebtsKobo, 1_500_000);
  assert.equal(report.byExpenseCategory.length, 1);
  assert.equal(report.byExpenseCategory[0].category, 'Utilities');
  assert.equal(report.bySoldBy[0].soldBy, 'Tunde');

  // CSV exports return UTF-8 BOM (EF BB BF) + expected content for all 4 V1 report types
  for (const type of ['ledger', 'receipts', 'expenses', 'debtors']) {
    const csvRes = await apiCall(`/api/reports/csv?type=${type}&dateFrom=2026-06-20&dateTo=2026-06-21`, { token });
    assert.equal(csvRes.status, 200);
    assert.deepEqual(
      Array.from(csvRes.rawBytes.slice(0, 3)),
      [0xef, 0xbb, 0xbf],
      `CSV ${type} should start with UTF-8 BOM`
    );
    assert.ok(csvRes.text.includes('₦'), `CSV ${type} should contain formatted Naira amounts`);
  }
});
