import crypto from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { db, isDayClosed, logError, runTransaction } from '../db.ts';
import { type AuthenticatedRequest, requireAuth } from '../auth.ts';
import { getLagosDateString, type CurrencyCode } from '../../shared/money.ts';
import { canUse, shouldShowPublicBranding } from '../../shared/v2/entitlements.ts';
import {
  calculateV2DocumentTotals,
  computeDueDate,
  isInvoiceOverdue,
  type DepositType,
  type PaymentTermsKind,
} from '../../shared/v2/money.ts';
import {
  RecordPaymentSchema,
  ReissueInvoiceSchema,
  SaveInvoiceDraftSchema,
  ToggleModuleSchema,
  UpdateBillingSettingsSchema,
  VoidOrWriteOffReasonSchema,
} from '../../shared/v2/schemas.ts';
import type {
  AuditLogRecord,
  BankAccount,
  DebtRecord,
  InvoiceLineRecord,
  InvoiceRecord,
  InvoiceSnapshot,
  PaymentRecord,
  PublicInvoicePaymentSummary,
  PublicInvoiceRecord,
} from '../../shared/v2/types.ts';
import type { BusinessProfile, ReceiptLineItem } from '../../shared/types.ts';
import type { PaymentMethod } from '../../shared/schemas.ts';
import { attachV2ClaimsAndPushRoutes } from './claimsRoutes.ts';
import { attachV2QuotesRoutes } from './quotesRoutes.ts';

function formatDocNumber(prefix: string, seq: number): string {
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function checkDbRateLimit(
  bucketKey: string,
  limit: number,
  windowSeconds: number
): { allowed: boolean; count: number; remaining: number } {
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSec / windowSeconds) * windowSeconds;
  const expiresAt = windowStart + windowSeconds;
  db.prepare('DELETE FROM rate_limits WHERE expires_at < ?').run(nowSec - 3600);
  const existing = db
    .prepare('SELECT hit_count FROM rate_limits WHERE bucket_key = ? AND window_start = ?')
    .get(bucketKey, windowStart) as { hit_count: number } | undefined;

  let count = 1;
  if (!existing) {
    db.prepare(
      'INSERT INTO rate_limits (bucket_key, window_start, hit_count, expires_at) VALUES (?, ?, 1, ?)'
    ).run(bucketKey, windowStart, expiresAt);
  } else {
    count = Number(existing.hit_count) + 1;
    db.prepare(
      'UPDATE rate_limits SET hit_count = ? WHERE bucket_key = ? AND window_start = ?'
    ).run(count, bucketKey, windowStart);
  }

  return {
    allowed: count <= limit,
    count,
    remaining: Math.max(0, limit - count),
  };
}

