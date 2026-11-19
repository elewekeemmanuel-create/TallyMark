import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCashBookDayView,
  buildCsv,
  calculateCloseDayVariance,
  computeOpeningCashForDate,
  groupDebtsByCustomer,
} from '../src/shared/cashbook';
import type {
  CreditSaleRecord,
  DayClosureRecord,
  LedgerEntryRecord,
  ReceiptRecord,
} from '../src/shared/types';

function makeEntry(partial: Partial<LedgerEntryRecord>): LedgerEntryRecord {
  return {
    id: partial.id || crypto.randomUUID(),
    businessId: 'biz-1',
    entryType: partial.entryType || 'SALE',
    entryKind: partial.entryKind || 'RECEIPT',
    amountKobo: partial.amountKobo ?? 0,
    cashReceivedKobo: partial.cashReceivedKobo ?? 0,
    paymentMethod: partial.paymentMethod ?? 'Cash',
    receiptId: partial.receiptId ?? null,
    creditSaleId: partial.creditSaleId ?? null,
    expenseId: partial.expenseId ?? null,
    parentEntryId: partial.parentEntryId ?? null,
    customerName: partial.customerName ?? '',
    customerPhone: partial.customerPhone ?? '',
    note: partial.note ?? '',
    soldBy: partial.soldBy ?? '',
    source: partial.source ?? 'manual',
    isCorrection: partial.isCorrection ?? false,
    correctionReason: partial.correctionReason ?? '',
    entryDate: partial.entryDate || '2026-05-01',
    createdAt: partial.createdAt || '2026-05-01T10:00:00.000Z',
    createdBy: 'user-1',
  };
}

test('computeOpeningCashForDate carries forward cash only and anchors to counted cash on closures', () => {
  const entries: LedgerEntryRecord[] = [
    makeEntry({
      id: 'e1',
      entryDate: '2026-05-01',
      entryType: 'SALE',
      entryKind: 'QUICK_SALE',
      amountKobo: 500_000,
      cashReceivedKobo: 500_000,
      paymentMethod: 'Cash',
    }),
    makeEntry({
      id: 'e2',
      entryDate: '2026-05-01',
      entryType: 'SALE',
      entryKind: 'RECEIPT',
      amountKobo: 1_200_000,
      cashReceivedKobo: 1_200_000,
      paymentMethod: 'Transfer', // should NOT affect Cash in Hand!
    }),
    makeEntry({
      id: 'e3',
      entryDate: '2026-05-01',
      entryType: 'EXPENSE',
      entryKind: 'EXPENSE',
      amountKobo: 150_000,
      paymentMethod: 'Cash',
    }),
  ];

  // Opening 1,000,000 kobo + 500,000 cash in - 150,000 cash out = 1,350,000 kobo
  const day2Opening = computeOpeningCashForDate(1_000_000, '2026-05-02', entries, []);
  assert.equal(day2Opening, 1_350_000);

  // If Day 1 was closed with actual counted cash of 1,300,000 kobo (₦500 short), Day 2 anchors to 1,300,000
  const closure: DayClosureRecord = {
    id: 'c1',
    businessId: 'biz-1',
    closeDate: '2026-05-01',
    openingCashKobo: 1_000_000,
    expectedCashKobo: 1_350_000,
    countedCashKobo: 1_300_000,
    varianceKobo: -50_000,
    totalSalesKobo: 1_700_000,
    quickSalesKobo: 500_000,
    receiptSalesKobo: 1_200_000,
    creditSalesKobo: 0,
    paymentsReceivedKobo: 0,
    expensesKobo: 150_000,
    netKobo: 1_550_000,
    note: 'Short 500',
    closedAt: '2026-05-01T19:00:00Z',
    closedBy: 'user-1',
  };
  const anchoredOpening = computeOpeningCashForDate(1_000_000, '2026-05-02', entries, [closure]);
  assert.equal(anchoredOpening, 1_300_000);
});

