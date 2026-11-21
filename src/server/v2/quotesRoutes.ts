import crypto from 'node:crypto';
import type { Request, Response, Router } from 'express';
import { db, logError, runTransaction } from '../db.ts';
import { type AuthenticatedRequest, requireAuth } from '../auth.ts';
import { getLagosDateString, type CurrencyCode } from '../../shared/money.ts';
import type { BusinessProfile } from '../../shared/types.ts';
import { canUse, shouldShowPublicBranding } from '../../shared/v2/entitlements.ts';
import {
  calculateV2DocumentTotals,
  computeDueDate,
  computeValidUntilDate,
  isQuoteExpired,
  type DepositType,
  type PaymentTermsKind,
} from '../../shared/v2/money.ts';
import {
  ConvertQuoteSchema,
  PublicQuoteDecisionSchema,
  ReviseQuoteSchema,
  SaveQuoteDraftSchema,
  VoidOrWriteOffReasonSchema,
} from '../../shared/v2/schemas.ts';
import type {
  BankAccount,
  InvoiceLineRecord,
  InvoiceRecord,
  PublicQuoteRecord,
  QuoteRecord,
  QuoteSnapshot,
} from '../../shared/v2/types.ts';
import {
  checkPersistentRateLimit,
  extractClientIp,
  hashClientIp,
  isKillSwitchEnabled,
  verifyBotCheck,
} from './botCheck.ts';
import { buildNonPiiQuotePushPayload, sendBusinessWebPush } from './push.ts';
import { recordAnonymousAnalytics } from './analytics.ts';

const MAX_QUOTE_ACTIONS_PER_IP_HOUR = 10;