export function logV2Audit(
  businessId: string,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {}
) {
  db.prepare(
    `INSERT INTO audit_log (id, business_id, actor_id, action, entity_type, entity_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    businessId,
    actorId,
    action,
    entityType,
    entityId,
    JSON.stringify(metadata),
    new Date().toISOString()
  );
}

function incrementUsage(businessId: string, kind: 'receipt' | 'invoice' | 'quote') {
  const monthKey = getLagosDateString().slice(0, 7);
  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT id FROM usage_counters WHERE business_id = ? AND month_key = ?')
    .get(businessId, monthKey) as { id: string } | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO usage_counters (id, business_id, month_key, receipts_issued, invoices_issued, quotes_issued, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      businessId,
      monthKey,
      kind === 'receipt' ? 1 : 0,
      kind === 'invoice' ? 1 : 0,
      kind === 'quote' ? 1 : 0,
      now
    );
  } else {
    const col =
      kind === 'invoice' ? 'invoices_issued' : kind === 'quote' ? 'quotes_issued' : 'receipts_issued';
    db.prepare(`UPDATE usage_counters SET ${col} = ${col} + 1, updated_at = ? WHERE id = ?`).run(
      now,
      existing.id
    );
  }
}

export function parseBankAccounts(raw: unknown): BankAccount[] {
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? (arr as BankAccount[]) : [];
  } catch {
    return [];
  }
}

export function parseModulesEnabled(raw: unknown): { invoicesQuotes: boolean } {
  if (!raw) return { invoicesQuotes: false };
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const enabled = Boolean(obj?.invoicesQuotes ?? obj?.invoices_quotes ?? false);
    return { invoicesQuotes: enabled };
  } catch {
    return { invoicesQuotes: false };
  }
}

function mapInvoiceLines(invoiceId: string): InvoiceLineRecord[] {
  return db
    .prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY position ASC')
    .all(invoiceId)
    .map((r: any) => ({
      id: r.id,
      position: Number(r.position),
      description: r.description,
      qtyThousandths: Number(r.qty_thousandths),
      unitPriceKobo: Number(r.unit_price_kobo),
      discountKobo: Number(r.discount_kobo),
      grossKobo: Number(r.gross_kobo),
      lineTotalKobo: Number(r.line_total_kobo),
    }));
}

function mapInvoiceRow(row: any): InvoiceRecord {
  const lines = mapInvoiceLines(row.id);
  const debt = db
    .prepare("SELECT id FROM debts WHERE source_type = 'INVOICE' AND source_id = ?")
    .get(row.id) as { id: string } | undefined;
  let snapshot: InvoiceSnapshot | null = null;
  if (row.snapshot_json) {
    try {
      snapshot = JSON.parse(row.snapshot_json);
    } catch {
      snapshot = null;
    }
  }
  let bankAccountIds: string[] = [];
  try {
    const parsed = JSON.parse(row.bank_account_ids_json || '[]');
    if (Array.isArray(parsed)) bankAccountIds = parsed;
  } catch {
    bankAccountIds = [];
  }

  return {
    id: row.id,
    businessId: row.business_id,
    customerId: row.customer_id || null,
    publicId: row.public_id,
    sequenceNumber: row.sequence_number !== null && row.sequence_number !== undefined ? Number(row.sequence_number) : null,
    invoiceNumber: row.invoice_number || null,
    idempotencyKey: row.idempotency_key || null,
    status: row.status,
    isOverdue: isInvoiceOverdue(row.status, row.due_date, Number(row.balance_due_kobo)),
    issueDate: row.issue_date,
    termsKind: row.terms_kind as PaymentTermsKind,
    dueDate: row.due_date,
    currency: (row.currency || 'NGN') as CurrencyCode,
    customerName: row.customer_name || '',
    customerPhone: row.customer_phone || '',
    customerEmail: row.customer_email || '',
    customerAddress: row.customer_address || '',
    lines,
    subtotalKobo: Number(row.subtotal_kobo),
    lineDiscountTotalKobo: Number(row.line_discount_total_kobo),
    invoiceDiscountKobo: Number(row.invoice_discount_kobo),
    vatEnabled: Boolean(row.vat_enabled),
    vatMode: row.vat_mode === 'inclusive' ? 'inclusive' : 'exclusive',
    vatRateBps: Number(row.vat_rate_bps ?? 750),
    vatKobo: Number(row.vat_kobo),
    totalKobo: Number(row.total_kobo),
    depositType: (row.deposit_type || 'none') as DepositType,
    depositValue: Number(row.deposit_value ?? 0),
    amountDueNowKobo: Number(row.amount_due_now_kobo),
    amountPaidKobo: Number(row.amount_paid_kobo),
    writtenOffKobo: Number(row.written_off_kobo),
    balanceDueKobo: Number(row.balance_due_kobo),
    notes: row.notes || '',
    bankAccountIds,
    template: row.template || 'modern',
    snapshot,
    sourceQuoteId: row.source_quote_id || null,
    reissuedFromId: row.reissued_from_id || null,
    sentAt: row.sent_at || null,
    voidReason: row.void_reason || null,
    voidedAt: row.voided_at || null,
    writeOffReason: row.write_off_reason || null,
    writtenOffAt: row.written_off_at || null,
    debtId: debt?.id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

function mapDebtRow(row: any): DebtRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    referenceNumber: row.reference_number || '',
    customerId: row.customer_id || null,
    customerName: row.customer_name || '',
    customerPhone: row.customer_phone || '',
    issueDate: row.issue_date,
    dueDate: row.due_date || null,
    totalKobo: Number(row.total_kobo),
    amountPaidKobo: Number(row.amount_paid_kobo),
    writtenOffKobo: Number(row.written_off_kobo),
    balanceDueKobo: Number(row.balance_due_kobo),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPaymentRow(row: any): PaymentRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    debtId: row.debt_id,
    invoiceId: row.invoice_id || null,
    receiptId: row.receipt_id || null,
    receiptNumber: row.receipt_number || null,
    receiptPublicId: row.receipt_public_id || null,
    ledgerEntryId: row.ledger_entry_id || null,
    amountKobo: Number(row.amount_kobo),
    paymentMethod: row.payment_method,
    paymentDate: row.payment_date,
    reference: row.reference || '',
    idempotencyKey: row.idempotency_key,
    isVoided: Boolean(row.is_voided),
    voidReason: row.void_reason || null,
    voidedAt: row.voided_at || null,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export function getPublicInvoiceByPublicId(publicId: string): PublicInvoiceRecord | null {
  const clean = (publicId || '').trim();
  if (clean.length < 16 || clean.length > 64) return null;
  const row = db
    .prepare(
      "SELECT * FROM invoices WHERE public_id = ? AND status <> 'DRAFT' AND snapshot_json IS NOT NULL"
    )
    .get(clean) as any;
  if (!row) return null;

  let snapshot: InvoiceSnapshot;
  try {
    snapshot = JSON.parse(row.snapshot_json);
  } catch {
    return null;
  }

  const payments: PublicInvoicePaymentSummary[] = db
    .prepare(
      `SELECT p.payment_date, p.amount_kobo, p.payment_method, r.receipt_number, r.public_id AS receipt_public_id
       FROM payments p
       LEFT JOIN receipts r ON r.id = p.receipt_id
       WHERE p.invoice_id = ? AND p.is_voided = 0
       ORDER BY p.payment_date ASC, p.created_at ASC`
    )
    .all(row.id)
    .map((p: any) => ({
      paymentDate: p.payment_date,
      amountKobo: Number(p.amount_kobo),
      paymentMethod: p.payment_method,
      receiptNumber: p.receipt_number || null,
      receiptPublicId: p.receipt_public_id || null,
    }));

  const pendingClaimsRow = db
    .prepare("SELECT COUNT(*) AS cnt FROM payment_claims WHERE invoice_id = ? AND status = 'PENDING'")
    .get(row.id) as { cnt: number };

  const latestPendingRow = db
    .prepare(
      "SELECT claim_ref FROM payment_claims WHERE invoice_id = ? AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1"
    )
    .get(row.id) as { claim_ref: string } | undefined;

  const rejectedRow = db
    .prepare("SELECT COUNT(*) AS cnt FROM payment_claims WHERE invoice_id = ? AND status = 'REJECTED'")
    .get(row.id) as { cnt: number };

  return {
    publicId: row.public_id,
    status: row.status,
    isOverdue: isInvoiceOverdue(row.status, row.due_date, Number(row.balance_due_kobo)),
    amountPaidKobo: Number(row.amount_paid_kobo),
    writtenOffKobo: Number(row.written_off_kobo),
    balanceDueKobo: Number(row.balance_due_kobo),
    sentAt: row.sent_at || null,
    voidReason: row.void_reason || null,
    voidedAt: row.voided_at || null,
    pendingClaimsCount: Number(pendingClaimsRow?.cnt || 0),
    latestPendingClaimRef: latestPendingRow?.claim_ref || null,
    hasRejectedClaim: Number(rejectedRow?.cnt || 0) > 0,
    snapshot,
    payments,
  };
}

/**
 * Voids a V2 payment linked to `receiptId` — reverses ledger, marks payment & receipt VOID,
 * reopens debt & invoice balance, writes append-only audit entry.
 */
export function executeVoidV2PaymentByReceipt(params: {
  businessId: string;
  userId: string;
  receiptId: string;
  reason: string;
}) {
  const { businessId, userId, receiptId, reason } = params;
  const now = new Date().toISOString();
  const todayLagos = getLagosDateString();

  return runTransaction(() => {
    const payRow = db
      .prepare('SELECT * FROM payments WHERE receipt_id = ? AND business_id = ?')
      .get(receiptId, businessId) as any;
    if (!payRow) return null;
    if (payRow.is_voided) {
      return { error: 'Payment receipt is already voided', status: 400 as const };
    }

    const rcptRow = db
      .prepare('SELECT * FROM receipts WHERE id = ? AND business_id = ?')
      .get(receiptId, businessId) as any;
    const debtRow = db
      .prepare('SELECT * FROM debts WHERE id = ? AND business_id = ?')
      .get(payRow.debt_id, businessId) as any;

    if (!rcptRow || !debtRow) {
      return { error: 'Linked payment or debt record not found', status: 404 as const };
    }

    db.prepare(
      'UPDATE payments SET is_voided = 1, void_reason = ?, voided_at = ? WHERE id = ?'
    ).run(reason, now, payRow.id);

    db.prepare(
      `UPDATE receipts SET status = 'VOID', void_reason = ?, voided_at = ?, voided_by = ? WHERE id = ?`
    ).run(reason, now, userId, rcptRow.id);

    db.prepare(
      `UPDATE public_receipts SET status = 'VOID', void_reason = ?, voided_at = ? WHERE receipt_id = ?`
    ).run(reason, now, rcptRow.id);

    const restoredPaid = Math.max(0, Number(debtRow.amount_paid_kobo) - Number(payRow.amount_kobo));
    const restoredBal = Math.max(
      0,
      Number(debtRow.total_kobo) - restoredPaid - Number(debtRow.written_off_kobo)
    );
    const restoredDebtStatus =
      restoredBal === 0 && Number(debtRow.written_off_kobo) > 0
        ? 'SETTLED'
        : restoredBal === 0
        ? 'PAID'
        : restoredPaid > 0
        ? 'PART_PAID'
        : 'OPEN';

    db.prepare(
      'UPDATE debts SET amount_paid_kobo = ?, balance_due_kobo = ?, status = ?, updated_at = ? WHERE id = ?'
    ).run(restoredPaid, restoredBal, restoredDebtStatus, now, debtRow.id);

    if (debtRow.source_type === 'INVOICE') {
      const invStatus = restoredDebtStatus === 'OPEN' ? 'SENT' : restoredDebtStatus;
      db.prepare(
        'UPDATE invoices SET amount_paid_kobo = ?, balance_due_kobo = ?, status = ?, updated_at = ? WHERE id = ?'
      ).run(restoredPaid, restoredBal, invStatus, now, debtRow.source_id);
    } else if (debtRow.source_type === 'CREDIT_SALE') {
      const csStatus = restoredDebtStatus === 'OPEN' ? 'UNPAID' : restoredDebtStatus;
      db.prepare(
        'UPDATE credit_sales SET amount_paid_kobo = ?, balance_due_kobo = ?, status = ? WHERE id = ?'
      ).run(restoredPaid, restoredBal, csStatus, debtRow.source_id);
    } else if (debtRow.source_type === 'RECEIPT') {
      const rStatus = restoredBal === 0 ? 'PAID' : 'PART_PAID';
      db.prepare(
        'UPDATE receipts SET amount_paid_kobo = ?, balance_due_kobo = ?, status = ? WHERE id = ?'
      ).run(restoredPaid, restoredBal, rStatus, debtRow.source_id);
      db.prepare(
        'UPDATE public_receipts SET amount_paid_kobo = ?, balance_due_kobo = ?, status = ? WHERE receipt_id = ?'
      ).run(restoredPaid, restoredBal, rStatus, debtRow.source_id);
    }

    const todayClosed = isDayClosed(businessId, todayLagos);
    db.prepare(
      `INSERT INTO ledger_entries (
        id, business_id, entry_type, entry_kind, amount_kobo, cash_received_kobo,
        payment_method, receipt_id, invoice_id, payment_id, customer_name, customer_phone,
        note, sold_by, source, is_correction, correction_reason, entry_date, created_at, created_by
      ) VALUES (?, ?, 'ADJUSTMENT', 'VOID_REVERSAL', ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'manual', ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      businessId,
      -Number(payRow.amount_kobo),
      -Number(payRow.amount_kobo),
      payRow.payment_method,
      rcptRow.id,
      payRow.invoice_id || null,
      payRow.id,
      debtRow.customer_name || '',
      debtRow.customer_phone || '',
      `VOID ${rcptRow.receipt_number}: ${reason}`,
      todayClosed ? 1 : 0,
      todayClosed ? `Voided payment ${rcptRow.receipt_number}: ${reason}` : '',
      todayLagos,
      now,
      userId
    );

    logV2Audit(businessId, userId, 'payment_reversed', 'payment', payRow.id, {
      receipt_number: rcptRow.receipt_number,
      amount_kobo: Number(payRow.amount_kobo),
      reason,
      reopened_balance_kobo: restoredBal,
    });

    const updatedPay = db.prepare('SELECT * FROM payments WHERE id = ?').get(payRow.id);
    const updatedDebt = db.prepare('SELECT * FROM debts WHERE id = ?').get(debtRow.id);
    const updatedRcpt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(rcptRow.id);
    return {
      payment: mapPaymentRow(updatedPay),
      debt: mapDebtRow(updatedDebt),
      receiptRow: updatedRcpt,
    };
  });
}

