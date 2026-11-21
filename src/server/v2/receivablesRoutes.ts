import crypto from 'node:crypto';
import type { Response, Router } from 'express';
import { db, logError, runTransaction } from '../db.ts';
import { type AuthenticatedRequest, requireAuth } from '../auth.ts';
import { formatKobo, getLagosDateString, type CurrencyCode } from '../../shared/money.ts';
import { buildCsv, getEntrySignedFlow } from '../../shared/cashbook.ts';
import type { BusinessProfile, LedgerEntryRecord } from '../../shared/types.ts';
import {
  computeAgeingBucket,
  computeCustomerStatement,
  isQuoteExpired,
  isRemindedWithin3Days,
  type AgeingBucket,
  type StatementInvoiceInput,
  type StatementPaymentInput,
} from '../../shared/v2/money.ts';
import { LogReminderSchema, UpdateCustomerSchema } from '../../shared/v2/schemas.ts';
import type {
  AgeingBucketTotals,
  CustomerDirectoryItem,
  CustomerStatementRecord,
  PaymentReminderRecord,
  ReceivableItem,
  V2ReportsSummary,
} from '../../shared/v2/types.ts';
import { recordAnonymousAnalytics } from './analytics.ts';

export interface ReceivablesRoutesDeps {
  getOwnedBusiness: (userId: string) => BusinessProfile | null;
  logV2Audit: (
    businessId: string,
    actorId: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
    metadata?: Record<string, unknown>
  ) => void;
}

const DATE_YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function createEmptyAgeingTotals(): AgeingBucketTotals {
  return {
    notYetDueKobo: 0,
    notYetDueCount: 0,
    days1To7Kobo: 0,
    days1To7Count: 0,
    days8To30Kobo: 0,
    days8To30Count: 0,
    days30PlusKobo: 0,
    days30PlusCount: 0,
    totalOutstandingKobo: 0,
    totalOpenCount: 0,
  };
}

function addToAgeingTotals(totals: AgeingBucketTotals, bucket: AgeingBucket, balanceKobo: number) {
  totals.totalOutstandingKobo += balanceKobo;
  totals.totalOpenCount += 1;
  if (bucket === 'not_yet_due') {
    totals.notYetDueKobo += balanceKobo;
    totals.notYetDueCount += 1;
  } else if (bucket === '1_7') {
    totals.days1To7Kobo += balanceKobo;
    totals.days1To7Count += 1;
  } else if (bucket === '8_30') {
    totals.days8To30Kobo += balanceKobo;
    totals.days8To30Count += 1;
  } else {
    totals.days30PlusKobo += balanceKobo;
    totals.days30PlusCount += 1;
  }
}

function resolveCustomerIdByNameOrPhone(
  businessId: string,
  name: string,
  phone: string
): string | null {
  const cleanName = (name || '').trim();
  const cleanPhone = (phone || '').trim();
  if (!cleanName && !cleanPhone) return null;

  if (cleanName) {
    const byName = db
      .prepare('SELECT id FROM customers WHERE business_id = ? AND lower(name) = lower(?) LIMIT 1')
      .get(businessId, cleanName) as { id: string } | undefined;
    if (byName) return byName.id;
  }
  if (cleanPhone) {
    const byPhone = db
      .prepare('SELECT id FROM customers WHERE business_id = ? AND phone = ? LIMIT 1')
      .get(businessId, cleanPhone) as { id: string } | undefined;
    if (byPhone) return byPhone.id;
  }
  return null;
}

/**
 * Idempotently keeps V1 part-paid SALE receipts and V1 credit sales synchronized
 * inside the unified `debts` table so source filters, ageing buckets, reminders,
 * and statements cover invoices, quick credit, and part-paid receipts uniformly
 * without altering any V1 table or flow.
 */