function formatDocNumber(prefix: string, seq: number): string {
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

function mapQuoteLines(quoteId: string): InvoiceLineRecord[] {
  return db
    .prepare('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY position ASC')
    .all(quoteId)
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

function mapQuoteRow(row: any): QuoteRecord {
  const lines = mapQuoteLines(row.id);
  let snapshot: QuoteSnapshot | null = null;
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

  let convertedInvoiceNumber: string | null = null;
  if (row.converted_invoice_id) {
    const inv = db
      .prepare('SELECT invoice_number FROM invoices WHERE id = ?')
      .get(row.converted_invoice_id) as { invoice_number: string | null } | undefined;
    convertedInvoiceNumber = inv?.invoice_number || null;
  }

  return {
    id: row.id,
    businessId: row.business_id,
    customerId: row.customer_id || null,
    publicId: row.public_id,
    sequenceNumber:
      row.sequence_number !== null && row.sequence_number !== undefined
        ? Number(row.sequence_number)
        : null,
    quoteNumber: row.quote_number || null,
    idempotencyKey: row.idempotency_key || null,
    status: row.status,
    isExpired: isQuoteExpired(row.status, row.valid_until),
    issueDate: row.issue_date,
    validUntil: row.valid_until,
    termsKind: row.terms_kind as PaymentTermsKind,
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
    notes: row.notes || '',
    bankAccountIds,
    template: row.template || 'modern',
    snapshot,
    convertedInvoiceId: row.converted_invoice_id || null,
    convertedInvoiceNumber,
    revisedFromId: row.revised_from_id || null,
    sentAt: row.sent_at || null,
    decisionName: row.decision_name || null,
    decisionNote: row.decision_note || null,
    decisionAt: row.decision_at || null,
    voidReason: row.void_reason || null,
    voidedAt: row.voided_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

/**
 * Fetches a public quote strictly from its immutable snapshot.
 * Never returns DRAFT quotes, customer phone/email, or decision_ip_hash.
 */
export function getPublicQuoteByPublicId(publicId: string): PublicQuoteRecord | null {
  const clean = (publicId || '').trim();
  if (clean.length < 16 || clean.length > 64) return null;

  const row = db
    .prepare(
      `SELECT * FROM quotes
       WHERE public_id = ? AND status != 'DRAFT' AND snapshot_json IS NOT NULL`
    )
    .get(clean) as any;

  if (!row) return null;

  let snapshot: QuoteSnapshot;
  try {
    snapshot = JSON.parse(row.snapshot_json);
  } catch {
    return null;
  }

  return {
    publicId: row.public_id,
    status: row.status,
    isExpired: isQuoteExpired(row.status, row.valid_until),
    sentAt: row.sent_at || null,
    decisionName: row.decision_name || null,
    decisionNote: row.decision_note || null,
    decisionAt: row.decision_at || null,
    voidReason: row.void_reason || null,
    voidedAt: row.voided_at || null,
    snapshot,
  };
}

export interface QuotesRoutesDeps {
  getOwnedBusiness: (userId: string) => BusinessProfile | null;
  logV2Audit: (
    businessId: string,
    actorId: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
    metadata?: Record<string, unknown>
  ) => void;
  incrementUsage: (businessId: string, kind: 'receipt' | 'invoice' | 'quote') => void;
  sendInvoiceTx: (
    business: BusinessProfile,
    userId: string,
    invoiceId: string
  ) => { invoice: InvoiceRecord } | { error: string; status: number };
  mapInvoiceRow: (row: any) => InvoiceRecord;
}

export function attachV2QuotesRoutes(router: Router, deps: QuotesRoutesDeps) {
  const { getOwnedBusiness, logV2Audit, incrementUsage, sendInvoiceTx, mapInvoiceRow } = deps;

  function resolveOrCreateCustomer(
    businessId: string,
    customerId: string | null | undefined,
    name: string,
    phone: string,
    email: string,
    address: string
  ): string | null {
    const cleanName = name.trim();
    if (!cleanName) return null;
    if (customerId) {
      const existing = db
        .prepare('SELECT id FROM customers WHERE id = ? AND business_id = ?')
        .get(customerId, businessId) as { id: string } | undefined;
      if (existing) {
        if (phone || email || address) {
          db.prepare(
            `UPDATE customers
             SET phone = CASE WHEN ? != '' THEN ? ELSE phone END,
                 email = CASE WHEN ? != '' THEN ? ELSE email END,
                 address = CASE WHEN ? != '' THEN ? ELSE address END,
                 updated_at = ?
             WHERE id = ?`
          ).run(phone, phone, email, email, address, address, new Date().toISOString(), existing.id);
        }
        return existing.id;
      }
    }

    const byName = db
      .prepare('SELECT id FROM customers WHERE business_id = ? AND lower(name) = lower(?)')
      .get(businessId, cleanName) as { id: string } | undefined;
    const now = new Date().toISOString();
    if (byName) {
      db.prepare(
        `UPDATE customers
         SET phone = CASE WHEN ? != '' THEN ? ELSE phone END,
             email = CASE WHEN ? != '' THEN ? ELSE email END,
             address = CASE WHEN ? != '' THEN ? ELSE address END,
             updated_at = ?
         WHERE id = ?`
      ).run(phone, phone, email, email, address, address, now, byName.id);
      return byName.id;
    }

    const newId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO customers (id, business_id, name, phone, email, address, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(newId, businessId, cleanName, phone, email, address, now, now);
    return newId;
  }

  function sendQuoteTx(
    business: BusinessProfile,
    userId: string,
    quoteId: string
  ): { quote: QuoteRecord } | { error: string; status: number } {
    const qRow = db
      .prepare('SELECT * FROM quotes WHERE id = ? AND business_id = ?')
      .get(quoteId, business.id) as any;
    if (!qRow) return { error: 'Quote not found', status: 404 };
    if (qRow.status !== 'DRAFT') {
      return { error: 'This quote has already been sent', status: 409 };
    }

    const lines = mapQuoteLines(quoteId);
    if (lines.length === 0) {
      return { error: 'Quote must have at least one line item', status: 400 };
    }

    const bizRow = db
      .prepare('SELECT * FROM businesses WHERE id = ?')
      .get(business.id) as any;
    const seq = Number(bizRow.next_quote_sequence || 1);
    const prefix = String(bizRow.quote_prefix || 'QUO-');
    const quoteNumber = formatDocNumber(prefix, seq);
    const now = new Date().toISOString();

    let allBanks: BankAccount[] = [];
    try {
      const parsed = JSON.parse(bizRow.bank_accounts_json || '[]');
      if (Array.isArray(parsed)) allBanks = parsed;
    } catch {
      allBanks = [];
    }
    let selectedIds: string[] = [];
    try {
      const parsed = JSON.parse(qRow.bank_account_ids_json || '[]');
      if (Array.isArray(parsed)) selectedIds = parsed;
    } catch {
      selectedIds = [];
    }
    const selectedBanks = allBanks.filter((b) => selectedIds.includes(b.id));

    const snapshot: QuoteSnapshot = {
      quoteNumber,
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
        name: qRow.customer_name || '',
        address: qRow.customer_address || '',
      },
      bankAccounts: selectedBanks,
      issueDate: qRow.issue_date,
      validUntil: qRow.valid_until,
      termsKind: qRow.terms_kind as PaymentTermsKind,
      lines,
      subtotalKobo: Number(qRow.subtotal_kobo),
      lineDiscountTotalKobo: Number(qRow.line_discount_total_kobo),
      invoiceDiscountKobo: Number(qRow.invoice_discount_kobo),
      vatEnabled: Boolean(qRow.vat_enabled),
      vatMode: qRow.vat_mode === 'inclusive' ? 'inclusive' : 'exclusive',
      vatRateBps: Number(qRow.vat_rate_bps ?? 750),
      vatKobo: Number(qRow.vat_kobo),
      totalKobo: Number(qRow.total_kobo),
      depositType: (qRow.deposit_type || 'none') as DepositType,
      depositValue: Number(qRow.deposit_value ?? 0),
      amountDueNowKobo: Number(qRow.amount_due_now_kobo),
      notes: qRow.notes || '',
      template: qRow.template || 'modern',
      showBranding: shouldShowPublicBranding(business),
    };

    // Increment gap-free quote counter
    db.prepare('UPDATE businesses SET next_quote_sequence = ?, updated_at = ? WHERE id = ?').run(
      seq + 1,
      now,
      business.id
    );

    // Freeze quote snapshot & lock status as SENT (ZERO ledger or debt entries)
    db.prepare(
      `UPDATE quotes
       SET sequence_number = ?, quote_number = ?, status = 'SENT',
           snapshot_json = ?, sent_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(seq, quoteNumber, JSON.stringify(snapshot), now, now, quoteId);

    incrementUsage(business.id, 'quote');
    logV2Audit(business.id, userId, 'quote_sent', 'quote', quoteId, {
      quote_number: quoteNumber,
      total_kobo: Number(qRow.total_kobo),
      valid_until: qRow.valid_until,
    });
    recordAnonymousAnalytics('quote_sent', '/app/quotes');

    const updated = db.prepare('SELECT * FROM quotes WHERE id = ?').get(quoteId);
    return { quote: mapQuoteRow(updated) };
  }

  // =========================================================================
  // PUBLIC QUOTE SNAPSHOT & CUSTOMER ACCEPT / DECLINE (Logged out)
  // =========================================================================
  router.get('/public/quotes/:publicId', (req: Request, res: Response) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');

    const quote = getPublicQuoteByPublicId(String(req.params.publicId || ''));
    if (!quote) {
      // Identical response for unknown, draft, or regenerated links
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    res.json({ quote });
  });

  const handlePublicQuoteDecision = (decision: 'ACCEPTED' | 'DECLINED') => {
    return async (req: Request, res: Response) => {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');

      // Kill switch returns 503 immediately
      if (isKillSwitchEnabled('DISABLE_PUBLIC_QUOTE_ACTIONS')) {
        res.status(503).json({
          error: 'Public quote responses are temporarily unavailable. Please contact the business directly.',
        });
        return;
      }

      const clientIp = extractClientIp(req);
      const ipHash = hashClientIp(clientIp);

      // Persistent DB rate limit: 10 actions per hour per IP
      const hourLimit = await checkPersistentRateLimit(
        `quote_action_ip_hour:${ipHash}`,
        MAX_QUOTE_ACTIONS_PER_IP_HOUR,
        3600
      );
      if (!hourLimit.allowed) {
        res.status(429).json({
          error: 'Too many quote responses from this network. Please wait an hour and try again.',
        });
        return;
      }

      const parsed = PublicQuoteDecisionSchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid response details' });
        return;
      }
      const input = parsed.data;

      // Verify bot check (PoW + honeypot + optional Turnstile + replay protection)
      const botResult = await verifyBotCheck({
        challenge: input.botChallenge,
        solution: input.botSolution,
        turnstileToken: input.turnstileToken,
        honeypot: input.website,
        clientIp,
      });
      if (!botResult.ok) {
        res.status(403).json({ error: botResult.error || 'Bot verification failed' });
        return;
      }

      const publicId = String(req.params.publicId || '').trim();
      if (publicId.length < 16 || publicId.length > 64) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }

      try {
        const result = runTransaction(() => {
          const qRow = db
            .prepare(
              `SELECT * FROM quotes
               WHERE public_id = ? AND status != 'DRAFT' AND snapshot_json IS NOT NULL`
            )
            .get(publicId) as any;

          if (!qRow) {
            return { error: 'Document not found', status: 404 as const };
          }

          if (qRow.status !== 'SENT') {
            return {
              error: 'This quote has already been responded to or closed.',
              status: 409 as const,
            };
          }

          if (isQuoteExpired(qRow.status, qRow.valid_until)) {
            return {
              error: 'This quote has expired. Ask the business for an updated quote.',
              status: 409 as const,
            };
          }

          const now = new Date().toISOString();
          db.prepare(
            `UPDATE quotes
             SET status = ?, decision_name = ?, decision_note = ?,
                 decision_at = ?, decision_ip_hash = ?, updated_at = ?
             WHERE id = ? AND status = 'SENT'`
          ).run(
            decision,
            input.name,
            input.note || null,
            now,
            ipHash,
            now,
            qRow.id
          );

          logV2Audit(
            qRow.business_id,
            null,
            decision === 'ACCEPTED' ? 'quote_accepted' : 'quote_declined',
            'quote',
            qRow.id,
            {
              quote_number: qRow.quote_number,
              decision,
            }
          );

          return {
            businessId: String(qRow.business_id),
            quoteNumber: String(qRow.quote_number || 'Quote'),
            publicQuote: getPublicQuoteByPublicId(publicId),
          };
        });

        if ('error' in result) {
          res.status(result.status ?? 400).json({ error: result.error });
          return;
        }

        // Dispatch strictly non-PII Web Push notification to owner
        sendBusinessWebPush(
          result.businessId,
          buildNonPiiQuotePushPayload(result.quoteNumber)
        ).catch((err) => logError('v2_quote_push_dispatch', err));

        if (decision === 'ACCEPTED') {
          recordAnonymousAnalytics('quote_accepted', '/q');
        }

        res.json({ quote: result.publicQuote });
      } catch (err) {
        logError('v2_public_quote_decision', err, { decision });
        res.status(500).json({ error: 'Unable to record your response right now. Please try again.' });
      }
    };
  };

  router.post('/public/quotes/:publicId/accept', handlePublicQuoteDecision('ACCEPTED'));
  router.post('/public/quotes/:publicId/decline', handlePublicQuoteDecision('DECLINED'));

  // =========================================================================
  // OWNER QUOTATIONS ROUTES (Authenticated + Tenant Scoped)
  // =========================================================================
  router.get('/quotes', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    const statusFilter = typeof req.query.status === 'string' ? req.query.status : '';
    const search = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const rows = db
      .prepare('SELECT * FROM quotes WHERE business_id = ? ORDER BY created_at DESC')
      .all(business.id)
      .map(mapQuoteRow);

    const filtered = rows.filter((q) => {
      if (statusFilter === 'EXPIRED') {
        if (!q.isExpired) return false;
      } else if (statusFilter === 'SENT') {
        if (q.status !== 'SENT' || q.isExpired) return false;
      } else if (statusFilter && statusFilter !== 'ALL') {
        if (q.status !== statusFilter) return false;
      }
      if (search) {
        const hay = `${q.quoteNumber || ''} ${q.customerName} ${q.notes}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    res.json({ quotes: filtered });
  });

  router.get('/quotes/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const row = db
      .prepare('SELECT * FROM quotes WHERE id = ? AND business_id = ?')
      .get(String(req.params.id || ''), business.id) as any;
    if (!row) {
      res.status(404).json({ error: 'Quote not found' });
      return;
    }
    res.json({ quote: mapQuoteRow(row) });
  });

  // ---- CREATE QUOTE (DRAFT OR SAVE & SEND) ----
  router.post('/quotes', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    if (!canUse(business, 'invoices_quotes')) {
      res.status(403).json({ error: 'This feature is not available on your current plan' });
      return;
    }

    const parsed = SaveQuoteDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid quote details' });
      return;
    }
    const input = parsed.data;
    const issueDate = input.issueDate || getLagosDateString();
    const validUntil = input.validUntil || computeValidUntilDate(issueDate, 14);
    if (validUntil < issueDate) {
      res.status(400).json({ error: 'Valid until date cannot be earlier than the issue date' });
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

    const now = new Date().toISOString();

    try {
      const result = runTransaction(() => {
        if (input.idempotencyKey) {
          const existing = db
            .prepare('SELECT * FROM quotes WHERE business_id = ? AND idempotency_key = ?')
            .get(business.id, input.idempotencyKey) as any;
          if (existing) {
            return { quote: mapQuoteRow(existing), idempotentReplay: true };
          }
        }

        const resolvedCustomerId = resolveOrCreateCustomer(
          business.id,
          input.customerId,
          input.customerName,
          input.customerPhone,
          input.customerEmail,
          input.customerAddress
        );

        const quoteId = crypto.randomUUID();
        const publicId = crypto.randomBytes(16).toString('hex');

        db.prepare(
          `INSERT INTO quotes (
            id, business_id, customer_id, public_id, idempotency_key, status,
            issue_date, valid_until, terms_kind, currency,
            customer_name, customer_phone, customer_email, customer_address,
            subtotal_kobo, line_discount_total_kobo, invoice_discount_kobo,
            vat_enabled, vat_mode, vat_rate_bps, vat_kobo, total_kobo,
            deposit_type, deposit_value, amount_due_now_kobo,
            notes, bank_account_ids_json, template,
            created_at, updated_at, created_by
          ) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          quoteId,
          business.id,
          resolvedCustomerId,
          publicId,
          input.idempotencyKey || null,
          issueDate,
          validUntil,
          input.termsKind,
          business.currency,
          input.customerName,
          input.customerPhone,
          input.customerEmail,
          input.customerAddress,
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
          input.notes,
          JSON.stringify(input.bankAccountIds || []),
          input.template || business.defaultTemplate,
          now,
          now,
          req.user!.id
        );

        const insertLine = db.prepare(
          `INSERT INTO quote_lines (
            id, quote_id, business_id, position, description,
            qty_thousandths, unit_price_kobo, discount_kobo, gross_kobo, line_total_kobo
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        totals.lines.forEach((line, idx) => {
          insertLine.run(
            crypto.randomUUID(),
            quoteId,
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
          return sendQuoteTx(business, req.user!.id, quoteId);
        }

        const created = db.prepare('SELECT * FROM quotes WHERE id = ?').get(quoteId);
        return { quote: mapQuoteRow(created) };
      });

      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }

      res.status((result as any).idempotentReplay ? 200 : 201).json({ quote: result.quote });
    } catch (err) {
      logError('v2_create_quote', err, { userId: req.user!.id });
      res.status(500).json({ error: 'Unable to save quote' });
    }
  });

  // ---- UPDATE QUOTE DRAFT (STRICTLY BLOCKED AFTER SEND) ----
  router.patch('/quotes/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const parsed = SaveQuoteDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid quote details' });
      return;
    }
    const input = parsed.data;
    const quoteId = String(req.params.id || '');
    const issueDate = input.issueDate || getLagosDateString();
    const validUntil = input.validUntil || computeValidUntilDate(issueDate, 14);
    if (validUntil < issueDate) {
      res.status(400).json({ error: 'Valid until date cannot be earlier than the issue date' });
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
    const now = new Date().toISOString();

    try {
      const result = runTransaction(() => {
        const existing = db
          .prepare('SELECT * FROM quotes WHERE id = ? AND business_id = ?')
          .get(quoteId, business.id) as any;
        if (!existing) return { error: 'Quote not found', status: 404 as const };
        if (existing.status !== 'DRAFT') {
          return {
            error: 'Sent quotes cannot be edited. Use Revise to void and create a new copy.',
            status: 409 as const,
          };
        }

        const resolvedCustomerId = resolveOrCreateCustomer(
          business.id,
          input.customerId,
          input.customerName,
          input.customerPhone,
          input.customerEmail,
          input.customerAddress
        );

        db.prepare(
          `UPDATE quotes
           SET customer_id = ?, issue_date = ?, valid_until = ?, terms_kind = ?,
               customer_name = ?, customer_phone = ?, customer_email = ?, customer_address = ?,
               subtotal_kobo = ?, line_discount_total_kobo = ?, invoice_discount_kobo = ?,
               vat_enabled = ?, vat_mode = ?, vat_rate_bps = ?, vat_kobo = ?, total_kobo = ?,
               deposit_type = ?, deposit_value = ?, amount_due_now_kobo = ?,
               notes = ?, bank_account_ids_json = ?, template = ?, updated_at = ?
           WHERE id = ?`
        ).run(
          resolvedCustomerId,
          issueDate,
          validUntil,
          input.termsKind,
          input.customerName,
          input.customerPhone,
          input.customerEmail,
          input.customerAddress,
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
          input.notes,
          JSON.stringify(input.bankAccountIds || []),
          input.template || business.defaultTemplate,
          now,
          quoteId
        );

        db.prepare('DELETE FROM quote_lines WHERE quote_id = ?').run(quoteId);
        const insertLine = db.prepare(
          `INSERT INTO quote_lines (
            id, quote_id, business_id, position, description,
            qty_thousandths, unit_price_kobo, discount_kobo, gross_kobo, line_total_kobo
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        totals.lines.forEach((line, idx) => {
          insertLine.run(
            crypto.randomUUID(),
            quoteId,
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
          return sendQuoteTx(business, req.user!.id, quoteId);
        }

        const updated = db.prepare('SELECT * FROM quotes WHERE id = ?').get(quoteId);
        return { quote: mapQuoteRow(updated) };
      });

      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (err) {
      logError('v2_update_quote', err, { userId: req.user!.id, quoteId });
      res.status(500).json({ error: 'Unable to update quote draft' });
    }
  });

  // ---- SEND (ISSUE & LOCK) QUOTE ----
  router.post('/quotes/:id/send', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    try {
      const result = runTransaction(() =>
        sendQuoteTx(business, req.user!.id, String(req.params.id || ''))
      );
      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (err) {
      logError('v2_send_quote', err, { userId: req.user!.id });
      res.status(500).json({ error: 'Unable to send quote' });
    }
  });

  // ---- VOID QUOTE ----
  router.post('/quotes/:id/void', requireAuth, (req: AuthenticatedRequest, res: Response) => {
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
    const quoteId = String(req.params.id || '');
    const now = new Date().toISOString();

    try {
      const result = runTransaction(() => {
        const qRow = db
          .prepare('SELECT * FROM quotes WHERE id = ? AND business_id = ?')
          .get(quoteId, business.id) as any;
        if (!qRow) return { error: 'Quote not found', status: 404 as const };
        if (qRow.status === 'VOID') return { error: 'Quote is already voided', status: 400 as const };
        if (qRow.status === 'CONVERTED') {
          return { error: 'A converted quote cannot be voided', status: 409 as const };
        }

        db.prepare(
          `UPDATE quotes SET status = 'VOID', void_reason = ?, voided_at = ?, updated_at = ? WHERE id = ?`
        ).run(parsed.data.reason, now, now, quoteId);

        logV2Audit(business.id, req.user!.id, 'quote_voided', 'quote', quoteId, {
          quote_number: qRow.quote_number,
          reason: parsed.data.reason,
        });

        const updated = db.prepare('SELECT * FROM quotes WHERE id = ?').get(quoteId);
        return { quote: mapQuoteRow(updated) };
      });

      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (err) {
      logError('v2_void_quote', err, { userId: req.user!.id, quoteId });
      res.status(500).json({ error: 'Unable to void quote' });
    }
  });

  // ---- REVISE SENT/DECLINED QUOTE (VOID ORIGINAL + CREATE NEW EDITABLE DRAFT COPY) ----
  router.post('/quotes/:id/revise', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const parsed = ReviseQuoteSchema.safeParse(req.body || {});
    const reason = parsed.success ? parsed.data.reason : 'Revised with updated pricing';
    const quoteId = String(req.params.id || '');
    const now = new Date().toISOString();
    const todayLagos = getLagosDateString();

    try {
      const result = runTransaction(() => {
        const oldRow = db
          .prepare('SELECT * FROM quotes WHERE id = ? AND business_id = ?')
          .get(quoteId, business.id) as any;
        if (!oldRow) return { error: 'Quote not found', status: 404 as const };
        if (oldRow.status !== 'SENT' && oldRow.status !== 'DECLINED') {
          return {
            error: 'Only a sent or declined quote can be revised',
            status: 409 as const,
          };
        }

        // Void original
        db.prepare(
          `UPDATE quotes SET status = 'VOID', void_reason = ?, voided_at = ?, updated_at = ? WHERE id = ?`
        ).run(reason, now, now, oldRow.id);

        logV2Audit(business.id, req.user!.id, 'quote_voided', 'quote', oldRow.id, {
          quote_number: oldRow.quote_number,
          reason,
          revised: true,
        });

        // Create fresh editable draft copy
        const newId = crypto.randomUUID();
        const newPublicId = crypto.randomBytes(16).toString('hex');
        const newValidUntil = computeValidUntilDate(todayLagos, 14);

        db.prepare(
          `INSERT INTO quotes (
            id, business_id, customer_id, public_id, status,
            issue_date, valid_until, terms_kind, currency,
            customer_name, customer_phone, customer_email, customer_address,
            subtotal_kobo, line_discount_total_kobo, invoice_discount_kobo,
            vat_enabled, vat_mode, vat_rate_bps, vat_kobo, total_kobo,
            deposit_type, deposit_value, amount_due_now_kobo,
            notes, bank_account_ids_json, template, revised_from_id,
            created_at, updated_at, created_by
          ) VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          newId,
          oldRow.business_id,
          oldRow.customer_id || null,
          newPublicId,
          todayLagos,
          newValidUntil,
          oldRow.terms_kind,
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
          oldRow.notes,
          oldRow.bank_account_ids_json,
          oldRow.template,
          oldRow.id,
          now,
          now,
          req.user!.id
        );

        const oldLines = mapQuoteLines(oldRow.id);
        const insertLine = db.prepare(
          `INSERT INTO quote_lines (
            id, quote_id, business_id, position, description,
            qty_thousandths, unit_price_kobo, discount_kobo, gross_kobo, line_total_kobo
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        oldLines.forEach((l, idx) => {
          insertLine.run(
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

        logV2Audit(business.id, req.user!.id, 'quote_revised', 'quote', newId, {
          revised_from_id: oldRow.id,
          revised_from_number: oldRow.quote_number,
        });

        const created = db.prepare('SELECT * FROM quotes WHERE id = ?').get(newId);
        return { quote: mapQuoteRow(created) };
      });

      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.status(201).json(result);
    } catch (err) {
      logError('v2_revise_quote', err, { userId: req.user!.id, quoteId });
      res.status(500).json({ error: 'Unable to revise quote' });
    }
  });

  // ---- REGENERATE PUBLIC LINK (KILLS OLD LINK IMMEDIATELY) ----
  router.post(
    '/quotes/:id/regenerate-link',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const business = getOwnedBusiness(req.user!.id);
      if (!business) {
        res.status(404).json({ error: 'Business not found' });
        return;
      }
      const quoteId = String(req.params.id || '');
      const now = new Date().toISOString();

      try {
        const result = runTransaction(() => {
          const qRow = db
            .prepare('SELECT * FROM quotes WHERE id = ? AND business_id = ?')
            .get(quoteId, business.id) as any;
          if (!qRow) return { error: 'Quote not found', status: 404 as const };

          const newPublicId = crypto.randomBytes(16).toString('hex');
          db.prepare('UPDATE quotes SET public_id = ?, updated_at = ? WHERE id = ?').run(
            newPublicId,
            now,
            quoteId
          );

          logV2Audit(business.id, req.user!.id, 'quote_link_regenerated', 'quote', quoteId, {
            quote_number: qRow.quote_number,
          });

          const updated = db.prepare('SELECT * FROM quotes WHERE id = ?').get(quoteId);
          return { quote: mapQuoteRow(updated) };
        });

        if ('error' in result) {
          res.status(result.status ?? 400).json({ error: result.error });
          return;
        }
        res.json(result);
      } catch (err) {
        logError('v2_regenerate_quote_link', err, { userId: req.user!.id, quoteId });
        res.status(500).json({ error: 'Unable to regenerate link' });
      }
    }
  );

  // ---- ONE-TAP CONVERT QUOTE TO INVOICE (EXACTLY ONCE, SAFE UNDER PARALLEL TAPS) ----
  router.post('/quotes/:id/convert', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const parsed = ConvertQuoteSchema.safeParse(req.body || {});
    const sendNow = parsed.success ? parsed.data.sendNow : false;
    const quoteId = String(req.params.id || '');
    const now = new Date().toISOString();
    const todayLagos = getLagosDateString();

    try {
      const result = runTransaction(() => {
        const qRow = db
          .prepare('SELECT * FROM quotes WHERE id = ? AND business_id = ?')
          .get(quoteId, business.id) as any;
        if (!qRow) return { error: 'Quote not found', status: 404 as const };

        if (qRow.status === 'CONVERTED' || qRow.converted_invoice_id) {
          return {
            error: 'This quote has already been converted to an invoice',
            status: 409 as const,
            code: 'ALREADY_CONVERTED',
          };
        }

        if (qRow.status !== 'SENT' && qRow.status !== 'ACCEPTED') {
          return {
            error: 'Only a sent or accepted quote can be converted to an invoice',
            status: 409 as const,
          };
        }

        if (qRow.status === 'SENT' && isQuoteExpired(qRow.status, qRow.valid_until)) {
          return {
            error: 'This quote has expired. Revise it first to send a fresh quote.',
            status: 409 as const,
          };
        }

        // Guard against any existing invoice referencing this quote
        const existingInv = db
          .prepare('SELECT id FROM invoices WHERE source_quote_id = ?')
          .get(qRow.id) as { id: string } | undefined;
        if (existingInv) {
          return {
            error: 'This quote has already been converted to an invoice',
            status: 409 as const,
            code: 'ALREADY_CONVERTED',
          };
        }

        const newInvoiceId = crypto.randomUUID();
        const newPublicId = crypto.randomBytes(16).toString('hex');
        const termsKind = (qRow.terms_kind || 'net_7') as PaymentTermsKind;
        const dueDate =
          termsKind === 'custom'
            ? computeDueDate(todayLagos, 'net_7')
            : computeDueDate(todayLagos, termsKind);

        db.prepare(
          `INSERT INTO invoices (
            id, business_id, customer_id, public_id, status,
            issue_date, terms_kind, due_date, currency,
            customer_name, customer_phone, customer_email, customer_address,
            subtotal_kobo, line_discount_total_kobo, invoice_discount_kobo,
            vat_enabled, vat_mode, vat_rate_bps, vat_kobo, total_kobo,
            deposit_type, deposit_value, amount_due_now_kobo,
            amount_paid_kobo, written_off_kobo, balance_due_kobo,
            notes, bank_account_ids_json, template, source_quote_id,
            created_at, updated_at, created_by
          ) VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          newInvoiceId,
          qRow.business_id,
          qRow.customer_id || null,
          newPublicId,
          todayLagos,
          termsKind,
          dueDate,
          qRow.currency,
          qRow.customer_name,
          qRow.customer_phone,
          qRow.customer_email,
          qRow.customer_address,
          qRow.subtotal_kobo,
          qRow.line_discount_total_kobo,
          qRow.invoice_discount_kobo,
          qRow.vat_enabled,
          qRow.vat_mode,
          qRow.vat_rate_bps,
          qRow.vat_kobo,
          qRow.total_kobo,
          qRow.deposit_type,
          qRow.deposit_value,
          qRow.amount_due_now_kobo,
          qRow.total_kobo,
          qRow.notes,
          qRow.bank_account_ids_json,
          qRow.template,
          qRow.id,
          now,
          now,
          req.user!.id
        );

        const qLines = mapQuoteLines(qRow.id);
        const insertInvLine = db.prepare(
          `INSERT INTO invoice_lines (
            id, invoice_id, business_id, position, description,
            qty_thousandths, unit_price_kobo, discount_kobo, gross_kobo, line_total_kobo
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        qLines.forEach((l, idx) => {
          insertInvLine.run(
            crypto.randomUUID(),
            newInvoiceId,
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

        // Atomic single-conversion conditional update
        const updateRes = db
          .prepare(
            `UPDATE quotes
             SET status = 'CONVERTED', converted_invoice_id = ?, updated_at = ?
             WHERE id = ? AND status IN ('SENT', 'ACCEPTED') AND converted_invoice_id IS NULL`
          )
          .run(newInvoiceId, now, qRow.id);

        if (Number(updateRes.changes) !== 1) {
          throw new Error('ALREADY_CONVERTED');
        }

        let finalInvoice: InvoiceRecord;
        if (sendNow) {
          const sent = sendInvoiceTx(business, req.user!.id, newInvoiceId);
          if ('error' in sent) {
            return { error: sent.error, status: sent.status };
          }
          finalInvoice = sent.invoice;
        } else {
          const invRow = db.prepare('SELECT * FROM invoices WHERE id = ?').get(newInvoiceId);
          finalInvoice = mapInvoiceRow(invRow);
        }

        logV2Audit(business.id, req.user!.id, 'quote_converted', 'quote', qRow.id, {
          quote_number: qRow.quote_number,
          invoice_id: finalInvoice.id,
          invoice_number: finalInvoice.invoiceNumber,
        });

        const updatedQuote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(qRow.id);
        return {
          quote: mapQuoteRow(updatedQuote),
          invoice: finalInvoice,
        };
      });

      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error, code: (result as any).code });
        return;
      }
      recordAnonymousAnalytics('quote_converted', '/app/quotes');
      res.status(201).json(result);
    } catch (err: any) {
      if (String(err?.message || '').includes('ALREADY_CONVERTED') || String(err?.message || '').includes('UNIQUE')) {
        res.status(409).json({
          error: 'This quote has already been converted to an invoice',
          code: 'ALREADY_CONVERTED',
        });
        return;
      }
      logError('v2_convert_quote', err, { userId: req.user!.id, quoteId });
      res.status(500).json({ error: 'Unable to convert quote to invoice' });
    }
  });
}