export function createV2Router(deps: {
  getOwnedBusiness: (userId: string) => BusinessProfile | null;
  mapReceiptRow: (row: any) => any;
}) {
  const { getOwnedBusiness, mapReceiptRow } = deps;
  const router = express.Router();

  // ---- Helper: send (lock & snapshot) an invoice inside an active transaction ----
  function sendInvoiceTx(business: BusinessProfile, userId: string, invoiceId: string) {
    const invRow = db
      .prepare('SELECT * FROM invoices WHERE id = ? AND business_id = ?')
      .get(invoiceId, business.id) as any;
    if (!invRow) return { error: 'Invoice not found', status: 404 as const };
    if (invRow.status !== 'DRAFT') {
      if (['SENT', 'PART_PAID', 'PAID', 'SETTLED'].includes(invRow.status)) {
        return { invoice: mapInvoiceRow(invRow) };
      }
      return { error: 'Cannot send a voided invoice', status: 400 as const };
    }
    if (Number(invRow.total_kobo) <= 0) {
      return { error: 'Invoice total must be greater than zero', status: 400 as const };
    }

    const bizRow = db
      .prepare('SELECT * FROM businesses WHERE id = ?')
      .get(business.id) as any;
    const seq = Number(bizRow.next_invoice_sequence ?? 1);
    const prefix = bizRow.invoice_prefix || 'INV-';
    const invoiceNumber = formatDocNumber(prefix, seq);
    const now = new Date().toISOString();

    db.prepare(
      'UPDATE businesses SET next_invoice_sequence = next_invoice_sequence + 1, updated_at = ? WHERE id = ?'
    ).run(now, business.id);

    const lines = mapInvoiceLines(invRow.id);
    const allBanks = parseBankAccounts(bizRow.bank_accounts_json);
    let selectedIds: string[] = [];
    try {
      selectedIds = JSON.parse(invRow.bank_account_ids_json || '[]');
    } catch {
      selectedIds = [];
    }
    const shownBanks =
      selectedIds.length > 0
        ? allBanks.filter((b) => selectedIds.includes(b.id))
        : allBanks;

    const snapshot: InvoiceSnapshot = {
      invoiceNumber,
      business: {
        name: bizRow.name,
        logoDataUrl: bizRow.logo_data_url || null,
        address: bizRow.address || '',
        phone: bizRow.phone || '',
        email: bizRow.email || '',
        tinRc: bizRow.tin_rc || '',
        brandColor: bizRow.brand_color || '#064E3B',
        currency: (bizRow.currency || 'NGN') as CurrencyCode,
      },
      customer: {
        name: invRow.customer_name || '',
        address: invRow.customer_address || '',
      },
      bankAccounts: shownBanks,
      issueDate: invRow.issue_date,
      dueDate: invRow.due_date,
      termsKind: invRow.terms_kind as PaymentTermsKind,
      lines,
      subtotalKobo: Number(invRow.subtotal_kobo),
      lineDiscountTotalKobo: Number(invRow.line_discount_total_kobo),
      invoiceDiscountKobo: Number(invRow.invoice_discount_kobo),
      vatEnabled: Boolean(invRow.vat_enabled),
      vatMode: invRow.vat_mode === 'inclusive' ? 'inclusive' : 'exclusive',
      vatRateBps: Number(invRow.vat_rate_bps ?? 750),
      vatKobo: Number(invRow.vat_kobo),
      totalKobo: Number(invRow.total_kobo),
      depositType: (invRow.deposit_type || 'none') as DepositType,
      depositValue: Number(invRow.deposit_value ?? 0),
      amountDueNowKobo: Number(invRow.amount_due_now_kobo),
      notes: invRow.notes || '',
      template: invRow.template || 'modern',
      showBranding: shouldShowPublicBranding(business),
    };

    db.prepare(
      `UPDATE invoices
       SET sequence_number = ?, invoice_number = ?, status = 'SENT',
           snapshot_json = ?, sent_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(seq, invoiceNumber, JSON.stringify(snapshot), now, now, invRow.id);

    // Create unified receivable in debts table (ZERO ledger cash entry!)
    const debtId = crypto.randomUUID();
    db.prepare(
      `INSERT OR IGNORE INTO debts (
        id, business_id, source_type, source_id, reference_number,
        customer_id, customer_name, customer_phone,
        issue_date, due_date, total_kobo, amount_paid_kobo, written_off_kobo,
        balance_due_kobo, status, created_at, updated_at
      ) VALUES (?, ?, 'INVOICE', ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 'OPEN', ?, ?)`
    ).run(
      debtId,
      business.id,
      invRow.id,
      invoiceNumber,
      invRow.customer_id || null,
      invRow.customer_name || '',
      invRow.customer_phone || '',
      invRow.issue_date,
      invRow.due_date,
      Number(invRow.total_kobo),
      Number(invRow.total_kobo),
      now,
      now
    );

    incrementUsage(business.id, 'invoice');
    logV2Audit(business.id, userId, 'invoice_issued', 'invoice', invRow.id, {
      invoice_number: invoiceNumber,
      total_kobo: Number(invRow.total_kobo),
    });

    const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invRow.id);
    return { invoice: mapInvoiceRow(updated) };
  }

  // ---- PUBLIC INVOICE SNAPSHOT (logged out, DB rate-limited, no PII, no-store/noindex) ----
  router.get('/public/invoices/:publicId', (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');

    const ip = req.ip || 'unknown';
    const rl = checkDbRateLimit(`public_invoice:${ip}`, 90, 60);
    if (!rl.allowed) {
      res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
      return;
    }

    const publicId = String(req.params.publicId || '').trim();
    const invoice = getPublicInvoiceByPublicId(publicId);
    if (!invoice) {
      // Unknown, expired, or regenerated IDs return identical responses
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    res.json({ invoice });
  });

  // ---- MODULE TOGGLE & PROMO DISMISSAL ----
  router.patch('/settings/module', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const parsed = ToggleModuleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid module update' });
      return;
    }

    const prevEnabled = Boolean(business.modulesEnabled?.invoicesQuotes);
    const nextEnabled = parsed.data.enabled ?? prevEnabled;
    const nextDismiss = parsed.data.dismissPromo ?? Boolean(business.v2PromoDismissed);
    const now = new Date().toISOString();

    runTransaction(() => {
      db.prepare(
        `UPDATE businesses
         SET modules_enabled_json = ?, v2_promo_dismissed = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        JSON.stringify({ invoicesQuotes: nextEnabled }),
        nextDismiss ? 1 : 0,
        now,
        business.id
      );

      if (parsed.data.enabled !== undefined && nextEnabled !== prevEnabled) {
        logV2Audit(business.id, req.user!.id, 'module_toggled', 'business', business.id, {
          module: 'invoices_quotes',
          enabled: nextEnabled,
        });
      }
    });

    const updated = getOwnedBusiness(req.user!.id);
    res.json({ business: updated });
  });

  // ---- BILLING SETTINGS (TIN/RC, BANK ACCOUNTS, PREFIXES, DEFAULT TERMS) ----
  router.patch('/settings/billing', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const parsed = UpdateBillingSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid billing settings' });
      return;
    }

    const input = parsed.data;
    const now = new Date().toISOString();
    const prevBanksJson = JSON.stringify(business.bankAccounts || []);
    const nextBanksJson =
      input.bankAccounts !== undefined ? JSON.stringify(input.bankAccounts) : prevBanksJson;

    runTransaction(() => {
      db.prepare(
        `UPDATE businesses
         SET tin_rc = ?, bank_accounts_json = ?, invoice_prefix = ?, quote_prefix = ?,
             default_payment_terms_days = ?, default_invoice_notes = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        input.tinRc !== undefined ? input.tinRc : business.tinRc || '',
        nextBanksJson,
        input.invoicePrefix ?? business.invoicePrefix ?? 'INV-',
        input.quotePrefix ?? business.quotePrefix ?? 'QUO-',
        input.defaultPaymentTermsDays ?? business.defaultPaymentTermsDays ?? 7,
        input.defaultInvoiceNotes !== undefined
          ? input.defaultInvoiceNotes
          : business.defaultInvoiceNotes || '',
        now,
        business.id
      );

      if (input.bankAccounts !== undefined && nextBanksJson !== prevBanksJson) {
        logV2Audit(business.id, req.user!.id, 'bank_details_updated', 'business', business.id, {
          bank_count: input.bankAccounts.length,
        });
      }
    });

    const updated = getOwnedBusiness(req.user!.id);
    res.json({ business: updated });
  });

  // ---- LIST INVOICES & HOME SUMMARY ----
  router.get('/summary', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const rows = db
      .prepare('SELECT * FROM invoices WHERE business_id = ?')
      .all(business.id) as any[];
    let unpaidTotalKobo = 0;
    let unpaidCount = 0;
    let overdueCount = 0;
    let overdueTotalKobo = 0;
    let draftCount = 0;
    for (const r of rows) {
      if (r.status === 'DRAFT') {
        draftCount += 1;
      } else if (r.status === 'SENT' || r.status === 'PART_PAID') {
        const bal = Number(r.balance_due_kobo);
        if (bal > 0) {
          unpaidCount += 1;
          unpaidTotalKobo += bal;
          if (isInvoiceOverdue(r.status, r.due_date, bal)) {
            overdueCount += 1;
            overdueTotalKobo += bal;
          }
        }
      }
    }
    const pendingClaimsRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM payment_claims WHERE business_id = ? AND status = 'PENDING'")
      .get(business.id) as { cnt: number };
    const pendingClaimsCount = Number(pendingClaimsRow?.cnt || 0);

    res.json({
      summary: {
        unpaidTotalKobo,
        unpaidCount,
        overdueCount,
        overdueTotalKobo,
        draftCount,
        pendingClaimsCount,
      },
    });
  });

  router.get('/invoices', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : '';
    const search = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const rows = db
      .prepare('SELECT * FROM invoices WHERE business_id = ? ORDER BY created_at DESC')
      .all(business.id)
      .map(mapInvoiceRow);

    const filtered = rows.filter((inv) => {
      if (statusFilter === 'OVERDUE') {
        if (!inv.isOverdue) return false;
      } else if (statusFilter && statusFilter !== 'ALL') {
        if (inv.status !== statusFilter) return false;
      }
      if (search) {
        const hay = `${inv.invoiceNumber || ''} ${inv.customerName} ${inv.notes}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    res.json({ invoices: filtered });
  });

  router.get('/invoices/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const row = db
      .prepare('SELECT * FROM invoices WHERE id = ? AND business_id = ?')
      .get(String(req.params.id || ''), business.id) as any;
    if (!row) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }
    const invoice = mapInvoiceRow(row);
    const payments = db
      .prepare(
        `SELECT p.*, r.receipt_number, r.public_id AS receipt_public_id
         FROM payments p
         LEFT JOIN receipts r ON r.id = p.receipt_id
         WHERE p.invoice_id = ? AND p.business_id = ?
         ORDER BY p.payment_date DESC, p.created_at DESC`
      )
      .all(invoice.id, business.id)
      .map(mapPaymentRow);

    res.json({ invoice, payments });
  });

  // ---- CREATE INVOICE (DRAFT OR SAVE & SEND) ----
  router.post('/invoices', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    if (!canUse(business, 'invoices_quotes')) {
      res.status(403).json({ error: 'This feature is not available on your current plan' });
      return;
    }
    const parsed = SaveInvoiceDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid invoice details' });
      return;
    }
    const input = parsed.data;
    const issueDate = input.issueDate || getLagosDateString();
    const dueDate = computeDueDate(issueDate, input.termsKind, input.dueDate);
    if (dueDate < issueDate) {
      res.status(400).json({ error: 'Due date cannot be earlier than the issue date' });
      return;
    }

    const totals = calculateV2DocumentTotals({
      lines: input.lines,
      invoiceDiscountKobo: input.invoiceDiscountKobo,
      vatEnabled: business.vatEnabled,
      vatMode: business.vatMode,
      vatRateBps: business.vatRateBps,
      depositType: input.depositType,
      depositValue: input.depositValue,
    });

    try {
      const result = runTransaction(() => {
        if (input.idempotencyKey) {
          const existing = db
            .prepare('SELECT * FROM invoices WHERE business_id = ? AND idempotency_key = ?')
            .get(business.id, input.idempotencyKey) as any;
          if (existing) {
            if (input.sendNow && existing.status === 'DRAFT') {
              return sendInvoiceTx(business, req.user!.id, existing.id);
            }
            return { invoice: mapInvoiceRow(existing) };
          }
        }

        const now = new Date().toISOString();
        let customerId: string | null = input.customerId || null;
        if (customerId) {
          const owned = db
            .prepare('SELECT id FROM customers WHERE id = ? AND business_id = ?')
            .get(customerId, business.id);
          if (!owned) return { error: 'Customer not found', status: 404 as const };
        } else {
          const existingCust = db
            .prepare('SELECT id FROM customers WHERE business_id = ? AND LOWER(name) = LOWER(?)')
            .get(business.id, input.customerName.trim()) as { id: string } | undefined;
          if (existingCust) {
            customerId = existingCust.id;
            db.prepare(
              `UPDATE customers
               SET phone = COALESCE(NULLIF(?, ''), phone),
                   email = COALESCE(NULLIF(?, ''), email),
                   address = COALESCE(NULLIF(?, ''), address),
                   updated_at = ?
               WHERE id = ?`
            ).run(
              input.customerPhone.trim(),
              input.customerEmail.trim(),
              input.customerAddress.trim(),
              now,
              customerId
            );
          } else {
            customerId = crypto.randomUUID();
            db.prepare(
              `INSERT INTO customers (id, business_id, name, phone, email, address, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              customerId,
              business.id,
              input.customerName.trim(),
              input.customerPhone.trim(),
              input.customerEmail.trim(),
              input.customerAddress.trim(),
              now,
              now
            );
          }
        }

        const invoiceId = crypto.randomUUID();
        const publicId = crypto.randomBytes(16).toString('hex');

        db.prepare(
          `INSERT INTO invoices (
            id, business_id, customer_id, public_id, idempotency_key, status,
            issue_date, terms_kind, due_date, currency,
            customer_name, customer_phone, customer_email, customer_address,
            subtotal_kobo, line_discount_total_kobo, invoice_discount_kobo,
            vat_enabled, vat_mode, vat_rate_bps, vat_kobo, total_kobo,
            deposit_type, deposit_value, amount_due_now_kobo,
            amount_paid_kobo, written_off_kobo, balance_due_kobo,
            notes, bank_account_ids_json, template, created_at, updated_at, created_by
          ) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          invoiceId,
          business.id,
          customerId,
          publicId,
          input.idempotencyKey || null,
          issueDate,
          input.termsKind,
          dueDate,
          business.currency,
          input.customerName.trim(),
          input.customerPhone.trim(),
          input.customerEmail.trim(),
          input.customerAddress.trim(),
          totals.subtotalKobo,
          totals.lineDiscountTotalKobo,
          totals.invoiceDiscountKobo,
          business.vatEnabled ? 1 : 0,
          business.vatMode,
          business.vatRateBps,
          totals.vatKobo,
          totals.totalKobo,
          totals.depositType,
          totals.depositValue,
          totals.amountDueNowKobo,
          totals.totalKobo,
          input.notes.trim(),
          JSON.stringify(input.bankAccountIds || []),
          input.template || business.defaultTemplate,
          now,
          now,
          req.user!.id
        );

        const insertLine = db.prepare(
          `INSERT INTO invoice_lines (
            id, invoice_id, business_id, position, description,
            qty_thousandths, unit_price_kobo, discount_kobo, gross_kobo, line_total_kobo
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        totals.lines.forEach((line, idx) => {
          insertLine.run(
            crypto.randomUUID(),
            invoiceId,
            business.id,
            idx,
            line.description,
            line.qtyThousandths,
            line.unitPriceKobo,
            line.discountKobo,
            line.grossKobo,
            line.lineTotalKobo
          );
        });

        if (input.sendNow) {
          return sendInvoiceTx(business, req.user!.id, invoiceId);
        }

        const created = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
        return { invoice: mapInvoiceRow(created) };
      });

      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.status(201).json(result);
    } catch (err) {
      logError('v2_create_invoice', err, { userId: req.user!.id });
      res.status(500).json({ error: 'Unable to save invoice' });
    }
  });

  // ---- UPDATE DRAFT INVOICE (REJECTED IF ALREADY SENT) ----
  router.patch('/invoices/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const parsed = SaveInvoiceDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid invoice details' });
      return;
    }
    const input = parsed.data;
    const invoiceId = String(req.params.id || '');
    const issueDate = input.issueDate || getLagosDateString();
    const dueDate = computeDueDate(issueDate, input.termsKind, input.dueDate);
    if (dueDate < issueDate) {
      res.status(400).json({ error: 'Due date cannot be earlier than the issue date' });
      return;
    }

    const totals = calculateV2DocumentTotals({
      lines: input.lines,
      invoiceDiscountKobo: input.invoiceDiscountKobo,
      vatEnabled: business.vatEnabled,
      vatMode: business.vatMode,
      vatRateBps: business.vatRateBps,
      depositType: input.depositType,
      depositValue: input.depositValue,
    });

    try {
      const result = runTransaction(() => {
        const existing = db
          .prepare('SELECT * FROM invoices WHERE id = ? AND business_id = ?')
          .get(invoiceId, business.id) as any;
        if (!existing) return { error: 'Invoice not found', status: 404 as const };
        if (existing.status !== 'DRAFT') {
          return {
            error: 'Sent invoices are locked and cannot be edited. Reissue instead.',
            status: 409 as const,
          };
        }

        const now = new Date().toISOString();
        db.prepare(
          `UPDATE invoices
           SET customer_id = ?, customer_name = ?, customer_phone = ?, customer_email = ?, customer_address = ?,
               issue_date = ?, terms_kind = ?, due_date = ?,
               subtotal_kobo = ?, line_discount_total_kobo = ?, invoice_discount_kobo = ?,
               vat_enabled = ?, vat_mode = ?, vat_rate_bps = ?, vat_kobo = ?, total_kobo = ?,
               deposit_type = ?, deposit_value = ?, amount_due_now_kobo = ?, balance_due_kobo = ?,
               notes = ?, bank_account_ids_json = ?, template = ?, updated_at = ?
           WHERE id = ?`
        ).run(
          input.customerId ?? existing.customer_id ?? null,
          input.customerName.trim(),
          input.customerPhone.trim(),
          input.customerEmail.trim(),
          input.customerAddress.trim(),
          issueDate,
          input.termsKind,
          dueDate,
          totals.subtotalKobo,
          totals.lineDiscountTotalKobo,
          totals.invoiceDiscountKobo,
          business.vatEnabled ? 1 : 0,
          business.vatMode,
          business.vatRateBps,
          totals.vatKobo,
          totals.totalKobo,
          totals.depositType,
          totals.depositValue,
          totals.amountDueNowKobo,
          totals.totalKobo,
          input.notes.trim(),
          JSON.stringify(input.bankAccountIds || []),
          input.template || existing.template || business.defaultTemplate,
          now,
          invoiceId
        );

        db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(invoiceId);
        const insertLine = db.prepare(
          `INSERT INTO invoice_lines (
            id, invoice_id, business_id, position, description,
            qty_thousandths, unit_price_kobo, discount_kobo, gross_kobo, line_total_kobo
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        totals.lines.forEach((line, idx) => {
          insertLine.run(
            crypto.randomUUID(),
            invoiceId,
            business.id,
            idx,
            line.description,
            line.qtyThousandths,
            line.unitPriceKobo,
            line.discountKobo,
            line.grossKobo,
            line.lineTotalKobo
          );
        });

        if (input.sendNow) {
          return sendInvoiceTx(business, req.user!.id, invoiceId);
        }

        const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
        return { invoice: mapInvoiceRow(updated) };
      });

      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (err) {
      logError('v2_update_invoice', err, { userId: req.user!.id, invoiceId });
      res.status(500).json({ error: 'Unable to update invoice draft' });
    }
  });

  // ---- SEND (ISSUE & LOCK) INVOICE ----
  router.post('/invoices/:id/send', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    try {
      const result = runTransaction(() =>
        sendInvoiceTx(business, req.user!.id, String(req.params.id || ''))
      );
      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (err) {
      logError('v2_send_invoice', err, { userId: req.user!.id });
      res.status(500).json({ error: 'Unable to send invoice' });
    }
  });

  // ---- VOID UNPAID INVOICE (BLOCKED IF ANY PAYMENT EXISTS) ----
  router.post('/invoices/:id/void', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const parsed = VoidOrWriteOffReasonSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Void reason required' });
      return;
    }
    const invoiceId = String(req.params.id || '');
    const now = new Date().toISOString();

    try {
      const result = runTransaction(() => {
        const invRow = db
          .prepare('SELECT * FROM invoices WHERE id = ? AND business_id = ?')
          .get(invoiceId, business.id) as any;
        if (!invRow) return { error: 'Invoice not found', status: 404 as const };
        if (invRow.status === 'VOID') {
          return { error: 'Invoice is already voided', status: 400 as const };
        }

        const activePayments = db
          .prepare('SELECT COUNT(*) AS cnt FROM payments WHERE invoice_id = ? AND is_voided = 0')
          .get(invoiceId) as { cnt: number };
        if (Number(activePayments.cnt) > 0 || Number(invRow.amount_paid_kobo) > 0) {
          return {
            error:
              'An invoice with a recorded payment cannot be voided. Void the payment receipt first or write off the remaining balance.',
            status: 409 as const,
          };
        }

        db.prepare(
          `UPDATE invoices
           SET status = 'VOID', balance_due_kobo = 0, void_reason = ?, voided_at = ?, updated_at = ?
           WHERE id = ?`
        ).run(parsed.data.reason, now, now, invoiceId);

        db.prepare(
          `UPDATE debts SET status = 'VOID', balance_due_kobo = 0, updated_at = ?
           WHERE source_type = 'INVOICE' AND source_id = ?`
        ).run(now, invoiceId);

        logV2Audit(business.id, req.user!.id, 'invoice_voided', 'invoice', invoiceId, {
          invoice_number: invRow.invoice_number,
          reason: parsed.data.reason,
        });

        const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
        return { invoice: mapInvoiceRow(updated) };
      });

      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (err) {
      logError('v2_void_invoice', err, { userId: req.user!.id, invoiceId });
      res.status(500).json({ error: 'Unable to void invoice' });
    }
  });

  // ---- REISSUE UNPAID SENT INVOICE (VOID + NEW DRAFT COPY) ----
  router.post('/invoices/:id/reissue', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const parsed = ReissueInvoiceSchema.safeParse(req.body || {});
    const reason = parsed.success ? parsed.data.reason : 'Reissued with corrections';
    const invoiceId = String(req.params.id || '');
    const now = new Date().toISOString();
    const todayLagos = getLagosDateString();

    try {
      const result = runTransaction(() => {
        const oldRow = db
          .prepare('SELECT * FROM invoices WHERE id = ? AND business_id = ?')
          .get(invoiceId, business.id) as any;
        if (!oldRow) return { error: 'Invoice not found', status: 404 as const };
        if (oldRow.status !== 'SENT' || Number(oldRow.amount_paid_kobo) > 0) {
          return { error: 'Only an unpaid sent invoice can be reissued', status: 409 as const };
        }

        // Void original
        db.prepare(
          `UPDATE invoices SET status = 'VOID', balance_due_kobo = 0, void_reason = ?, voided_at = ?, updated_at = ? WHERE id = ?`
        ).run(reason, now, now, oldRow.id);
        db.prepare(
          `UPDATE debts SET status = 'VOID', balance_due_kobo = 0, updated_at = ? WHERE source_type = 'INVOICE' AND source_id = ?`
        ).run(now, oldRow.id);
        logV2Audit(business.id, req.user!.id, 'invoice_voided', 'invoice', oldRow.id, {
          invoice_number: oldRow.invoice_number,
          reason,
          reissued: true,
        });

        // Create new draft copy
        const newId = crypto.randomUUID();
        const newPublicId = crypto.randomBytes(16).toString('hex');
        const newDueDate = computeDueDate(
          todayLagos,
          oldRow.terms_kind as PaymentTermsKind,
          oldRow.due_date
        );
        db.prepare(
          `INSERT INTO invoices (
            id, business_id, customer_id, public_id, status,
            issue_date, terms_kind, due_date, currency,
            customer_name, customer_phone, customer_email, customer_address,
            subtotal_kobo, line_discount_total_kobo, invoice_discount_kobo,
            vat_enabled, vat_mode, vat_rate_bps, vat_kobo, total_kobo,
            deposit_type, deposit_value, amount_due_now_kobo,
            amount_paid_kobo, written_off_kobo, balance_due_kobo,
            notes, bank_account_ids_json, template, reissued_from_id,
            created_at, updated_at, created_by
          ) VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          newId,
          oldRow.business_id,
          oldRow.customer_id || null,
          newPublicId,
          todayLagos,
          oldRow.terms_kind,
          newDueDate,
          oldRow.currency,
          oldRow.customer_name,
          oldRow.customer_phone,
          oldRow.customer_email,
          oldRow.customer_address,
          oldRow.subtotal_kobo,
          oldRow.line_discount_total_kobo,
          oldRow.invoice_discount_kobo,
          oldRow.vat_enabled,
          oldRow.vat_mode,
          oldRow.vat_rate_bps,
          oldRow.vat_kobo,
          oldRow.total_kobo,
          oldRow.deposit_type,
          oldRow.deposit_value,
          oldRow.amount_due_now_kobo,
          oldRow.total_kobo,
          oldRow.notes,
          oldRow.bank_account_ids_json,
          oldRow.template,
          oldRow.id,
          now,
          now,
          req.user!.id
        );

        const oldLines = mapInvoiceLines(oldRow.id);
        const insLine = db.prepare(
          `INSERT INTO invoice_lines (
            id, invoice_id, business_id, position, description,
            qty_thousandths, unit_price_kobo, discount_kobo, gross_kobo, line_total_kobo
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        oldLines.forEach((l, idx) => {
          insLine.run(
            crypto.randomUUID(),
            newId,
            business.id,
            idx,
            l.description,
            l.qtyThousandths,
            l.unitPriceKobo,
            l.discountKobo,
            l.grossKobo,
            l.lineTotalKobo
          );
        });

        const created = db.prepare('SELECT * FROM invoices WHERE id = ?').get(newId);
        return { invoice: mapInvoiceRow(created) };
      });

      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.status(201).json(result);
    } catch (err) {
      logError('v2_reissue_invoice', err, { userId: req.user!.id, invoiceId });
      res.status(500).json({ error: 'Unable to reissue invoice' });
    }
  });

  // ---- WRITE OFF REMAINING BALANCE (CLOSES AS SETTLED, AUDIT-LOGGED, NO CASH ENTRY) ----
  router.post('/invoices/:id/write-off', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const parsed = VoidOrWriteOffReasonSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Write-off reason required' });
      return;
    }
    const invoiceId = String(req.params.id || '');
    const now = new Date().toISOString();

    try {
      const result = runTransaction(() => {
        const invRow = db
          .prepare('SELECT * FROM invoices WHERE id = ? AND business_id = ?')
          .get(invoiceId, business.id) as any;
        if (!invRow) return { error: 'Invoice not found', status: 404 as const };
        if (
          !['SENT', 'PART_PAID'].includes(invRow.status) ||
          Number(invRow.balance_due_kobo) <= 0
        ) {
          return {
            error: 'Only an open or part-paid invoice with a remaining balance can be written off',
            status: 400 as const,
          };
        }

        const writeOff = Number(invRow.balance_due_kobo);
        db.prepare(
          `UPDATE invoices
           SET written_off_kobo = written_off_kobo + ?, balance_due_kobo = 0,
               status = 'SETTLED', write_off_reason = ?, written_off_at = ?, updated_at = ?
           WHERE id = ?`
        ).run(writeOff, parsed.data.reason, now, now, invoiceId);

        db.prepare(
          `UPDATE debts
           SET written_off_kobo = written_off_kobo + ?, balance_due_kobo = 0,
               status = 'SETTLED', updated_at = ?
           WHERE source_type = 'INVOICE' AND source_id = ?`
        ).run(writeOff, now, invoiceId);

        logV2Audit(business.id, req.user!.id, 'invoice_written_off', 'invoice', invoiceId, {
          invoice_number: invRow.invoice_number,
          written_off_kobo: writeOff,
          reason: parsed.data.reason,
        });

        const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
        return { invoice: mapInvoiceRow(updated) };
      });

      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (err) {
      logError('v2_write_off_invoice', err, { userId: req.user!.id, invoiceId });
      res.status(500).json({ error: 'Unable to write off balance' });
    }
  });

  // ---- REGENERATE PUBLIC LINK (IMMEDIATELY KILLS OLD 128-BIT LINK) ----
  router.post(
    '/invoices/:id/regenerate-link',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const business = getOwnedBusiness(req.user!.id);
      if (!business) {
        res.status(404).json({ error: 'Business not found' });
        return;
      }
      const invoiceId = String(req.params.id || '');
      const now = new Date().toISOString();

      try {
        const result = runTransaction(() => {
          const invRow = db
            .prepare('SELECT * FROM invoices WHERE id = ? AND business_id = ?')
            .get(invoiceId, business.id) as any;
          if (!invRow) return { error: 'Invoice not found', status: 404 as const };

          const newPublicId = crypto.randomBytes(16).toString('hex');
          db.prepare('UPDATE invoices SET public_id = ?, updated_at = ? WHERE id = ?').run(
            newPublicId,
            now,
            invoiceId
          );

          logV2Audit(business.id, req.user!.id, 'link_regenerated', 'invoice', invoiceId, {
            invoice_number: invRow.invoice_number,
          });

          const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
          return { invoice: mapInvoiceRow(updated) };
        });

        if ('error' in result) {
          res.status(result.status ?? 400).json({ error: result.error });
          return;
        }
        res.json(result);
      } catch (err) {
        logError('v2_regenerate_link', err, { userId: req.user!.id, invoiceId });
        res.status(500).json({ error: 'Unable to regenerate link' });
      }
    }
  );

  // ---- SHARED TRANSACTIONAL RECORD_PAYMENT CORE (used by POST /payments & Claim Confirm) ----
  function executeRecordPayment(params: {
    business: BusinessProfile;
    userId: string;
    debtId: string;
    amountKobo: number;
    paymentMethod: PaymentMethod;
    paymentDate: string;
    reference: string;
    idempotencyKey: string;
  }) {
    const { business, userId, debtId, amountKobo, paymentMethod, paymentDate, reference, idempotencyKey } =
      params;
    const todayLagos = getLagosDateString();
    const now = new Date().toISOString();

    // 1. Idempotency check FIRST (double tap returns identical payment without duplicating)
    const existingPay = db
      .prepare('SELECT * FROM payments WHERE business_id = ? AND idempotency_key = ?')
      .get(business.id, idempotencyKey) as any;
    if (existingPay) {
      const existingRcpt = db
        .prepare('SELECT * FROM receipts WHERE id = ?')
        .get(existingPay.receipt_id);
      const existingDebt = db
        .prepare('SELECT * FROM debts WHERE id = ?')
        .get(existingPay.debt_id);
      return {
        payment: mapPaymentRow(existingPay),
        receipt: existingRcpt ? mapReceiptRow(existingRcpt) : null,
        debt: existingDebt ? mapDebtRow(existingDebt) : null,
        idempotentReplay: true,
      };
    }

    // 2. Lock & validate debt row (SQLite BEGIN IMMEDIATE serializes parallel writers)
    const debtRow = db
      .prepare('SELECT * FROM debts WHERE id = ? AND business_id = ?')
      .get(debtId, business.id) as any;
    if (!debtRow) {
      return { error: 'Receivable record not found', status: 404 as const };
    }
    if (
      ['PAID', 'SETTLED', 'VOID'].includes(debtRow.status) ||
      Number(debtRow.balance_due_kobo) <= 0
    ) {
      return { error: 'This balance is already settled', status: 409 as const };
    }
    if (amountKobo > Number(debtRow.balance_due_kobo)) {
      return {
        error: `Payment exceeds the remaining balance of ₦${(Number(debtRow.balance_due_kobo) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`,
        status: 400 as const,
      };
    }
    if (paymentDate > todayLagos) {
      return {
        error: 'Payment date cannot be in the future (Africa/Lagos)',
        status: 400 as const,
      };
    }
    if (paymentDate < debtRow.issue_date) {
      return {
        error: `Payment date cannot precede the document date (${debtRow.issue_date})`,
        status: 400 as const,
      };
    }
    if (isDayClosed(business.id, paymentDate)) {
      return {
        error: `Day ${paymentDate} is closed. Post a visible correction entry instead.`,
        status: 409 as const,
        code: 'CLOSED_DAY',
      };
    }

    const newPaid = Number(debtRow.amount_paid_kobo) + amountKobo;
    const newBalance = Number(debtRow.balance_due_kobo) - amountKobo;
    const newStatus = newBalance === 0 ? 'PAID' : 'PART_PAID';

    // 3. Allocate gap-free receipt number & create linked receipt
    const bizRow = db
      .prepare('SELECT * FROM businesses WHERE id = ?')
      .get(business.id) as any;
    const seq = Number(bizRow.next_sequence);
    const receiptNumber = formatDocNumber(bizRow.receipt_prefix || 'RCT-', seq);
    const receiptId = crypto.randomUUID();
    const receiptPublicId = crypto.randomBytes(16).toString('hex');

    db.prepare(
      'UPDATE businesses SET next_sequence = next_sequence + 1, updated_at = ? WHERE id = ?'
    ).run(now, business.id);

    const title = `Payment for ${debtRow.reference_number || 'Balance'}`;
    const noteText = reference ? `${title} (Ref: ${reference})` : title;
    const items: ReceiptLineItem[] = [
      {
        description: title,
        qty: 1,
        unitPriceKobo: amountKobo,
        discountKobo: 0,
        grossKobo: amountKobo,
        lineTotalKobo: amountKobo,
      },
    ];
    const itemsJson = JSON.stringify(items);

    db.prepare(
      `INSERT INTO receipts (
        id, business_id, public_id, sequence_number, receipt_number, receipt_kind,
        parent_receipt_id, parent_receipt_number,
        customer_name, customer_phone, items_json,
        subtotal_kobo, discount_total_kobo, vat_enabled, vat_mode, vat_rate_bps, vat_kobo,
        total_kobo, initial_paid_kobo, amount_paid_kobo, balance_due_kobo,
        payment_method, note, sold_by, source, template, status, issued_date_lagos, issued_at, created_by
      ) VALUES (?, ?, ?, ?, ?, 'BALANCE_PAYMENT', ?, ?, ?, ?, ?, ?, 0, 0, 'exclusive', 0, 0, ?, ?, ?, ?, ?, ?, '', 'manual', ?, 'PAID', ?, ?, ?)`
    ).run(
      receiptId,
      business.id,
      receiptPublicId,
      seq,
      receiptNumber,
      debtRow.source_type === 'RECEIPT' ? debtRow.source_id : null,
      debtRow.reference_number || null,
      debtRow.customer_name || '',
      debtRow.customer_phone || '',
      itemsJson,
      amountKobo,
      amountKobo,
      amountKobo,
      amountKobo,
      newBalance,
      paymentMethod,
      noteText,
      business.defaultTemplate,
      paymentDate,
      now,
      userId
    );

    db.prepare(
      `INSERT INTO public_receipts (
        public_id, receipt_id, receipt_number, receipt_kind, parent_receipt_number,
        business_name, business_logo_data_url, business_address, business_phone, business_email,
        brand_color, currency, customer_name, customer_phone, items_json,
        subtotal_kobo, discount_total_kobo, vat_enabled, vat_mode, vat_rate_bps, vat_kobo,
        total_kobo, amount_paid_kobo, balance_due_kobo, payment_method, note, sold_by,
        template, status, issued_date_lagos, issued_at
      ) VALUES (?, ?, ?, 'BALANCE_PAYMENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, 0, 0, 'exclusive', 0, 0, ?, ?, ?, ?, ?, '', ?, 'PAID', ?, ?)`
    ).run(
      receiptPublicId,
      receiptId,
      receiptNumber,
      debtRow.reference_number || null,
      business.name,
      business.logoDataUrl,
      business.address,
      business.phone,
      business.email,
      business.brandColor,
      business.currency,
      debtRow.customer_name || '',
      itemsJson,
      amountKobo,
      amountKobo,
      amountKobo,
      newBalance,
      paymentMethod,
      noteText,
      business.defaultTemplate,
      paymentDate,
      now
    );

    // 4. Create money-in ledger entry (ONLY place invoice money enters the cash book)
    const ledgerId = crypto.randomUUID();
    const paymentId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO ledger_entries (
        id, business_id, entry_type, entry_kind, amount_kobo, cash_received_kobo,
        payment_method, receipt_id, credit_sale_id, invoice_id, payment_id,
        customer_name, customer_phone, note, sold_by, source, entry_date, created_at, created_by
      ) VALUES (?, ?, 'PAYMENT_RECEIVED', 'DEBT_PAYMENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'manual', ?, ?, ?)`
    ).run(
      ledgerId,
      business.id,
      amountKobo,
      amountKobo,
      paymentMethod,
      receiptId,
      debtRow.source_type === 'CREDIT_SALE' ? debtRow.source_id : null,
      debtRow.source_type === 'INVOICE' ? debtRow.source_id : null,
      paymentId,
      debtRow.customer_name || '',
      debtRow.customer_phone || '',
      noteText,
      paymentDate,
      now,
      userId
    );

    // 5. Insert payment record
    db.prepare(
      `INSERT INTO payments (
        id, business_id, debt_id, invoice_id, receipt_id, ledger_entry_id,
        amount_kobo, payment_method, payment_date, reference, idempotency_key,
        is_voided, created_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(
      paymentId,
      business.id,
      debtRow.id,
      debtRow.source_type === 'INVOICE' ? debtRow.source_id : null,
      receiptId,
      ledgerId,
      amountKobo,
      paymentMethod,
      paymentDate,
      reference,
      idempotencyKey,
      now,
      userId
    );

    // 6. Update debt + source document status
    db.prepare(
      'UPDATE debts SET amount_paid_kobo = ?, balance_due_kobo = ?, status = ?, updated_at = ? WHERE id = ?'
    ).run(newPaid, newBalance, newStatus, now, debtRow.id);

    if (debtRow.source_type === 'INVOICE') {
      db.prepare(
        'UPDATE invoices SET amount_paid_kobo = ?, balance_due_kobo = ?, status = ?, updated_at = ? WHERE id = ?'
      ).run(newPaid, newBalance, newStatus, now, debtRow.source_id);
    } else if (debtRow.source_type === 'CREDIT_SALE') {
      db.prepare(
        'UPDATE credit_sales SET amount_paid_kobo = ?, balance_due_kobo = ?, status = ? WHERE id = ?'
      ).run(newPaid, newBalance, newStatus, debtRow.source_id);
    } else if (debtRow.source_type === 'RECEIPT') {
      db.prepare(
        'UPDATE receipts SET amount_paid_kobo = ?, balance_due_kobo = ?, status = ? WHERE id = ?'
      ).run(newPaid, newBalance, newStatus, debtRow.source_id);
      db.prepare(
        'UPDATE public_receipts SET amount_paid_kobo = ?, balance_due_kobo = ?, status = ? WHERE receipt_id = ?'
      ).run(newPaid, newBalance, newStatus, debtRow.source_id);
    }

    incrementUsage(business.id, 'receipt');
    logV2Audit(business.id, userId, 'payment_recorded', 'payment', paymentId, {
      debt_id: debtRow.id,
      reference_number: debtRow.reference_number,
      amount_kobo: amountKobo,
      method: paymentMethod,
      receipt_number: receiptNumber,
      remaining_kobo: newBalance,
    });

    const payRow = db
      .prepare(
        `SELECT p.*, r.receipt_number, r.public_id AS receipt_public_id
         FROM payments p LEFT JOIN receipts r ON r.id = p.receipt_id WHERE p.id = ?`
      )
      .get(paymentId);
    const rcptRow = db.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId);
    const updatedDebt = db.prepare('SELECT * FROM debts WHERE id = ?').get(debtRow.id);

    return {
      payment: mapPaymentRow(payRow),
      receipt: mapReceiptRow(rcptRow),
      debt: mapDebtRow(updatedDebt),
      idempotentReplay: false,
    };
  }

  // ---- RECORD PAYMENT (SINGLE TRANSACTIONAL PATH WITH IDEMPOTENCY & LINKED RECEIPT) ----
  router.post('/payments', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const parsed = RecordPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payment details' });
      return;
    }

    const input = parsed.data;
    const paymentDate = input.paymentDate || getLagosDateString();

    try {
      const result = runTransaction(() =>
        executeRecordPayment({
          business,
          userId: req.user!.id,
          debtId: input.debtId,
          amountKobo: input.amountKobo,
          paymentMethod: input.paymentMethod,
          paymentDate,
          reference: input.reference,
          idempotencyKey: input.idempotencyKey,
        })
      );

      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error, code: (result as any).code });
        return;
      }
      res.status(result.idempotentReplay ? 200 : 201).json(result);
    } catch (err) {
      logError('v2_record_payment', err, { userId: req.user!.id });
      res.status(500).json({ error: 'Unable to record payment' });
    }
  });

  // ---- VOID PAYMENT RECEIPT (REVERSING ENTRY + REOPENS BALANCE) ----
  router.post(
    '/payments/void-by-receipt/:receiptId',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const business = getOwnedBusiness(req.user!.id);
      if (!business) {
        res.status(404).json({ error: 'Business not found' });
        return;
      }
      const parsed = VoidOrWriteOffReasonSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Void reason required' });
        return;
      }
      try {
        const result = executeVoidV2PaymentByReceipt({
          businessId: business.id,
          userId: req.user!.id,
          receiptId: String(req.params.receiptId || ''),
          reason: parsed.data.reason,
        });
        if (!result) {
          res.status(404).json({ error: 'Payment receipt not found' });
          return;
        }
        if ('error' in result) {
          res.status(result.status ?? 400).json({ error: result.error });
          return;
        }
        res.json({
          payment: result.payment,
          debt: result.debt,
          receipt: mapReceiptRow(result.receiptRow),
        });
      } catch (err) {
        logError('v2_void_payment_receipt', err, { userId: req.user!.id });
        res.status(500).json({ error: 'Unable to void payment receipt' });
      }
    }
  );

  // ---- AUDIT LOG & USAGE COUNTERS (READ-ONLY FOR OWNER) ----
  router.get('/audit-log', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const rows: AuditLogRecord[] = db
      .prepare('SELECT * FROM audit_log WHERE business_id = ? ORDER BY created_at DESC LIMIT 100')
      .all(business.id)
      .map((r: any) => ({
        id: r.id,
        businessId: r.business_id,
        actorId: r.actor_id || null,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id || null,
        metadata: JSON.parse(r.metadata_json || '{}'),
        createdAt: r.created_at,
      }));
    res.json({ auditLog: rows });
  });

  router.get('/usage', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const rows = db
      .prepare('SELECT * FROM usage_counters WHERE business_id = ? ORDER BY month_key DESC LIMIT 12')
      .all(business.id)
      .map((r: any) => ({
        monthKey: r.month_key,
        receiptsIssued: Number(r.receipts_issued),
        invoicesIssued: Number(r.invoices_issued),
        quotesIssued: Number(r.quotes_issued),
      }));
    res.json({ usage: rows });
  });

  // ---- SLICE 2: CUSTOMER CLAIMS, PROOF SECURITY, WEB PUSH & KILL SWITCHES ----
  attachV2ClaimsAndPushRoutes(router, {
    getOwnedBusiness,
    logV2Audit,
    executeRecordPayment,
  });

  // ---- SLICE 3: QUOTATIONS (CRUD, SEND, REVISE, PUBLIC ACCEPT/DECLINE, CONVERT) ----
  attachV2QuotesRoutes(router, {
    getOwnedBusiness,
    logV2Audit,
    incrementUsage,
    sendInvoiceTx,
    mapInvoiceRow,
  });

  return router;
}