test('buildCashBookDayView computes running balance, cash separation, credit exclusion, and net accurately', () => {
  const entries: LedgerEntryRecord[] = [
    makeEntry({
      id: 'e1',
      entryDate: '2026-05-02',
      createdAt: '2026-05-02T09:00:00Z',
      entryType: 'SALE',
      entryKind: 'QUICK_SALE',
      amountKobo: 200_000,
      cashReceivedKobo: 200_000,
      paymentMethod: 'Cash',
    }),
    makeEntry({
      id: 'e2',
      entryDate: '2026-05-02',
      createdAt: '2026-05-02T10:00:00Z',
      entryType: 'SALE',
      entryKind: 'CREDIT_SALE',
      amountKobo: 400_000,
      cashReceivedKobo: 0,
      paymentMethod: 'Other',
    }),
    makeEntry({
      id: 'e3',
      entryDate: '2026-05-02',
      createdAt: '2026-05-02T11:00:00Z',
      entryType: 'PAYMENT_RECEIVED',
      entryKind: 'DEBT_PAYMENT',
      amountKobo: 150_000,
      cashReceivedKobo: 150_000,
      paymentMethod: 'POS',
    }),
    makeEntry({
      id: 'e4',
      entryDate: '2026-05-02',
      createdAt: '2026-05-02T12:00:00Z',
      entryType: 'EXPENSE',
      entryKind: 'EXPENSE',
      amountKobo: 50_000,
      paymentMethod: 'Cash',
    }),
  ];

  const view = buildCashBookDayView({
    date: '2026-05-02',
    businessOpeningCashKobo: 100_000,
    allEntries: entries,
    closures: [],
  });

  assert.equal(view.openingCashKobo, 100_000);
  assert.equal(view.moneyInTotalKobo, 350_000); // 200k quick cash + 150k POS debt payment (credit sale 0)
  assert.equal(view.moneyOutTotalKobo, 50_000);
  assert.equal(view.netKobo, 300_000);
  assert.equal(view.creditSalesGivenKobo, 400_000);
  assert.equal(view.closingCashInHandKobo, 250_000); // 100k open + 200k cash - 50k cash
  assert.equal(view.posInKobo, 150_000);
  assert.equal(view.closingTotalBalanceKobo, 400_000); // 100k + 300k net
  assert.equal(view.rows.length, 4);
  assert.equal(view.rows[0].runningBalanceKobo, 300_000);
  assert.equal(view.rows[1].runningBalanceKobo, 300_000); // credit sale doesn't alter cash balance
  assert.equal(view.rows[2].runningBalanceKobo, 450_000);
  assert.equal(view.rows[3].runningBalanceKobo, 400_000);
  assert.equal(calculateCloseDayVariance(250_000, 240_000), -10_000);
});

test('groupDebtsByCustomer aggregates part-paid receipts and unpaid credit sales with oldest age', () => {
  const receipts: ReceiptRecord[] = [
    {
      id: 'r1',
      businessId: 'biz-1',
      publicId: 'pub-1',
      sequenceNumber: 1,
      receiptNumber: 'RCT-0001',
      receiptKind: 'SALE',
      parentReceiptId: null,
      parentReceiptNumber: null,
      customerName: 'Bola Ade',
      customerPhone: '08031112222',
      items: [
        {
          description: 'Lace fabric',
          qty: 1,
          unitPriceKobo: 500_000,
          discountKobo: 0,
          grossKobo: 500_000,
          lineTotalKobo: 500_000,
        },
      ],
      subtotalKobo: 500_000,
      discountTotalKobo: 0,
      vatEnabled: false,
      vatMode: 'exclusive',
      vatRateBps: 750,
      vatKobo: 0,
      totalKobo: 500_000,
      initialPaidKobo: 200_000,
      amountPaidKobo: 200_000,
      balanceDueKobo: 300_000,
      paymentMethod: 'Cash',
      note: '',
      soldBy: '',
      source: 'manual',
      template: 'modern',
      status: 'PART_PAID',
      voidReason: null,
      voidedAt: null,
      issuedDateLagos: '2026-05-01',
      issuedAt: '2026-05-01T10:00:00Z',
      createdBy: 'u1',
    },
  ];
  const creditSales: CreditSaleRecord[] = [
    {
      id: 'cs1',
      businessId: 'biz-1',
      customerName: 'Bola Ade',
      customerPhone: '08031112222',
      itemNote: 'Headtie',
      totalKobo: 150_000,
      amountPaidKobo: 50_000,
      balanceDueKobo: 100_000,
      dueDate: '2026-05-15',
      soldBy: '',
      receiptId: null,
      status: 'PART_PAID',
      entryDate: '2026-05-04',
      createdAt: '2026-05-04T10:00:00Z',
      createdBy: 'u1',
    },
  ];

  const groups = groupDebtsByCustomer({
    todayDateLagos: '2026-05-06',
    receipts,
    creditSales,
  });

  assert.equal(groups.length, 1);
  assert.equal(groups[0].totalOwedKobo, 400_000);
  assert.equal(groups[0].oldestDebtDate, '2026-05-01');
  assert.equal(groups[0].oldestDebtAgeDays, 5);
  assert.equal(groups[0].openCount, 2);
});

test('buildCsv outputs UTF-8 BOM and properly escapes commas, quotes, and naira symbols', () => {
  const csv = buildCsv(['Name', 'Amount', 'Note'], [['Ngozi "CEO", Ltd', '₦12,500.00', 'Line 1\nLine 2']]);
  assert.ok(csv.startsWith('\uFEFFName,Amount,Note\r\n'));
  assert.ok(csv.includes('"Ngozi ""CEO"", Ltd","₦12,500.00","Line 1\nLine 2"'));
});
