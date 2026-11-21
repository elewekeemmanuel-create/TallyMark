import type {
  CashBookDayView,
  CashBookRow,
  CreditSaleRecord,
  DayClosureRecord,
  DebtItemSummary,
  DebtorCustomerGroup,
  LedgerEntryRecord,
  ReceiptRecord,
} from './types';

export function shiftLagosDate(yyyyMmDd: string, deltaDays: number): string {
  const parts = yyyyMmDd.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return yyyyMmDd;
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + deltaDays, 12, 0, 0));
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function diffDaysLagos(fromDate: string, toDate: string): number {
  const a = Date.parse(`${fromDate}T12:00:00Z`);
  const b = Date.parse(`${toDate}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * Signed cash flow delta of a single ledger entry (in integer kobo).
 * - SALE / PAYMENT_RECEIVED: +cashReceivedKobo (Credit sales have 0 until paid)
 * - EXPENSE: -amountKobo
 * - ADJUSTMENT: cashReceivedKobo (negative for void reversal or OUT correction, positive for IN correction)
 */
export function getEntrySignedFlow(entry: Pick<LedgerEntryRecord, 'entryType' | 'amountKobo' | 'cashReceivedKobo'>): {
  moneyInKobo: number;
  moneyOutKobo: number;
  signedCashFlowKobo: number;
} {
  if (entry.entryType === 'SALE' || entry.entryType === 'PAYMENT_RECEIVED') {
    const inKobo = Math.max(0, entry.cashReceivedKobo);
    return { moneyInKobo: inKobo, moneyOutKobo: 0, signedCashFlowKobo: inKobo };
  }
  if (entry.entryType === 'EXPENSE') {
    const outKobo = Math.abs(entry.amountKobo);
    return { moneyInKobo: 0, moneyOutKobo: outKobo, signedCashFlowKobo: -outKobo };
  }
  // ADJUSTMENT (void reversal or closed-day correction)
  const delta = entry.cashReceivedKobo;
  if (delta >= 0) {
    return { moneyInKobo: delta, moneyOutKobo: 0, signedCashFlowKobo: delta };
  }
  return { moneyInKobo: 0, moneyOutKobo: Math.abs(delta), signedCashFlowKobo: delta };
}

/**
 * Computes opening Cash in Hand for `targetDate` by carrying forward from:
 * 1. The most recent closed day strictly before `targetDate` (its countedCashKobo), PLUS
 * 2. Any Cash ledger entries strictly between that closed date and `targetDate`.
 * If no prior day was closed, starts from `businessOpeningCashKobo` plus all prior Cash ledger entries.
 */
export function computeOpeningCashForDate(
  businessOpeningCashKobo: number,
  targetDate: string,
  allEntries: LedgerEntryRecord[],
  closures: DayClosureRecord[]
): number {
  const priorClosures = closures
    .filter((c) => c.closeDate < targetDate)
    .sort((a, b) => b.closeDate.localeCompare(a.closeDate));

  const anchor = priorClosures[0] || null;
  let cash = anchor ? anchor.countedCashKobo : businessOpeningCashKobo;

  for (const entry of allEntries) {
    if (entry.entryDate >= targetDate) continue;
    if (anchor && entry.entryDate <= anchor.closeDate) continue;
    const method = entry.paymentMethod || 'Cash';
    if (method !== 'Cash') continue;
    cash += getEntrySignedFlow(entry).signedCashFlowKobo;
  }

  return cash;
}

/**
 * Pure daily cash book calculator with per-method separation & chronological running balance.
 */
export function buildCashBookDayView(params: {
  date: string;
  businessOpeningCashKobo: number;
  allEntries: LedgerEntryRecord[];
  closures: DayClosureRecord[];
}): CashBookDayView {
  const { date, businessOpeningCashKobo, allEntries, closures } = params;
  const closure = closures.find((c) => c.closeDate === date) || null;
  const openingCashKobo = computeOpeningCashForDate(
    businessOpeningCashKobo,
    date,
    allEntries,
    closures
  );

  const dayEntries = allEntries
    .filter((e) => e.entryDate === date)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  let runningTotal = openingCashKobo;
  let runningCash = openingCashKobo;

  let moneyInTotalKobo = 0;
  let moneyOutTotalKobo = 0;
  let cashInKobo = 0;
  let cashOutKobo = 0;
  let transferInKobo = 0;
  let transferOutKobo = 0;
  let posInKobo = 0;
  let posOutKobo = 0;
  let otherInKobo = 0;
  let otherOutKobo = 0;

  let receiptSalesKobo = 0;
  let quickSalesKobo = 0;
  let creditSalesGivenKobo = 0;
  let paymentsReceivedKobo = 0;

  const rows: CashBookRow[] = [];

  for (const entry of dayEntries) {
    const { moneyInKobo, moneyOutKobo, signedCashFlowKobo } = getEntrySignedFlow(entry);
    const method = entry.paymentMethod || 'Cash';

    runningTotal += signedCashFlowKobo;
    if (method === 'Cash') {
      runningCash += signedCashFlowKobo;
      cashInKobo += moneyInKobo;
      cashOutKobo += moneyOutKobo;
    } else if (method === 'Transfer') {
      transferInKobo += moneyInKobo;
      transferOutKobo += moneyOutKobo;
    } else if (method === 'POS' || method === 'Card') {
      posInKobo += moneyInKobo;
      posOutKobo += moneyOutKobo;
    } else {
      otherInKobo += moneyInKobo;
      otherOutKobo += moneyOutKobo;
    }

    moneyInTotalKobo += moneyInKobo;
    moneyOutTotalKobo += moneyOutKobo;

    if (entry.entryType === 'SALE') {
      if (entry.entryKind === 'QUICK_SALE') {
        quickSalesKobo += entry.cashReceivedKobo;
      } else if (entry.entryKind === 'CREDIT_SALE') {
        creditSalesGivenKobo += entry.amountKobo;
      } else {
        receiptSalesKobo += entry.cashReceivedKobo;
      }
    } else if (entry.entryType === 'PAYMENT_RECEIVED') {
      paymentsReceivedKobo += entry.cashReceivedKobo;
    }

    rows.push({
      entry,
      moneyInKobo,
      moneyOutKobo,
      signedCashFlowKobo,
      runningBalanceKobo: runningTotal,
      runningCashInHandKobo: runningCash,
    });
  }

  return {
    date,
    isClosed: Boolean(closure),
    closure,
    openingCashKobo,
    closingCashInHandKobo: runningCash,
    closingTotalBalanceKobo: runningTotal,
    moneyInTotalKobo,
    moneyOutTotalKobo,
    netKobo: moneyInTotalKobo - moneyOutTotalKobo,
    cashInKobo,
    cashOutKobo,
    transferInKobo,
    transferOutKobo,
    posInKobo,
    posOutKobo,
    otherInKobo,
    otherOutKobo,
    receiptSalesKobo,
    quickSalesKobo,
    creditSalesGivenKobo,
    paymentsReceivedKobo,
    rows,
  };
}

export function calculateCloseDayVariance(expectedCashKobo: number, countedCashKobo: number) {
  return countedCashKobo - expectedCashKobo;
}

/**
 * Aggregates all open debts (part-paid receipts + unpaid/part-paid credit sales) by customer.
 */
export function groupDebtsByCustomer(params: {
  todayDateLagos: string;
  receipts: ReceiptRecord[];
  creditSales: CreditSaleRecord[];
}): DebtorCustomerGroup[] {
  const { todayDateLagos, receipts, creditSales } = params;
  const groups = new Map<string, DebtorCustomerGroup>();

  const upsertGroup = (
    nameRaw: string,
    phoneRaw: string,
    debt: DebtItemSummary
  ) => {
    const cleanName = nameRaw.trim() || 'Walk-in Customer';
    const cleanPhone = phoneRaw.trim();
    const key = cleanPhone ? `${cleanName.toLowerCase()}::${cleanPhone}` : cleanName.toLowerCase();
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        customerKey: key,
        customerName: cleanName,
        customerPhone: cleanPhone,
        totalOwedKobo: debt.balanceDueKobo,
        oldestDebtDate: debt.issuedDate,
        oldestDebtAgeDays: debt.ageDays,
        openCount: 1,
        debts: [debt],
      });
    } else {
      existing.totalOwedKobo += debt.balanceDueKobo;
      existing.openCount += 1;
      if (debt.issuedDate < existing.oldestDebtDate) {
        existing.oldestDebtDate = debt.issuedDate;
        existing.oldestDebtAgeDays = debt.ageDays;
      }
      if (!existing.customerPhone && cleanPhone) {
        existing.customerPhone = cleanPhone;
      }
      existing.debts.push(debt);
    }
  };

  for (const r of receipts) {
    if (r.receiptKind === 'SALE' && r.status === 'PART_PAID' && r.balanceDueKobo > 0) {
      upsertGroup(r.customerName, r.customerPhone, {
        debtKind: 'RECEIPT',
        debtId: r.id,
        referenceLabel: r.receiptNumber,
        description: r.items.map((i) => i.description).join(', ') || 'Receipt balance',
        totalKobo: r.totalKobo,
        amountPaidKobo: r.amountPaidKobo,
        balanceDueKobo: r.balanceDueKobo,
        issuedDate: r.issuedDateLagos,
        dueDate: null,
        ageDays: diffDaysLagos(r.issuedDateLagos, todayDateLagos),
        status: r.status,
      });
    }
  }

  for (const cs of creditSales) {
    if (cs.status !== 'VOID' && cs.status !== 'PAID' && cs.balanceDueKobo > 0) {
      upsertGroup(cs.customerName, cs.customerPhone, {
        debtKind: 'CREDIT_SALE',
        debtId: cs.id,
        referenceLabel: `Credit · ${cs.entryDate}`,
        description: cs.itemNote || 'Credit sale',
        totalKobo: cs.totalKobo,
        amountPaidKobo: cs.amountPaidKobo,
        balanceDueKobo: cs.balanceDueKobo,
        issuedDate: cs.entryDate,
        dueDate: cs.dueDate,
        ageDays: diffDaysLagos(cs.entryDate, todayDateLagos),
        status: cs.status,
      });
    }
  }

  return Array.from(groups.values()).sort(
    (a, b) => b.totalOwedKobo - a.totalOwedKobo || b.oldestDebtAgeDays - a.oldestDebtAgeDays
  );
}

export function buildCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const escapeCell = (val: string | number | null | undefined) => {
    let s = val === null || val === undefined ? '' : String(val);
    if (/^[=+\-@\t\r]/.test(s) || /^[ \t]+[=+\-@]/.test(s)) {
      s = `'${s}`;
    }
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))];
  // Prepend UTF-8 BOM so Excel renders ₦ cleanly
  return `\uFEFF${lines.join('\r\n')}`;
}