export function syncLegacyDebtsForBusiness(businessId: string): void {
  const now = new Date().toISOString();

  // 1. Sync V1 part-paid SALE receipts
  const saleReceipts = db
    .prepare(
      `SELECT id, receipt_number, customer_name, customer_phone, issued_date_lagos,
              total_kobo, amount_paid_kobo, balance_due_kobo, status, issued_at
       FROM receipts
       WHERE business_id = ? AND receipt_kind = 'SALE'`
    )
    .all(businessId) as any[];

  for (const r of saleReceipts) {
    const existing = db
      .prepare("SELECT id, written_off_kobo FROM debts WHERE source_type = 'RECEIPT' AND source_id = ?")
      .get(r.id) as { id: string; written_off_kobo: number } | undefined;

    const bal = Math.max(0, Number(r.balance_due_kobo));
    const status =
      r.status === 'VOID'
        ? 'VOID'
        : bal === 0
        ? 'PAID'
        : Number(r.amount_paid_kobo) > 0
        ? 'PART_PAID'
        : 'OPEN';

    if (!existing) {
      if (r.status === 'PART_PAID' && bal > 0) {
        const custId = resolveCustomerIdByNameOrPhone(
          businessId,
          r.customer_name || '',
          r.customer_phone || ''
        );
        db.prepare(
          `INSERT OR IGNORE INTO debts (
            id, business_id, source_type, source_id, reference_number,
            customer_id, customer_name, customer_phone,
            issue_date, due_date, total_kobo, amount_paid_kobo, written_off_kobo,
            balance_due_kobo, status, created_at, updated_at
          ) VALUES (?, ?, 'RECEIPT', ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          businessId,
          r.id,
          r.receipt_number || '',
          custId,
          r.customer_name || 'Walk-in Customer',
          r.customer_phone || '',
          r.issued_date_lagos,
          Number(r.total_kobo),
          Number(r.amount_paid_kobo),
          bal,
          status,
          r.issued_at || now,
          now
        );
      }
    } else {
      db.prepare(
        `UPDATE debts
         SET amount_paid_kobo = ?, balance_due_kobo = ?, status = ?, updated_at = ?
         WHERE id = ?`
      ).run(Number(r.amount_paid_kobo), bal, status, now, existing.id);
    }
  }

  // 2. Sync V1 credit_sales
  const creditSales = db
    .prepare(
      `SELECT id, customer_name, customer_phone, item_note, entry_date, due_date,
              total_kobo, amount_paid_kobo, balance_due_kobo, status, created_at
       FROM credit_sales
       WHERE business_id = ?`
    )
    .all(businessId) as any[];

  for (const cs of creditSales) {
    const existing = db
      .prepare("SELECT id FROM debts WHERE source_type = 'CREDIT_SALE' AND source_id = ?")
      .get(cs.id) as { id: string } | undefined;

    const bal = Math.max(0, Number(cs.balance_due_kobo));
    const status =
      cs.status === 'VOID'
        ? 'VOID'
        : bal === 0 || cs.status === 'PAID'
        ? 'PAID'
        : Number(cs.amount_paid_kobo) > 0
        ? 'PART_PAID'
        : 'OPEN';

    if (!existing) {
      if (cs.status !== 'VOID' && cs.status !== 'PAID' && bal > 0) {
        const custId = resolveCustomerIdByNameOrPhone(
          businessId,
          cs.customer_name || '',
          cs.customer_phone || ''
        );
        const refLabel = cs.item_note
          ? `Credit · ${String(cs.item_note).slice(0, 32)}`
          : `Credit · ${cs.entry_date}`;
        db.prepare(
          `INSERT OR IGNORE INTO debts (
            id, business_id, source_type, source_id, reference_number,
            customer_id, customer_name, customer_phone,
            issue_date, due_date, total_kobo, amount_paid_kobo, written_off_kobo,
            balance_due_kobo, status, created_at, updated_at
          ) VALUES (?, ?, 'CREDIT_SALE', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          businessId,
          cs.id,
          refLabel,
          custId,
          cs.customer_name || 'Walk-in Customer',
          cs.customer_phone || '',
          cs.entry_date,
          cs.due_date || null,
          Number(cs.total_kobo),
          Number(cs.amount_paid_kobo),
          bal,
          status,
          cs.created_at || now,
          now
        );
      }
    } else {
      db.prepare(
        `UPDATE debts
         SET amount_paid_kobo = ?, balance_due_kobo = ?, status = ?, due_date = ?, updated_at = ?
         WHERE id = ?`
      ).run(Number(cs.amount_paid_kobo), bal, status, cs.due_date || null, now, existing.id);
    }
  }
}

function mapLedgerRowForReport(row: any): LedgerEntryRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    entryType: row.entry_type,
    entryKind: row.entry_kind || 'RECEIPT',
    amountKobo: Number(row.amount_kobo),
    cashReceivedKobo: Number(row.cash_received_kobo ?? 0),
    paymentMethod: row.payment_method || null,
    receiptId: row.receipt_id || null,
    receiptNumber: row.receipt_number || null,
    creditSaleId: row.credit_sale_id || null,
    expenseId: row.expense_id || null,
    parentEntryId: row.parent_entry_id || null,
    customerName: row.customer_name || '',
    customerPhone: row.customer_phone || '',
    note: row.note || '',
    soldBy: row.sold_by || '',
    source: row.source || 'manual',
    isCorrection: Boolean(row.is_correction),
    correctionReason: row.correction_reason || '',
    entryDate: row.entry_date,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export function attachV2ReceivablesAndReportsRoutes(
  router: Router,
  deps: ReceivablesRoutesDeps
) {
  const { getOwnedBusiness, logV2Audit } = deps;

  // =========================================================================
  // 1. UNIFIED "WHO OWES ME" RECEIVABLES WITH SOURCE & AGEING FILTERS
  // =========================================================================
  router.get('/receivables', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    try {
      syncLegacyDebtsForBusiness(business.id);

      const asOfRaw = typeof req.query.asOfDate === 'string' ? req.query.asOfDate.trim() : '';
      const asOfDate = DATE_YMD_RE.test(asOfRaw) ? asOfRaw : getLagosDateString();
      const sourceParam =
        typeof req.query.source === 'string' ? req.query.source.trim().toUpperCase() : 'ALL';
      const bucketParam =
        typeof req.query.bucket === 'string' ? req.query.bucket.trim().toLowerCase() : 'all';
      const search =
        typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

      const rows = db
        .prepare(
          `SELECT d.*,
                  i.public_id AS invoice_public_id,
                  r.public_id AS receipt_public_id,
                  (SELECT pr.sent_at FROM payment_reminders pr
                   WHERE pr.debt_id = d.id AND pr.business_id = d.business_id
                   ORDER BY pr.sent_at DESC LIMIT 1) AS last_reminder_at,
                  (SELECT pr.tone FROM payment_reminders pr
                   WHERE pr.debt_id = d.id AND pr.business_id = d.business_id
                   ORDER BY pr.sent_at DESC LIMIT 1) AS last_reminder_tone,
                  (SELECT COUNT(*) FROM payment_reminders pr
                   WHERE pr.debt_id = d.id AND pr.business_id = d.business_id) AS reminder_count
           FROM debts d
           LEFT JOIN invoices i ON d.source_type = 'INVOICE' AND i.id = d.source_id
           LEFT JOIN receipts r ON d.source_type = 'RECEIPT' AND r.id = d.source_id
           WHERE d.business_id = ?
             AND d.status IN ('OPEN', 'PART_PAID')
             AND d.balance_due_kobo > 0
           ORDER BY d.due_date ASC, d.issue_date ASC`
        )
        .all(business.id) as any[];

      const now = new Date();
      const allItems: ReceivableItem[] = rows.map((row) => {
        const ageing = computeAgeingBucket(row.due_date || null, row.issue_date, asOfDate);
        const publicId =
          row.source_type === 'INVOICE'
            ? row.invoice_public_id || null
            : row.source_type === 'RECEIPT'
            ? row.receipt_public_id || null
            : null;
        const publicPath =
          row.source_type === 'INVOICE' && publicId
            ? `/i/${publicId}`
            : row.source_type === 'RECEIPT' && publicId
            ? `/r/${publicId}`
            : null;
        const lastReminderAt = row.last_reminder_at || null;

        return {
          debtId: row.id,
          sourceType: row.source_type,
          sourceId: row.source_id,
          referenceNumber: row.reference_number || '',
          publicId,
          publicPath,
          customerId: row.customer_id || null,
          customerName: row.customer_name || 'Walk-in Customer',
          customerPhone: row.customer_phone || '',
          issueDate: row.issue_date,
          dueDate: row.due_date || null,
          effectiveDueDate: ageing.effectiveDueDate,
          daysOverdue: ageing.daysOverdue,
          ageingBucket: ageing.bucket,
          totalKobo: Number(row.total_kobo),
          amountPaidKobo: Number(row.amount_paid_kobo),
          writtenOffKobo: Number(row.written_off_kobo),
          balanceDueKobo: Number(row.balance_due_kobo),
          status: row.status === 'PART_PAID' ? 'PART_PAID' : 'OPEN',
          lastReminderAt,
          lastReminderTone:
            row.last_reminder_tone === 'firm' || row.last_reminder_tone === 'gentle'
              ? row.last_reminder_tone
              : null,
          reminderCount: Number(row.reminder_count || 0),
          remindedWithin3Days: isRemindedWithin3Days(lastReminderAt, now),
        };
      });

      // Compute ageing totals across source-matched items (before bucket filter)
      const sourceMatched = allItems.filter((item) => {
        if (sourceParam && sourceParam !== 'ALL' && item.sourceType !== sourceParam) {
          return false;
        }
        if (search) {
          const hay = `${item.customerName} ${item.customerPhone} ${item.referenceNumber}`.toLowerCase();
          if (!hay.includes(search)) return false;
        }
        return true;
      });

      const summary = createEmptyAgeingTotals();
      for (const item of sourceMatched) {
        addToAgeingTotals(summary, item.ageingBucket, item.balanceDueKobo);
      }

      const items = sourceMatched
        .filter((item) => {
          if (bucketParam && bucketParam !== 'all' && item.ageingBucket !== bucketParam) {
            return false;
          }
          return true;
        })
        .sort(
          (a, b) =>
            b.daysOverdue - a.daysOverdue ||
            b.balanceDueKobo - a.balanceDueKobo ||
            a.effectiveDueDate.localeCompare(b.effectiveDueDate)
        );

      res.json({ items, summary, asOfDate });
    } catch (err) {
      logError('v2_receivables_list', err, { userId: req.user!.id });
      res.status(500).json({ error: 'Unable to load unpaid balances' });
    }
  });

  // =========================================================================
  // 2. LOG WHATSAPP PAYMENT REMINDER (WITH 3-DAY DUPLICATE WARNING)
  // =========================================================================
  router.post('/reminders', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    const parsed = LogReminderSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid reminder request' });
      return;
    }

    const { debtId, tone, channel } = parsed.data;
    const now = new Date();
    const nowIso = now.toISOString();

    try {
      const result = runTransaction(() => {
        const debtRow = db
          .prepare('SELECT * FROM debts WHERE id = ? AND business_id = ?')
          .get(debtId, business.id) as any;

        if (!debtRow) {
          return { error: 'Balance record not found', status: 404 as const };
        }
        if (Number(debtRow.balance_due_kobo) <= 0 || !['OPEN', 'PART_PAID'].includes(debtRow.status)) {
          return { error: 'This balance is already closed', status: 400 as const };
        }

        const prevRow = db
          .prepare(
            `SELECT sent_at FROM payment_reminders
             WHERE business_id = ? AND debt_id = ?
             ORDER BY sent_at DESC LIMIT 1`
          )
          .get(business.id, debtRow.id) as { sent_at: string } | undefined;

        const previousReminderAt = prevRow?.sent_at || null;
        const warnedRecent = isRemindedWithin3Days(previousReminderAt, now);

        const reminderId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO payment_reminders (id, business_id, debt_id, customer_id, tone, channel, sent_at, sent_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          reminderId,
          business.id,
          debtRow.id,
          debtRow.customer_id || null,
          tone,
          channel,
          nowIso,
          req.user!.id
        );

        logV2Audit(business.id, req.user!.id, 'reminder_sent', 'debt', debtRow.id, {
          tone,
          channel,
          reference_number: debtRow.reference_number,
          warned_recent: warnedRecent,
        });

        const reminder: PaymentReminderRecord = {
          id: reminderId,
          businessId: business.id,
          debtId: debtRow.id,
          customerId: debtRow.customer_id || null,
          tone,
          channel,
          sentAt: nowIso,
          sentBy: req.user!.id,
        };

        return { reminder, warnedRecent, previousReminderAt };
      });

      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }

      recordAnonymousAnalytics('reminder_sent', '/app/debtors');
      res.status(201).json(result);
    } catch (err) {
      logError('v2_log_reminder', err, { userId: req.user!.id, debtId });
      res.status(500).json({ error: 'Unable to log payment reminder' });
    }
  });

  // =========================================================================
  // 3. CUSTOMERS DIRECTORY & CUSTOMER PROFILE + STATEMENT OF ACCOUNT
  // =========================================================================
  router.get('/customers', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    try {
      syncLegacyDebtsForBusiness(business.id);
      const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

      const customers = db
        .prepare('SELECT * FROM customers WHERE business_id = ? ORDER BY updated_at DESC, name ASC')
        .all(business.id) as any[];

      const invoices = db
        .prepare(
          `SELECT id, customer_id, customer_name, status, total_kobo, amount_paid_kobo,
                  written_off_kobo, balance_due_kobo, updated_at
           FROM invoices WHERE business_id = ?`
        )
        .all(business.id) as any[];

      const quotes = db
        .prepare('SELECT id, customer_id, customer_name, updated_at FROM quotes WHERE business_id = ?')
        .all(business.id) as any[];

      const receipts = db
        .prepare(
          `SELECT id, customer_name, customer_phone, receipt_kind, status, total_kobo,
                  amount_paid_kobo, balance_due_kobo, issued_at
           FROM receipts WHERE business_id = ? AND status <> 'VOID'`
        )
        .all(business.id) as any[];

      const creditSales = db
        .prepare(
          `SELECT id, customer_name, customer_phone, status, total_kobo,
                  amount_paid_kobo, balance_due_kobo, created_at
           FROM credit_sales WHERE business_id = ? AND status <> 'VOID'`
        )
        .all(business.id) as any[];

      const openDebts = db
        .prepare(
          `SELECT id, customer_id, customer_name, customer_phone, balance_due_kobo
           FROM debts WHERE business_id = ? AND status IN ('OPEN', 'PART_PAID') AND balance_due_kobo > 0`
        )
        .all(business.id) as any[];

      const items: CustomerDirectoryItem[] = customers.map((c) => {
        const nameLower = String(c.name || '').trim().toLowerCase();
        const phoneClean = String(c.phone || '').trim();

        const matchesCustomer = (rowCustId: string | null | undefined, rowName: string, rowPhone?: string) => {
          if (rowCustId && rowCustId === c.id) return true;
          if (!rowCustId && nameLower && String(rowName || '').trim().toLowerCase() === nameLower) {
            return true;
          }
          if (!rowCustId && phoneClean && rowPhone && String(rowPhone).trim() === phoneClean) {
            return true;
          }
          return false;
        };

        const cInvoices = invoices.filter((i) => matchesCustomer(i.customer_id, i.customer_name));
        const cQuotes = quotes.filter((qt) => matchesCustomer(qt.customer_id, qt.customer_name));
        const cReceipts = receipts.filter(
          (r) => r.receipt_kind === 'SALE' && matchesCustomer(null, r.customer_name, r.customer_phone)
        );
        const cCredits = creditSales.filter((cs) =>
          matchesCustomer(null, cs.customer_name, cs.customer_phone)
        );
        const cDebts = openDebts.filter((d) =>
          matchesCustomer(d.customer_id, d.customer_name, d.customer_phone)
        );

        let totalBilledKobo = 0;
        let totalPaidKobo = 0;
        let lastActivityAt = c.updated_at || c.created_at;

        for (const inv of cInvoices) {
          if (inv.status !== 'DRAFT' && inv.status !== 'VOID') {
            totalBilledKobo += Number(inv.total_kobo);
            totalPaidKobo += Number(inv.amount_paid_kobo);
          }
          if (inv.updated_at && inv.updated_at > lastActivityAt) lastActivityAt = inv.updated_at;
        }
        for (const r of cReceipts) {
          totalBilledKobo += Number(r.total_kobo);
          totalPaidKobo += Number(r.amount_paid_kobo);
          if (r.issued_at && r.issued_at > lastActivityAt) lastActivityAt = r.issued_at;
        }
        for (const cs of cCredits) {
          totalBilledKobo += Number(cs.total_kobo);
          totalPaidKobo += Number(cs.amount_paid_kobo);
          if (cs.created_at && cs.created_at > lastActivityAt) lastActivityAt = cs.created_at;
        }
        for (const qt of cQuotes) {
          if (qt.updated_at && qt.updated_at > lastActivityAt) lastActivityAt = qt.updated_at;
        }

        const balanceOwedKobo = cDebts.reduce((sum, d) => sum + Number(d.balance_due_kobo), 0);

        return {
          id: c.id,
          businessId: c.business_id,
          name: c.name,
          phone: c.phone || '',
          email: c.email || '',
          address: c.address || '',
          notes: c.notes || '',
          invoiceCount: cInvoices.length,
          quoteCount: cQuotes.length,
          receiptCount: cReceipts.length,
          creditSaleCount: cCredits.length,
          openDebtCount: cDebts.length,
          totalBilledKobo,
          totalPaidKobo,
          balanceOwedKobo,
          lastActivityAt,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
        };
      });

      const filtered = items
        .filter((c) => {
          if (!q) return true;
          return `${c.name} ${c.phone} ${c.email} ${c.address}`.toLowerCase().includes(q);
        })
        .sort(
          (a, b) =>
            b.balanceOwedKobo - a.balanceOwedKobo ||
            b.lastActivityAt.localeCompare(a.lastActivityAt)
        );

      res.json({ customers: filtered });
    } catch (err) {
      logError('v2_customers_list', err, { userId: req.user!.id });
      res.status(500).json({ error: 'Unable to load customers' });
    }
  });

  router.patch('/customers/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const parsed = UpdateCustomerSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid customer details' });
      return;
    }
    const customerId = String(req.params.id || '').trim();
    const existing = db
      .prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?')
      .get(customerId, business.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    const now = new Date().toISOString();
    const input = parsed.data;
    db.prepare(
      `UPDATE customers
       SET name = ?, phone = ?, email = ?, address = ?, notes = ?, updated_at = ?
       WHERE id = ? AND business_id = ?`
    ).run(
      input.name,
      input.phone,
      input.email,
      input.address,
      input.notes,
      now,
      customerId,
      business.id
    );
    const updated = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId) as any;
    res.json({
      customer: {
        id: updated.id,
        businessId: updated.business_id,
        name: updated.name,
        phone: updated.phone || '',
        email: updated.email || '',
        address: updated.address || '',
        notes: updated.notes || '',
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      },
    });
  });

  function loadCustomerData(business: BusinessProfile, customerId: string) {
    syncLegacyDebtsForBusiness(business.id);
    const customer = db
      .prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?')
      .get(customerId, business.id) as any;
    if (!customer) return null;

    const nameLower = String(customer.name || '').trim().toLowerCase();
    const phoneClean = String(customer.phone || '').trim();

    const invoices = db
      .prepare(
        `SELECT * FROM invoices
         WHERE business_id = ?
           AND (customer_id = ? OR (customer_id IS NULL AND lower(customer_name) = ?))
         ORDER BY issue_date DESC, created_at DESC`
      )
      .all(business.id, customer.id, nameLower) as any[];

    const quotes = db
      .prepare(
        `SELECT * FROM quotes
         WHERE business_id = ?
           AND (customer_id = ? OR (customer_id IS NULL AND lower(customer_name) = ?))
         ORDER BY issue_date DESC, created_at DESC`
      )
      .all(business.id, customer.id, nameLower) as any[];

    const receipts = db
      .prepare(
        `SELECT * FROM receipts
         WHERE business_id = ?
           AND (lower(customer_name) = ? OR (? <> '' AND customer_phone = ?))
         ORDER BY issued_date_lagos DESC, sequence_number DESC`
      )
      .all(business.id, nameLower, phoneClean, phoneClean) as any[];

    const creditSales = db
      .prepare(
        `SELECT * FROM credit_sales
         WHERE business_id = ?
           AND (lower(customer_name) = ? OR (? <> '' AND customer_phone = ?))
         ORDER BY entry_date DESC, created_at DESC`
      )
      .all(business.id, nameLower, phoneClean, phoneClean) as any[];

    const debts = db
      .prepare(
        `SELECT * FROM debts
         WHERE business_id = ?
           AND (customer_id = ? OR (customer_id IS NULL AND (lower(customer_name) = ? OR (? <> '' AND customer_phone = ?))))
         ORDER BY issue_date DESC, created_at DESC`
      )
      .all(business.id, customer.id, nameLower, phoneClean, phoneClean) as any[];

    const debtIds = debts.map((d) => String(d.id));
    let payments: any[] = [];
    let reminders: any[] = [];
    if (debtIds.length > 0) {
      const placeholders = debtIds.map(() => '?').join(', ');
      payments = db
        .prepare(
          `SELECT p.*, r.receipt_number, d.reference_number AS debt_reference
           FROM payments p
           LEFT JOIN receipts r ON r.id = p.receipt_id
           LEFT JOIN debts d ON d.id = p.debt_id
           WHERE p.business_id = ? AND p.debt_id IN (${placeholders})
           ORDER BY p.payment_date DESC, p.created_at DESC`
        )
        .all(business.id, ...debtIds) as any[];

      reminders = db
        .prepare(
          `SELECT pr.*, d.reference_number
           FROM payment_reminders pr
           LEFT JOIN debts d ON d.id = pr.debt_id
           WHERE pr.business_id = ? AND pr.debt_id IN (${placeholders})
           ORDER BY pr.sent_at DESC LIMIT 30`
        )
        .all(business.id, ...debtIds) as any[];
    }

    return { customer, invoices, quotes, receipts, creditSales, debts, payments, reminders };
  }

  router.get('/customers/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    try {
      const data = loadCustomerData(business, String(req.params.id || '').trim());
      if (!data) {
        res.status(404).json({ error: 'Customer not found' });
        return;
      }

      const { customer, invoices, quotes, receipts, creditSales, debts, payments, reminders } = data;
      const openDebts = debts.filter(
        (d) => (d.status === 'OPEN' || d.status === 'PART_PAID') && Number(d.balance_due_kobo) > 0
      );
      const balanceOwedKobo = openDebts.reduce((sum, d) => sum + Number(d.balance_due_kobo), 0);

      res.json({
        customer: {
          id: customer.id,
          businessId: customer.business_id,
          name: customer.name,
          phone: customer.phone || '',
          email: customer.email || '',
          address: customer.address || '',
          notes: customer.notes || '',
          balanceOwedKobo,
          createdAt: customer.created_at,
          updatedAt: customer.updated_at,
        },
        invoices: invoices.map((i) => ({
          id: i.id,
          invoiceNumber: i.invoice_number,
          publicId: i.public_id,
          status: i.status,
          issueDate: i.issue_date,
          dueDate: i.due_date,
          totalKobo: Number(i.total_kobo),
          amountPaidKobo: Number(i.amount_paid_kobo),
          writtenOffKobo: Number(i.written_off_kobo),
          balanceDueKobo: Number(i.balance_due_kobo),
          currency: i.currency || business.currency,
        })),
        quotes: quotes.map((q) => ({
          id: q.id,
          quoteNumber: q.quote_number,
          publicId: q.public_id,
          status: q.status,
          isExpired: isQuoteExpired(q.status, q.valid_until),
          issueDate: q.issue_date,
          validUntil: q.valid_until,
          totalKobo: Number(q.total_kobo),
          currency: q.currency || business.currency,
        })),
        receipts: receipts.map((r) => ({
          id: r.id,
          receiptNumber: r.receipt_number,
          receiptKind: r.receipt_kind,
          publicId: r.public_id,
          status: r.status,
          issuedDateLagos: r.issued_date_lagos,
          totalKobo: Number(r.total_kobo),
          amountPaidKobo: Number(r.amount_paid_kobo),
          balanceDueKobo: Number(r.balance_due_kobo),
        })),
        creditSales: creditSales.map((cs) => ({
          id: cs.id,
          itemNote: cs.item_note || '',
          entryDate: cs.entry_date,
          dueDate: cs.due_date || null,
          status: cs.status,
          totalKobo: Number(cs.total_kobo),
          amountPaidKobo: Number(cs.amount_paid_kobo),
          balanceDueKobo: Number(cs.balance_due_kobo),
        })),
        payments: payments.map((p) => ({
          id: p.id,
          debtId: p.debt_id,
          invoiceId: p.invoice_id || null,
          receiptId: p.receipt_id || null,
          receiptNumber: p.receipt_number || null,
          debtReference: p.debt_reference || '',
          amountKobo: Number(p.amount_kobo),
          paymentMethod: p.payment_method,
          paymentDate: p.payment_date,
          reference: p.reference || '',
          isVoided: Boolean(p.is_voided),
          createdAt: p.created_at,
        })),
        reminders: reminders.map((rm) => ({
          id: rm.id,
          debtId: rm.debt_id,
          referenceNumber: rm.reference_number || '',
          tone: rm.tone,
          channel: rm.channel,
          sentAt: rm.sent_at,
        })),
      });
    } catch (err) {
      logError('v2_customer_detail', err, { userId: req.user!.id });
      res.status(500).json({ error: 'Unable to load customer profile' });
    }
  });

  // Customer Statement of Account (reconciled opening balance, invoices, payments, write-offs)
  router.get('/customers/:id/statement', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    const todayLagos = getLagosDateString();
    const rawFrom = String(req.query.from || req.query.dateFrom || '').trim();
    const rawTo = String(req.query.to || req.query.dateTo || '').trim();
    const fromDate = DATE_YMD_RE.test(rawFrom) ? rawFrom : `${todayLagos.slice(0, 7)}-01`;
    const toDate = DATE_YMD_RE.test(rawTo) ? rawTo : todayLagos;

    if (fromDate > toDate) {
      res.status(400).json({ error: 'Start date cannot be after end date' });
      return;
    }

    try {
      const data = loadCustomerData(business, String(req.params.id || '').trim());
      if (!data) {
        res.status(404).json({ error: 'Customer not found' });
        return;
      }

      const { customer, invoices, creditSales, receipts, payments } = data;

      const statementDocs: StatementInvoiceInput[] = [];
      const statementPays: StatementPaymentInput[] = [];

      // 1. V2 Invoices (non-DRAFT, non-VOID)
      for (const inv of invoices) {
        if (inv.status === 'DRAFT' || inv.status === 'VOID') continue;
        const writtenOffDate = inv.written_off_at
          ? getLagosDateString(new Date(inv.written_off_at))
          : null;
        statementDocs.push({
          id: inv.id,
          referenceNumber: inv.invoice_number || 'Invoice',
          issueDate: inv.issue_date,
          totalKobo: Number(inv.total_kobo),
          writtenOffKobo: Number(inv.written_off_kobo || 0),
          writtenOffDate,
          writeOffReason: inv.write_off_reason || null,
          status: inv.status,
          sourceType: 'INVOICE',
          createdAt: inv.created_at,
        });
      }

      // 2. V2 Payments (non-voided) recorded via `payments` table
      const trackedPaymentReceiptIds = new Set<string>();
      for (const p of payments) {
        if (p.receipt_id) trackedPaymentReceiptIds.add(String(p.receipt_id));
        if (p.is_voided) continue;
        statementPays.push({
          id: p.id,
          referenceNumber: p.reference || p.debt_reference || '',
          receiptNumber: p.receipt_number || null,
          paymentDate: p.payment_date,
          amountKobo: Number(p.amount_kobo),
          paymentMethod: p.payment_method,
          isVoided: false,
          createdAt: p.created_at,
        });
      }

      // 3. V1 Credit sales + their V1 balance payments from ledger_entries (if not already in V2 `payments`)
      for (const cs of creditSales) {
        if (cs.status === 'VOID') continue;
        statementDocs.push({
          id: cs.id,
          referenceNumber: cs.item_note ? `Credit (${String(cs.item_note).slice(0, 24)})` : `Credit ${cs.entry_date}`,
          issueDate: cs.entry_date,
          totalKobo: Number(cs.total_kobo),
          writtenOffKobo: 0,
          writtenOffDate: null,
          status: cs.status,
          sourceType: 'CREDIT_SALE',
          createdAt: cs.created_at,
        });

        const v1CsPays = db
          .prepare(
            `SELECT l.id, l.amount_kobo, l.cash_received_kobo, l.payment_method,
                    l.entry_date, l.created_at, l.receipt_id, r.receipt_number
             FROM ledger_entries l
             LEFT JOIN receipts r ON r.id = l.receipt_id
             WHERE l.business_id = ?
               AND l.credit_sale_id = ?
               AND l.entry_type = 'PAYMENT_RECEIVED'
               AND l.payment_id IS NULL`
          )
          .all(business.id, cs.id) as any[];

        for (const lp of v1CsPays) {
          if (lp.receipt_id && trackedPaymentReceiptIds.has(String(lp.receipt_id))) continue;
          const amt = Number(lp.cash_received_kobo || lp.amount_kobo);
          if (amt > 0) {
            statementPays.push({
              id: `v1-cs-pay-${lp.id}`,
              referenceNumber: lp.receipt_number || 'Credit payment',
              receiptNumber: lp.receipt_number || null,
              paymentDate: lp.entry_date,
              amountKobo: amt,
              paymentMethod: lp.payment_method || 'Cash',
              isVoided: false,
              createdAt: lp.created_at,
            });
          }
        }
      }

      // 4. V1 Part-paid SALE receipts (only ones with initial credit balance)
      for (const r of receipts) {
        if (r.receipt_kind !== 'SALE' || r.status === 'VOID') continue;
        const initialBal = Number(r.total_kobo) - Number(r.initial_paid_kobo);
        if (initialBal <= 0) continue;

        statementDocs.push({
          id: r.id,
          referenceNumber: r.receipt_number,
          issueDate: r.issued_date_lagos,
          totalKobo: Number(r.total_kobo),
          writtenOffKobo: 0,
          writtenOffDate: null,
          status: r.status,
          sourceType: 'RECEIPT',
          createdAt: r.issued_at,
        });

        if (Number(r.initial_paid_kobo) > 0) {
          statementPays.push({
            id: `v1-rct-init-${r.id}`,
            referenceNumber: r.receipt_number,
            receiptNumber: r.receipt_number,
            paymentDate: r.issued_date_lagos,
            amountKobo: Number(r.initial_paid_kobo),
            paymentMethod: r.payment_method || 'Cash',
            isVoided: false,
            createdAt: r.issued_at,
          });
        }

        const childPays = db
          .prepare(
            `SELECT id, receipt_number, total_kobo, payment_method, issued_date_lagos, issued_at
             FROM receipts
             WHERE business_id = ?
               AND parent_receipt_id = ?
               AND receipt_kind = 'BALANCE_PAYMENT'
               AND status <> 'VOID'`
          )
          .all(business.id, r.id) as any[];

        for (const cp of childPays) {
          if (trackedPaymentReceiptIds.has(String(cp.id))) continue;
          statementPays.push({
            id: `v1-rct-bal-${cp.id}`,
            referenceNumber: r.receipt_number,
            receiptNumber: cp.receipt_number,
            paymentDate: cp.issued_date_lagos,
            amountKobo: Number(cp.total_kobo),
            paymentMethod: cp.payment_method || 'Cash',
            isVoided: false,
            createdAt: cp.issued_at,
          });
        }
      }

      const computed = computeCustomerStatement({
        fromDate,
        toDate,
        documents: statementDocs,
        payments: statementPays,
      });

      const statement: CustomerStatementRecord = {
        business: {
          name: business.name,
          logoDataUrl: business.logoDataUrl,
          address: business.address,
          phone: business.phone,
          email: business.email,
          tinRc: business.tinRc || '',
          brandColor: business.brandColor,
          currency: business.currency,
        },
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone || '',
          email: customer.email || '',
          address: customer.address || '',
        },
        generatedDateLagos: todayLagos,
        fromDate: computed.fromDate,
        toDate: computed.toDate,
        openingBalanceKobo: computed.openingBalanceKobo,
        periodDebitsKobo: computed.periodDebitsKobo,
        periodPaymentsKobo: computed.periodPaymentsKobo,
        periodWriteOffsKobo: computed.periodWriteOffsKobo,
        closingBalanceKobo: computed.closingBalanceKobo,
        lines: computed.lines,
      };

      res.json({ statement });
    } catch (err) {
      logError('v2_customer_statement', err, { userId: req.user!.id });
      res.status(500).json({ error: 'Unable to build customer statement' });
    }
  });

  // =========================================================================
  // 4. V2 REPORTS (SOLD VS RECEIVED, INVOICE AGEING, QUOTE CONVERSION)
  // =========================================================================
  router.get('/reports', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    const todayLagos = getLagosDateString();
    const rawFrom = String(req.query.dateFrom || req.query.from || '').trim();
    const rawTo = String(req.query.dateTo || req.query.to || '').trim();
    const dateFrom = DATE_YMD_RE.test(rawFrom) ? rawFrom : `${todayLagos.slice(0, 7)}-01`;
    const dateTo = DATE_YMD_RE.test(rawTo) ? rawTo : todayLagos;

    if (dateFrom > dateTo) {
      res.status(400).json({ error: 'Start date cannot be after end date' });
      return;
    }

    try {
      // 1. Ledger rows in range -> Received (actual money in) & direct V1 sales
      const rawLedgerRows = db
        .prepare(
          `SELECT l.*, r.receipt_number
           FROM ledger_entries l
           LEFT JOIN receipts r ON r.id = l.receipt_id
           WHERE l.business_id = ? AND l.entry_date >= ? AND l.entry_date <= ?
           ORDER BY l.entry_date ASC, l.created_at ASC`
        )
        .all(business.id, dateFrom, dateTo) as any[];

      let directSalesKobo = 0;
      let receivedTotalKobo = 0;
      let expensesTotalKobo = 0;

      for (const rawRow of rawLedgerRows) {
        const entry = mapLedgerRowForReport(rawRow);
        const flow = getEntrySignedFlow(entry);
        receivedTotalKobo += flow.moneyInKobo;
        expensesTotalKobo += flow.moneyOutKobo;

        if (entry.entryType === 'SALE') {
          directSalesKobo += entry.amountKobo;
        } else if (
          entry.entryType === 'ADJUSTMENT' &&
          entry.entryKind === 'VOID_REVERSAL' &&
          !rawRow.invoice_id &&
          !rawRow.payment_id
        ) {
          // Only V1 sale receipt void reversals reduce directSalesKobo (invoice payment reversals do not reduce invoiced sales)
          directSalesKobo += entry.amountKobo;
        }
      }

      // 2. Invoiced sales in range (by issue_date, excluding DRAFT and VOID)
      const invSumRow = db
        .prepare(
          `SELECT COALESCE(SUM(total_kobo), 0) AS total
           FROM invoices
           WHERE business_id = ?
             AND status NOT IN ('DRAFT', 'VOID')
             AND issue_date >= ? AND issue_date <= ?`
        )
        .get(business.id, dateFrom, dateTo) as { total: number };
      const invoicedSalesKobo = Number(invSumRow?.total || 0);
      const soldTotalKobo = directSalesKobo + invoicedSalesKobo;

      // 3. Invoice ageing across all currently open invoices (as of today Africa/Lagos)
      const openInvoices = db
        .prepare(
          `SELECT issue_date, due_date, balance_due_kobo
           FROM invoices
           WHERE business_id = ?
             AND status IN ('SENT', 'PART_PAID')
             AND balance_due_kobo > 0`
        )
        .all(business.id) as any[];

      const invoiceAgeing = createEmptyAgeingTotals();
      for (const inv of openInvoices) {
        const ageing = computeAgeingBucket(inv.due_date, inv.issue_date, todayLagos);
        addToAgeingTotals(invoiceAgeing, ageing.bucket, Number(inv.balance_due_kobo));
      }

      // 4. Quote-to-invoice conversion in range (by issue_date, excluding DRAFT and VOID)
      const periodQuotes = db
        .prepare(
          `SELECT status, valid_until, total_kobo, converted_invoice_id
           FROM quotes
           WHERE business_id = ?
             AND status NOT IN ('DRAFT', 'VOID')
             AND issue_date >= ? AND issue_date <= ?`
        )
        .all(business.id, dateFrom, dateTo) as any[];

      let quotesSent = 0;
      let quotesAccepted = 0;
      let quotesDeclined = 0;
      let quotesExpired = 0;
      let quotesConverted = 0;
      let quotedTotalKobo = 0;
      let convertedTotalKobo = 0;

      for (const q of periodQuotes) {
        quotesSent += 1;
        quotedTotalKobo += Number(q.total_kobo);
        if (q.status === 'CONVERTED' || q.converted_invoice_id) {
          quotesConverted += 1;
          convertedTotalKobo += Number(q.total_kobo);
        } else if (q.status === 'ACCEPTED') {
          quotesAccepted += 1;
        } else if (q.status === 'DECLINED') {
          quotesDeclined += 1;
        } else if (q.status === 'SENT' && isQuoteExpired(q.status, q.valid_until)) {
          quotesExpired += 1;
        }
      }

      const conversionRatePct =
        quotesSent > 0 ? Math.round((quotesConverted / quotesSent) * 1000) / 10 : 0;

      const report: V2ReportsSummary = {
        dateFrom,
        dateTo,
        soldTotalKobo,
        invoicedSalesKobo,
        directSalesKobo,
        receivedTotalKobo,
        expensesTotalKobo,
        netCashFlowKobo: receivedTotalKobo - expensesTotalKobo,
        invoiceAgeing,
        quoteConversion: {
          quotesSent,
          quotesAccepted,
          quotesDeclined,
          quotesExpired,
          quotesConverted,
          conversionRatePct,
          quotedTotalKobo,
          convertedTotalKobo,
        },
      };

      res.json({ report });
    } catch (err) {
      logError('v2_reports', err, { userId: req.user!.id });
      res.status(500).json({ error: 'Unable to load V2 reports' });
    }
  });

  // =========================================================================
  // 5. CSV EXPORTS FOR INVOICES, QUOTES, AND PAYMENTS (FORMULA-INJECTION SAFE)
  // =========================================================================
  router.get('/exports/:type', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    const type = String(req.params.type || '').trim().toLowerCase();
    if (type !== 'invoices' && type !== 'quotes' && type !== 'payments') {
      res.status(400).json({ error: 'Unsupported export type. Choose invoices, quotes, or payments.' });
      return;
    }

    const todayLagos = getLagosDateString();
    const rawFrom = String(req.query.dateFrom || req.query.from || '').trim();
    const rawTo = String(req.query.dateTo || req.query.to || '').trim();
    const dateFrom = DATE_YMD_RE.test(rawFrom) ? rawFrom : '2000-01-01';
    const dateTo = DATE_YMD_RE.test(rawTo) ? rawTo : todayLagos;
    const currency: CurrencyCode = business.currency || 'NGN';

    try {
      let csv = '';

      if (type === 'invoices') {
        const rows = db
          .prepare(
            `SELECT * FROM invoices
             WHERE business_id = ? AND issue_date >= ? AND issue_date <= ?
             ORDER BY issue_date ASC, sequence_number ASC, created_at ASC`
          )
          .all(business.id, dateFrom, dateTo) as any[];

        csv = buildCsv(
          [
            'Issue Date',
            'Due Date',
            'Invoice #',
            'Customer',
            'Phone',
            'Status',
            'Subtotal',
            'Discount',
            'VAT',
            'Total',
            'Paid',
            'Written Off',
            'Balance Due',
            'Notes',
          ],
          rows.map((r) => [
            r.issue_date,
            r.due_date,
            r.invoice_number || 'DRAFT',
            r.customer_name || '',
            r.customer_phone || '',
            r.status,
            formatKobo(Number(r.subtotal_kobo), currency),
            formatKobo(
              Number(r.line_discount_total_kobo) + Number(r.invoice_discount_kobo),
              currency
            ),
            formatKobo(Number(r.vat_kobo), currency),
            formatKobo(Number(r.total_kobo), currency),
            formatKobo(Number(r.amount_paid_kobo), currency),
            formatKobo(Number(r.written_off_kobo), currency),
            formatKobo(Number(r.balance_due_kobo), currency),
            r.notes || '',
          ])
        );
      } else if (type === 'quotes') {
        const rows = db
          .prepare(
            `SELECT q.*, i.invoice_number AS converted_invoice_number
             FROM quotes q
             LEFT JOIN invoices i ON i.id = q.converted_invoice_id
             WHERE q.business_id = ? AND q.issue_date >= ? AND q.issue_date <= ?
             ORDER BY q.issue_date ASC, q.sequence_number ASC, q.created_at ASC`
          )
          .all(business.id, dateFrom, dateTo) as any[];

        csv = buildCsv(
          [
            'Issue Date',
            'Valid Until',
            'Quote #',
            'Customer',
            'Phone',
            'Status',
            'Total',
            'Converted Invoice #',
            'Decision By',
            'Notes',
          ],
          rows.map((r) => [
            r.issue_date,
            r.valid_until,
            r.quote_number || 'DRAFT',
            r.customer_name || '',
            r.customer_phone || '',
            isQuoteExpired(r.status, r.valid_until) ? 'EXPIRED' : r.status,
            formatKobo(Number(r.total_kobo), currency),
            r.converted_invoice_number || '',
            r.decision_name || '',
            r.notes || '',
          ])
        );
      } else {
        const rows = db
          .prepare(
            `SELECT p.*, r.receipt_number, d.source_type, d.reference_number, d.customer_name
             FROM payments p
             LEFT JOIN receipts r ON r.id = p.receipt_id
             LEFT JOIN debts d ON d.id = p.debt_id
             WHERE p.business_id = ? AND p.payment_date >= ? AND p.payment_date <= ?
             ORDER BY p.payment_date ASC, p.created_at ASC`
          )
          .all(business.id, dateFrom, dateTo) as any[];

        csv = buildCsv(
          [
            'Payment Date',
            'Receipt #',
            'Source',
            'Document #',
            'Customer',
            'Method',
            'Amount',
            'Reference',
            'Status',
          ],
          rows.map((r) => [
            r.payment_date,
            r.receipt_number || '',
            r.source_type || '',
            r.reference_number || '',
            r.customer_name || '',
            r.payment_method,
            formatKobo(Number(r.amount_kobo), currency),
            r.reference || '',
            r.is_voided ? 'VOID' : 'POSTED',
          ])
        );
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="tallymark-${type}-${todayLagos}.csv"`
      );
      res.send(csv);
    } catch (err) {
      logError('v2_csv_export', err, { userId: req.user!.id, type });
      res.status(500).json({ error: 'Unable to export CSV right now' });
    }
  });
}
