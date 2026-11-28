import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { db, EXPENSE_PROOFS_DIR, isDayClosed, logError, runTransaction } from './db.ts';
import {
  type AuthenticatedRequest,
  authenticatePasswordUser,
  clearSessionCookie,
  consumeMagicLinkToken,
  createMagicLinkToken,
  createSessionForUser,
  registerPasswordUser,
  requireAnyAuth,
  requireAuth,
  setSessionCookie,
  upsertUser,
} from './auth.ts';
import {
  AnalyticsEventSchema,
  AuthGoogleSchema,
  AuthSignInSchema,
  AuthSignUpSchema,
  BusinessInputSchema,
  CloseDaySchema,
  CorrectionEntrySchema,
  CreateReceiptSchema,
  CreditorInputSchema,
  CreditSaleSchema,
  ExpenseInputSchema,
  MagicLinkRequestSchema,
  MagicLinkVerifySchema,
  MarkCreditorPaidSchema,
  QuickSaleSchema,
  ReceiveBalanceSchema,
  RecordDebtPaymentSchema,
  VoidReceiptSchema,
} from '../shared/schemas.ts';
import {
  ConfirmVoiceEntriesSchema,
  VoiceTranscriptRequestSchema,
} from '../shared/voiceDraft.ts';
import { parseTranscriptWithGemini, VoiceAiError } from './geminiVoice.ts';
import {
  buildCashBookDayView,
  buildCsv,
  calculateCloseDayVariance,
  getEntrySignedFlow,
  groupDebtsByCustomer,
  shiftLagosDate,
} from '../shared/cashbook.ts';
import {
  calculateReceiptTotals,
  formatKobo,
  getLagosDateString,
  type CurrencyCode,
} from '../shared/money.ts';
import type {
  BusinessProfile,
  CreditorRecord,
  CreditSaleRecord,
  DayClosureRecord,
  ExpenseRecord,
  ExpenseRevisionRecord,
  LedgerEntryRecord,
  PublicReceiptRecord,
  ReceiptLineItem,
  ReceiptRecord,
  ReportsSummary,
} from '../shared/types.ts';
import {
  createV2Router,
  executeVoidV2PaymentByReceipt,
  parseBankAccounts,
  parseModulesEnabled,
} from './v2/routes.ts';
import { deletePrivateProofFile } from './v2/proofSecurity.ts';

function createRateLimiter(maxRequests: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip || 'unknown'}:${req.baseUrl}`;
    const now = Date.now();
    const existing = hits.get(key);
    if (!existing || existing.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (existing.count >= maxRequests) {
      res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
      return;
    }
    existing.count += 1;
    next();
  };
}

function createPerUserRateLimiter(maxRequests: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = req.user?.id || req.ip || 'anonymous';
    const now = Date.now();
    const existing = hits.get(userId);
    if (!existing || existing.resetAt <= now) {
      const resetAt = now + windowMs;
      hits.set(userId, { count: 1, resetAt });
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequests - 1)));
      next();
      return;
    }
    if (existing.count >= maxRequests) {
      const retrySecs = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retrySecs));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.status(429).json({
        error: `Voice drafting limit reached (${maxRequests} requests per 10 minutes). Try again in a few minutes or use manual entry below.`,
        code: 'RATE_LIMITED',
      });
      return;
    }
    existing.count += 1;
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequests - existing.count)));
    next();
  };
}

function formatReceiptNumber(prefix: string, seq: number): string {
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

function mapBusinessRow(row: any): BusinessProfile {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    logoDataUrl: row.logo_data_url || null,
    signatureDataUrl: row.signature_data_url || null,
    address: row.address || '',
    phone: row.phone || '',
    email: row.email || '',
    brandColor: row.brand_color || '#064E3B',
    receiptPrefix: row.receipt_prefix || 'RCT-',
    nextSequence: Number(row.next_sequence),
    currency: (row.currency || 'NGN') as CurrencyCode,
    vatEnabled: Boolean(row.vat_enabled),
    vatMode: row.vat_mode === 'inclusive' ? 'inclusive' : 'exclusive',
    vatRateBps: Number(row.vat_rate_bps ?? 750),
    openingCashKobo: Number(row.opening_cash_kobo ?? 0),
    defaultTemplate: row.default_template || 'modern',
    closeDayReminderTime: row.close_day_reminder_time || '19:00',
    tinRc: row.tin_rc || '',
    bankAccounts: parseBankAccounts(row.bank_accounts_json),
    modulesEnabled: parseModulesEnabled(row.modules_enabled_json),
    plan: row.plan || 'early_access',
    invoicePrefix: row.invoice_prefix || 'INV-',
    nextInvoiceSequence: Number(row.next_invoice_sequence ?? 1),
    quotePrefix: row.quote_prefix || 'QUO-',
    nextQuoteSequence: Number(row.next_quote_sequence ?? 1),
    defaultPaymentTermsDays: Number(row.default_payment_terms_days ?? 7),
    defaultInvoiceNotes: row.default_invoice_notes || '',
    v2PromoDismissed: Boolean(row.v2_promo_dismissed),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReceiptRow(row: any): ReceiptRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    publicId: row.public_id,
    sequenceNumber: Number(row.sequence_number),
    receiptNumber: row.receipt_number,
    receiptKind: row.receipt_kind,
    parentReceiptId: row.parent_receipt_id || null,
    parentReceiptNumber: row.parent_receipt_number || null,
    customerName: row.customer_name || '',
    customerPhone: row.customer_phone || '',
    items: JSON.parse(row.items_json) as ReceiptLineItem[],
    subtotalKobo: Number(row.subtotal_kobo),
    discountTotalKobo: Number(row.discount_total_kobo),
    vatEnabled: Boolean(row.vat_enabled),
    vatMode: row.vat_mode,
    vatRateBps: Number(row.vat_rate_bps),
    vatKobo: Number(row.vat_kobo),
    totalKobo: Number(row.total_kobo),
    initialPaidKobo: Number(row.initial_paid_kobo),
    amountPaidKobo: Number(row.amount_paid_kobo),
    balanceDueKobo: Number(row.balance_due_kobo),
    paymentMethod: row.payment_method,
    note: row.note || '',
    soldBy: row.sold_by || '',
    source: row.source,
    template: row.template,
    status: row.status,
    voidReason: row.void_reason || null,
    voidedAt: row.voided_at || null,
    issuedDateLagos: row.issued_date_lagos,
    issuedAt: row.issued_at,
    createdBy: row.created_by,
  };
}

export function mapPublicReceiptRow(row: any): PublicReceiptRecord {
  return {
    publicId: row.public_id,
    receiptNumber: row.receipt_number,
    receiptKind: row.receipt_kind,
    parentReceiptNumber: row.parent_receipt_number || null,
    businessName: row.business_name,
    businessLogoDataUrl: row.business_logo_data_url || null,
    businessSignatureDataUrl: row.business_signature_data_url || null,
    businessAddress: row.business_address || '',
    businessPhone: row.business_phone || '',
    businessEmail: row.business_email || '',
    brandColor: row.brand_color || '#064E3B',
    currency: (row.currency || 'NGN') as CurrencyCode,
    customerName: row.customer_name || '',
    customerPhone: row.customer_phone || '',
    items: JSON.parse(row.items_json) as ReceiptLineItem[],
    subtotalKobo: Number(row.subtotal_kobo),
    discountTotalKobo: Number(row.discount_total_kobo),
    vatEnabled: Boolean(row.vat_enabled),
    vatMode: row.vat_mode,
    vatRateBps: Number(row.vat_rate_bps),
    vatKobo: Number(row.vat_kobo),
    totalKobo: Number(row.total_kobo),
    amountPaidKobo: Number(row.amount_paid_kobo),
    balanceDueKobo: Number(row.balance_due_kobo),
    paymentMethod: row.payment_method,
    note: row.note || '',
    soldBy: row.sold_by || '',
    template: row.template,
    status: row.status,
    voidReason: row.void_reason || null,
    voidedAt: row.voided_at || null,
    issuedDateLagos: row.issued_date_lagos,
    issuedAt: row.issued_at,
  };
}

function mapLedgerRow(row: any): LedgerEntryRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    entryType: row.entry_type,
    entryKind: row.entry_kind || (row.entry_type === 'EXPENSE' ? 'EXPENSE' : 'RECEIPT'),
    amountKobo: Number(row.amount_kobo),
    cashReceivedKobo: Number(row.cash_received_kobo),
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

function mapCreditSaleRow(row: any): CreditSaleRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone || '',
    itemNote: row.item_note || '',
    totalKobo: Number(row.total_kobo),
    amountPaidKobo: Number(row.amount_paid_kobo),
    balanceDueKobo: Number(row.balance_due_kobo),
    dueDate: row.due_date || null,
    soldBy: row.sold_by || '',
    receiptId: row.receipt_id || null,
    status: row.status,
    entryDate: row.entry_date,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function mapCreditorRow(row: any): CreditorRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    supplierName: row.supplier_name,
    phone: row.phone || '',
    description: row.description || '',
    amountKobo: Number(row.amount_kobo),
    dueDate: row.due_date || null,
    status: row.status,
    paidAt: row.paid_at || null,
    paidMethod: row.paid_method || null,
    expenseId: row.expense_id || null,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function mapExpenseRow(row: any): ExpenseRecord {
  const proofPath = row.proof_path || null;
  return {
    id: row.id,
    businessId: row.business_id,
    entryDate: row.entry_date,
    amountKobo: Number(row.amount_kobo),
    category: row.category,
    payee: row.payee || '',
    paymentMethod: row.payment_method,
    note: row.note || '',
    proofPath,
    proofUrl: proofPath ? `/api/expenses/proof/${encodeURIComponent(proofPath)}` : null,
    source: row.source || 'manual',
    ledgerEntryId: row.ledger_entry_id || null,
    isDeleted: Boolean(row.is_deleted),
    deletedAt: row.deleted_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

function mapClosureRow(row: any): DayClosureRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    closeDate: row.close_date,
    openingCashKobo: Number(row.opening_cash_kobo),
    expectedCashKobo: Number(row.expected_cash_kobo),
    countedCashKobo: Number(row.counted_cash_kobo),
    varianceKobo: Number(row.variance_kobo),
    totalSalesKobo: Number(row.total_sales_kobo),
    quickSalesKobo: Number(row.quick_sales_kobo),
    receiptSalesKobo: Number(row.receipt_sales_kobo),
    creditSalesKobo: Number(row.credit_sales_kobo),
    paymentsReceivedKobo: Number(row.payments_received_kobo),
    expensesKobo: Number(row.expenses_kobo),
    netKobo: Number(row.net_kobo),
    note: row.note || '',
    closedAt: row.closed_at,
    closedBy: row.closed_by,
  };
}

function getOwnedBusiness(ownerId: string): BusinessProfile | null {
  const row = db.prepare('SELECT * FROM businesses WHERE owner_id = ?').get(ownerId);
  return row ? mapBusinessRow(row) : null;
}

function getAllLedgerEntries(businessId: string): LedgerEntryRecord[] {
  const rows = db
    .prepare(
      `SELECT l.*, r.receipt_number
       FROM ledger_entries l
       LEFT JOIN receipts r ON r.id = l.receipt_id
       WHERE l.business_id = ?
       ORDER BY l.entry_date ASC, l.created_at ASC, l.id ASC`
    )
    .all(businessId);
  return rows.map(mapLedgerRow);
}

function getAllClosures(businessId: string): DayClosureRecord[] {
  const rows = db
    .prepare('SELECT * FROM day_closures WHERE business_id = ? ORDER BY close_date DESC')
    .all(businessId);
  return rows.map(mapClosureRow);
}

function upsertCustomerSuggestion(
  businessId: string,
  name: string,
  phone: string,
  timestamp: string
) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const existingCust = db
    .prepare('SELECT id FROM customers WHERE business_id = ? AND LOWER(name) = LOWER(?)')
    .get(businessId, trimmed) as { id: string } | undefined;
  if (existingCust) {
    db.prepare(
      "UPDATE customers SET phone = COALESCE(NULLIF(?, ''), phone), updated_at = ? WHERE id = ?"
    ).run(phone.trim(), timestamp, existingCust.id);
  } else {
    db.prepare(
      'INSERT INTO customers (id, business_id, name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(crypto.randomUUID(), businessId, trimmed, phone.trim(), timestamp, timestamp);
  }
}

export function createApiRouter() {
  const router = express.Router();
  const generalLimiter = createRateLimiter(240, 60_000);
  const authLimiter = createRateLimiter(40, 60_000);
  const magicLinkLimiter = createRateLimiter(15, 5 * 60_000);
  const publicLimiter = createRateLimiter(90, 60_000);

  router.use(generalLimiter);

  router.get('/health', (_req, res) => {
    res.json({ ok: true, timezone: 'Africa/Lagos' });
  });

  // Same-origin proxy for Supabase Auth, PostgREST, and Storage requests.
  // Prevents "Failed to fetch" when direct browser requests to *.supabase.co
  // are blocked by mobile ISPs, privacy shields, or sandboxed iframes.
  const supabaseRawParser = express.raw({ type: '*/*', limit: '6mb' });
  router.all('/supabase/*', supabaseRawParser, async (req, res) => {
    const rawUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '')
      .trim()
      .replace(/^["']+|["']+$/g, '')
      .trim();
    let supaOrigin = '';
    try {
      if (rawUrl) {
        const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
        const parsed = new URL(withProtocol);
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
          supaOrigin = parsed.origin;
        }
      }
    } catch {
      supaOrigin = '';
    }

    if (!supaOrigin) {
      res.status(503).json({
        error: 'Supabase is not configured on this server.',
        code: 'SUPABASE_NOT_CONFIGURED',
      });
      return;
    }

    const forwardPathAndQuery = req.url.replace(/^\/supabase(?=\/|\?|$)/, '') || '/';
    const pathnameOnly = forwardPathAndQuery.split('?')[0] || '/';
    const allowedPrefix =
      pathnameOnly.startsWith('/auth/v1/') ||
      pathnameOnly.startsWith('/rest/v1/') ||
      pathnameOnly.startsWith('/storage/v1/');
    if (!allowedPrefix || pathnameOnly.includes('..') || pathnameOnly.includes('\\')) {
      res.status(403).json({ error: 'Unsupported Supabase proxy path' });
      return;
    }

    const targetUrl = `${supaOrigin}${forwardPathAndQuery}`;
    const forwardHeaders = new Headers();
    const allowlistedReqHeaders = [
      'apikey',
      'authorization',
      'content-type',
      'accept',
      'accept-profile',
      'content-profile',
      'prefer',
      'range',
      'x-client-info',
      'x-supabase-api-version',
      'x-upsert',
      'cache-control',
      'if-none-match',
      'if-match',
    ];
    for (const name of allowlistedReqHeaders) {
      const value = req.headers[name];
      if (typeof value === 'string' && value.trim()) {
        forwardHeaders.set(name, value);
      }
    }

    if (!forwardHeaders.has('apikey')) {
      const publicKey = (
        process.env.VITE_SUPABASE_ANON_KEY ||
        process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
        process.env.SUPABASE_ANON_KEY ||
        ''
      )
        .trim()
        .replace(/^["']+|["']+$/g, '')
        .trim();
      if (publicKey) {
        forwardHeaders.set('apikey', publicKey);
      }
    }

    const method = req.method.toUpperCase();
    const hasExplicitEmptyLength = req.headers['content-length'] === '0';
    let body: BodyInit | undefined;
    if (method !== 'GET' && method !== 'HEAD' && !hasExplicitEmptyLength) {
      if (Buffer.isBuffer(req.body)) {
        if (req.body.length > 0) {
          body = new Uint8Array(req.body);
        }
      } else if (typeof req.body === 'string') {
        if (req.body.length > 0) {
          body = req.body;
        }
      } else if (req.body !== undefined && req.body !== null) {
        body = JSON.stringify(req.body);
        if (!forwardHeaders.has('content-type')) {
          forwardHeaders.set('content-type', 'application/json;charset=UTF-8');
        }
      }
    }

    try {
      const upstream = await fetch(targetUrl, {
        method,
        headers: forwardHeaders,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(25_000),
      });

      res.status(upstream.status);
      const allowlistedResHeaders = [
        'content-type',
        'content-range',
        'x-total-count',
        'x-supabase-api-version',
        'x-sb-error-code',
        'cache-control',
        'etag',
        'location',
      ];
      for (const name of allowlistedResHeaders) {
        const value = upstream.headers.get(name);
        if (value) {
          res.setHeader(name, value);
        }
      }

      const buf = Buffer.from(await upstream.arrayBuffer());
      res.send(buf);
    } catch (err) {
      logError('supabase_proxy', err, { method, path: pathnameOnly });
      res.status(502).json({
        error: 'Unable to reach Supabase right now. Please try again in a moment.',
        code: 'SUPABASE_PROXY_UNREACHABLE',
      });
    }
  });

  // Auth routes
  router.get('/auth/config', (_req, res) => {
    const googleOAuthConfigured = Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    );
    const directEmailSignInEnabled =
      !googleOAuthConfigured &&
      !(process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_AUTH !== 'true');
    res.json({ googleOAuthConfigured, directEmailSignInEnabled, passwordAuthEnabled: true });
  });

  router.post('/auth/signup', authLimiter, (req, res) => {
    const parsed = AuthSignUpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check your sign-up details' });
      return;
    }
    try {
      const created = registerPasswordUser({
        name: parsed.data.name,
        email: parsed.data.email,
        password: parsed.data.password,
      });
      if (!created.ok) {
        res.status(409).json({
          error: 'An account with this email already exists. Try signing in instead.',
          code: 'DUPLICATE_EMAIL',
        });
        return;
      }
      const session = createSessionForUser(created.user.id);
      setSessionCookie(res, session.token, session.expiresAt);
      const business = getOwnedBusiness(created.user.id);
      res.status(201).json({ user: created.user, business, sessionToken: session.token });
    } catch (err) {
      logError('auth_signup', err);
      res.status(500).json({ error: 'Unable to create account right now' });
    }
  });

  router.post('/auth/login', authLimiter, (req, res) => {
    const parsed = AuthSignInSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Enter your email and password' });
      return;
    }
    try {
      const user = authenticatePasswordUser({
        email: parsed.data.email,
        password: parsed.data.password,
      });
      if (!user) {
        res.status(401).json({
          error: 'Incorrect email or password. Please check your details and try again.',
          code: 'INVALID_CREDENTIALS',
        });
        return;
      }
      const session = createSessionForUser(user.id);
      setSessionCookie(res, session.token, session.expiresAt);
      const business = getOwnedBusiness(user.id);
      res.json({ user, business, sessionToken: session.token });
    } catch (err) {
      logError('auth_login', err);
      res.status(500).json({ error: 'Unable to sign in right now' });
    }
  });

  router.get('/auth/google/url', authLimiter, (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      res.status(400).json({ error: 'Google OAuth credentials not configured' });
      return;
    }
    const reqOrigin = `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
    const envAppUrl = (process.env.APP_URL || '').trim().replace(/^["']+|["']+$/g, '').replace(/\/+$/, '');
    const baseUrl = envAppUrl && !envAppUrl.includes('.supabase.co') ? envAppUrl : reqOrigin;
    const redirectUri = `${baseUrl}/api/auth/google/callback`;
    const state = crypto.randomBytes(16).toString('hex');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      prompt: 'select_account',
      state,
    });
    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  });

  router.get('/auth/google/callback', authLimiter, async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!code || !clientId || !clientSecret) {
      res.status(400).send('Invalid OAuth callback');
      return;
    }
    try {
      const reqOrigin = `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
      const envAppUrl = (process.env.APP_URL || '').trim().replace(/^["']+|["']+$/g, '').replace(/\/+$/, '');
      const baseUrl = envAppUrl && !envAppUrl.includes('.supabase.co') ? envAppUrl : reqOrigin;
      const redirectUri = `${baseUrl}/api/auth/google/callback`;
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      const tokenJson = (await tokenRes.json()) as { access_token?: string };
      if (!tokenJson.access_token) {
        res.status(401).send('Google authentication failed');
        return;
      }
      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });
      const userInfo = (await userRes.json()) as { email?: string; name?: string };
      if (!userInfo.email) {
        res.status(401).send('Google account email unavailable');
        return;
      }
      const user = upsertUser({ email: userInfo.email, name: userInfo.name, authProvider: 'google' });
      const session = createSessionForUser(user.id);
      setSessionCookie(res, session.token, session.expiresAt);
      res.send(`<!doctype html><html><body><script>
        if (window.opener) {
          window.opener.postMessage({ type: 'TALLYMARK_OAUTH_SUCCESS', token: ${JSON.stringify(session.token)} }, '*');
          window.close();
        } else {
          window.location.href = '/app';
        }
      </script></body></html>`);
    } catch (err) {
      logError('google_oauth_callback', err);
      res.status(500).send('Authentication error');
    }
  });

  router.post('/auth/google', authLimiter, (req, res) => {
    const googleOAuthConfigured = Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    );
    const directEmailSignInEnabled =
      !googleOAuthConfigured &&
      !(process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_AUTH !== 'true');
    if (!directEmailSignInEnabled) {
      res.status(403).json({
        error: 'Direct email sign-in is disabled. Use Google OAuth or an email magic link.',
      });
      return;
    }
    const parsed = AuthGoogleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input' });
      return;
    }
    try {
      const user = upsertUser({
        email: parsed.data.email,
        name: parsed.data.name,
        authProvider: 'google',
      });
      const session = createSessionForUser(user.id);
      setSessionCookie(res, session.token, session.expiresAt);
      const business = getOwnedBusiness(user.id);
      res.json({ user, business, sessionToken: session.token });
    } catch (err) {
      logError('auth_google', err);
      res.status(500).json({ error: 'Unable to sign in right now' });
    }
  });

  router.post('/auth/magic-link', magicLinkLimiter, (req, res) => {
    const parsed = MagicLinkRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid email' });
      return;
    }
    try {
      const { token, expiresAt } = createMagicLinkToken(parsed.data.email, parsed.data.name);
      const reqOrigin = `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
      const envAppUrl = (process.env.APP_URL || '').trim().replace(/^["']+|["']+$/g, '').replace(/\/+$/, '');
      const origin = envAppUrl && !envAppUrl.includes('.supabase.co') ? envAppUrl : reqOrigin;
      const magicLinkUrl = `${origin}/login?magicToken=${encodeURIComponent(token)}`;
      res.json({ ok: true, expiresAt, magicLinkUrl, token });
    } catch (err) {
      logError('magic_link_request', err);
      res.status(500).json({ error: 'Failed to issue magic link' });
    }
  });

  router.post('/auth/magic-link/verify', authLimiter, (req, res) => {
    const parsed = MagicLinkVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid or missing magic-link token' });
      return;
    }
    try {
      const user = consumeMagicLinkToken(parsed.data.token);
      if (!user) {
        res.status(401).json({ error: 'This magic link has expired or already been used' });
        return;
      }
      const session = createSessionForUser(user.id);
      setSessionCookie(res, session.token, session.expiresAt);
      const business = getOwnedBusiness(user.id);
      res.json({ user, business, sessionToken: session.token });
    } catch (err) {
      logError('magic_link_verify', err);
      res.status(500).json({ error: 'Failed to verify magic link' });
    }
  });

  router.get('/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const business = getOwnedBusiness(user.id);
    res.json({ user, business });
  });

  router.post('/auth/logout', requireAuth, (req: AuthenticatedRequest, res) => {
    if (req.sessionTokenHash) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionTokenHash);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // Public receipt endpoint (logged out!)
  const handleGetPublicReceipt = (req: Request, res: Response) => {
    const publicId = String(req.params.publicId || req.body?.publicId || '').trim();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(publicId)) {
      res.status(404).json({ error: 'Receipt not found' });
      return;
    }
    const row = db
      .prepare(
        `SELECT pr.*, COALESCE(pr.business_signature_data_url, b.signature_data_url) AS business_signature_data_url
         FROM public_receipts pr
         LEFT JOIN receipts r ON r.id = pr.receipt_id
         LEFT JOIN businesses b ON b.id = r.business_id
         WHERE pr.public_id = ?`
      )
      .get(publicId);
    if (!row) {
      res.status(404).json({ error: 'Receipt not found' });
      return;
    }
    res.json({ receipt: mapPublicReceiptRow(row) });
  };

  router.get('/public/receipts/:publicId', publicLimiter, handleGetPublicReceipt);
  router.get('/rpc/get_public_receipt/:publicId', publicLimiter, handleGetPublicReceipt);
  router.post('/rpc/get_public_receipt', publicLimiter, handleGetPublicReceipt);

  // Business endpoints
  router.get('/business', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    res.json({ business });
  });

  router.post('/business', requireAuth, (req: AuthenticatedRequest, res) => {
    const parsed = BusinessInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid business details' });
      return;
    }
    const input = parsed.data;
    const now = new Date().toISOString();

    try {
      const existing = getOwnedBusiness(req.user!.id);
      if (existing) {
        db.prepare(
          `UPDATE businesses
           SET name = ?, logo_data_url = ?, signature_data_url = ?, address = ?, phone = ?, email = ?,
               brand_color = ?, receipt_prefix = ?, currency = ?, vat_enabled = ?,
               vat_mode = ?, opening_cash_kobo = ?, default_template = ?,
               close_day_reminder_time = ?, updated_at = ?
           WHERE id = ? AND owner_id = ?`
        ).run(
          input.name,
          input.logoDataUrl ?? null,
          input.signatureDataUrl !== undefined ? input.signatureDataUrl : (existing.signatureDataUrl ?? null),
          input.address,
          input.phone,
          input.email,
          input.brandColor,
          input.receiptPrefix,
          input.currency,
          input.vatEnabled ? 1 : 0,
          input.vatMode,
          input.openingCashKobo,
          input.defaultTemplate,
          input.closeDayReminderTime,
          now,
          existing.id,
          req.user!.id
        );
        res.json({ business: getOwnedBusiness(req.user!.id) });
        return;
      }

      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO businesses (
          id, owner_id, name, logo_data_url, signature_data_url, address, phone, email,
          brand_color, receipt_prefix, next_sequence, currency,
          vat_enabled, vat_mode, vat_rate_bps, opening_cash_kobo,
          default_template, close_day_reminder_time, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 750, ?, ?, ?, ?, ?)`
      ).run(
        id,
        req.user!.id,
        input.name,
        input.logoDataUrl ?? null,
        input.signatureDataUrl ?? null,
        input.address,
        input.phone,
        input.email,
        input.brandColor,
        input.receiptPrefix,
        input.currency,
        input.vatEnabled ? 1 : 0,
        input.vatMode,
        input.openingCashKobo,
        input.defaultTemplate,
        input.closeDayReminderTime,
        now,
        now
      );
      res.status(201).json({ business: getOwnedBusiness(req.user!.id) });
    } catch (err) {
      logError('upsert_business', err, { userId: req.user!.id });
      res.status(500).json({ error: 'Unable to save business profile' });
    }
  });

  router.patch('/business', requireAuth, (req: AuthenticatedRequest, res) => {
    const existing = getOwnedBusiness(req.user!.id);
    if (!existing) {
      res.status(404).json({ error: 'Complete onboarding first' });
      return;
    }
    const merged = {
      name: req.body.name ?? existing.name,
      logoDataUrl: req.body.logoDataUrl !== undefined ? req.body.logoDataUrl : existing.logoDataUrl,
      signatureDataUrl:
        req.body.signatureDataUrl !== undefined
          ? req.body.signatureDataUrl
          : (existing.signatureDataUrl ?? null),
      address: req.body.address ?? existing.address,
      phone: req.body.phone ?? existing.phone,
      email: req.body.email ?? existing.email,
      brandColor: req.body.brandColor ?? existing.brandColor,
      receiptPrefix: req.body.receiptPrefix ?? existing.receiptPrefix,
      currency: req.body.currency ?? existing.currency,
      vatEnabled: req.body.vatEnabled ?? existing.vatEnabled,
      vatMode: req.body.vatMode ?? existing.vatMode,
      openingCashKobo: req.body.openingCashKobo ?? existing.openingCashKobo,
      defaultTemplate: req.body.defaultTemplate ?? existing.defaultTemplate,
      closeDayReminderTime: req.body.closeDayReminderTime ?? existing.closeDayReminderTime,
    };
    const parsed = BusinessInputSchema.safeParse(merged);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid settings' });
      return;
    }
    const input = parsed.data;
    const now = new Date().toISOString();
    try {
      db.prepare(
        `UPDATE businesses
         SET name = ?, logo_data_url = ?, signature_data_url = ?, address = ?, phone = ?, email = ?,
             brand_color = ?, receipt_prefix = ?, currency = ?, vat_enabled = ?,
             vat_mode = ?, opening_cash_kobo = ?, default_template = ?,
             close_day_reminder_time = ?, updated_at = ?
         WHERE id = ? AND owner_id = ?`
      ).run(
        input.name,
        input.logoDataUrl ?? null,
        input.signatureDataUrl ?? null,
        input.address,
        input.phone,
        input.email,
        input.brandColor,
        input.receiptPrefix,
        input.currency,
        input.vatEnabled ? 1 : 0,
        input.vatMode,
        input.openingCashKobo,
        input.defaultTemplate,
        input.closeDayReminderTime,
        now,
        existing.id,
        req.user!.id
      );
      res.json({ business: getOwnedBusiness(req.user!.id) });
    } catch (err) {
      logError('patch_business', err, { userId: req.user!.id });
      res.status(500).json({ error: 'Unable to update settings' });
    }
  });

  // Suggestions
  router.get('/suggestions', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.json({ customers: [], items: [] });
      return;
    }
    const customers = db
      .prepare('SELECT id, name, phone FROM customers WHERE business_id = ? ORDER BY updated_at DESC LIMIT 100')
      .all(business.id);
    const items = db
      .prepare(
        'SELECT id, description, unit_price_kobo AS unitPriceKobo, use_count AS useCount FROM catalog_items WHERE business_id = ? ORDER BY use_count DESC, updated_at DESC LIMIT 100'
      )
      .all(business.id);
    res.json({ customers, items });
  });

  // Home summary (Phase 2: sales, expenses, net, cash in hand, debts, yesterday close status)
  router.get('/home', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    const todayLagos = getLagosDateString();
    const yesterdayLagos = shiftLagosDate(todayLagos, -1);

    const allEntries = getAllLedgerEntries(business.id);
    const closures = getAllClosures(business.id);
    const todayView = buildCashBookDayView({
      date: todayLagos,
      businessOpeningCashKobo: business.openingCashKobo,
      allEntries,
      closures,
    });
    const yesterdayClosed = closures.some((c) => c.closeDate === yesterdayLagos);
    const yesterdayHasActivity = allEntries.some((e) => e.entryDate === yesterdayLagos);

    const todayReceiptsRow = db
      .prepare(
        `SELECT COUNT(*) AS cnt
         FROM receipts
         WHERE business_id = ? AND issued_date_lagos = ? AND status != 'VOID'`
      )
      .get(business.id, todayLagos) as { cnt: number };

    const allReceipts = db
      .prepare('SELECT * FROM receipts WHERE business_id = ? ORDER BY sequence_number DESC')
      .all(business.id)
      .map(mapReceiptRow);

    const allCreditSales = db
      .prepare('SELECT * FROM credit_sales WHERE business_id = ? ORDER BY entry_date DESC')
      .all(business.id)
      .map(mapCreditSaleRow);

    const debtorGroups = groupDebtsByCustomer({
      todayDateLagos: todayLagos,
      receipts: allReceipts,
      creditSales: allCreditSales,
    });

    const outstandingTotalKobo = debtorGroups.reduce((s, g) => s + g.totalOwedKobo, 0);
    const outstandingCount = debtorGroups.reduce((s, g) => s + g.openCount, 0);

    res.json({
      summary: {
        todayDateLagos: todayLagos,
        yesterdayDateLagos: yesterdayLagos,
        yesterdayClosed,
        yesterdayHasActivity,
        todayReceiptsCount: Number(todayReceiptsRow.cnt || 0),
        todayMoneyReceivedKobo: todayView.moneyInTotalKobo,
        todaySalesTotalKobo:
          todayView.receiptSalesKobo + todayView.quickSalesKobo + todayView.creditSalesGivenKobo,
        todayExpensesKobo: todayView.moneyOutTotalKobo,
        todayNetKobo: todayView.netKobo,
        cashInHandKobo: todayView.closingCashInHandKobo,
        outstandingTotalKobo,
        outstandingCount,
        totalReceiptsCount: allReceipts.length,
      },
      recentReceipts: allReceipts.slice(0, 6),
      outstandingReceipts: allReceipts
        .filter((r) => r.receiptKind === 'SALE' && r.status === 'PART_PAID' && r.balanceDueKobo > 0)
        .slice(0, 8),
      debtorsPreview: debtorGroups.slice(0, 5),
      todayEntries: todayView.rows.slice(-6).reverse(),
    });
  });

  // Receipts list & detail
  router.get('/receipts', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : 'ALL';
    const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom.trim() : '';
    const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo.trim() : '';
    const customer = typeof req.query.customer === 'string' ? req.query.customer.trim().toLowerCase() : '';

    const conditions: string[] = ['business_id = ?'];
    const params: any[] = [business.id];

    if (status && status !== 'ALL' && ['PAID', 'PART_PAID', 'VOID'].includes(status)) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
      conditions.push('issued_date_lagos >= ?');
      params.push(dateFrom);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      conditions.push('issued_date_lagos <= ?');
      params.push(dateTo);
    }
    if (customer) {
      conditions.push('LOWER(customer_name) LIKE ?');
      params.push(`%${customer}%`);
    }
    if (q) {
      conditions.push(
        '(LOWER(receipt_number) LIKE ? OR LOWER(customer_name) LIKE ? OR LOWER(customer_phone) LIKE ? OR LOWER(items_json) LIKE ? OR LOWER(sold_by) LIKE ?)'
      );
      const pattern = `%${q}%`;
      params.push(pattern, pattern, pattern, pattern, pattern);
    }

    const sql = `SELECT * FROM receipts WHERE ${conditions.join(' AND ')} ORDER BY sequence_number DESC LIMIT 200`;
    const rows = db.prepare(sql).all(...params);
    res.json({ receipts: rows.map(mapReceiptRow) });
  });

  router.get('/receipts/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const id = String(req.params.id || '');
    const row = db
      .prepare('SELECT * FROM receipts WHERE id = ? AND business_id = ?')
      .get(id, business.id);
    if (!row) {
      res.status(404).json({ error: 'Receipt not found' });
      return;
    }
    const receipt = mapReceiptRow(row);
    const linkedPayments = db
      .prepare('SELECT * FROM receipts WHERE parent_receipt_id = ? AND business_id = ? ORDER BY sequence_number ASC')
      .all(receipt.id, business.id)
      .map(mapReceiptRow);

    res.json({ receipt, linkedPayments });
  });

  // Issue Receipt
  const handleIssueReceipt = (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Complete onboarding before issuing receipts' });
      return;
    }
    const parsed = CreateReceiptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid receipt data' });
      return;
    }
    const input = parsed.data;
    const totals = calculateReceiptTotals(
      input.items,
      business.vatEnabled,
      business.vatMode,
      business.vatRateBps
    );

    if (input.amountPaidKobo > totals.totalKobo) {
      res.status(400).json({ error: 'Amount paid cannot exceed receipt total' });
      return;
    }

    const issuedDateLagos = input.issuedDateLagos || getLagosDateString();
    if (isDayClosed(business.id, issuedDateLagos)) {
      res.status(409).json({
        error: `Day ${issuedDateLagos} is closed. Post a visible correction entry or issue for today.`,
        code: 'CLOSED_DAY',
      });
      return;
    }

    const balanceDueKobo = Math.max(0, totals.totalKobo - input.amountPaidKobo);
    const status = balanceDueKobo === 0 ? 'PAID' : 'PART_PAID';
    const issuedAt = new Date().toISOString();
    const template = input.template || business.defaultTemplate;

    try {
      const created = runTransaction(() => {
        const bizRow = db
          .prepare('SELECT next_sequence, receipt_prefix FROM businesses WHERE id = ? AND owner_id = ?')
          .get(business.id, req.user!.id) as { next_sequence: number; receipt_prefix: string } | undefined;

        if (!bizRow) throw new Error('Business not found');

        const seq = Number(bizRow.next_sequence);
        const receiptNumber = formatReceiptNumber(bizRow.receipt_prefix, seq);
        const receiptId = crypto.randomUUID();
        const publicId = crypto.randomBytes(16).toString('base64url');
        const itemsJson = JSON.stringify(totals.items);

        db.prepare('UPDATE businesses SET next_sequence = next_sequence + 1, updated_at = ? WHERE id = ?').run(
          issuedAt,
          business.id
        );

        db.prepare(
          `INSERT INTO receipts (
            id, business_id, public_id, sequence_number, receipt_number, receipt_kind,
            parent_receipt_id, parent_receipt_number, customer_name, customer_phone,
            items_json, subtotal_kobo, discount_total_kobo, vat_enabled, vat_mode, vat_rate_bps,
            vat_kobo, total_kobo, initial_paid_kobo, amount_paid_kobo, balance_due_kobo,
            payment_method, note, sold_by, source, template, status,
            issued_date_lagos, issued_at, created_by
          ) VALUES (?, ?, ?, ?, ?, 'SALE', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          receiptId,
          business.id,
          publicId,
          seq,
          receiptNumber,
          input.customerName,
          input.customerPhone,
          itemsJson,
          totals.subtotalKobo,
          totals.discountTotalKobo,
          business.vatEnabled ? 1 : 0,
          business.vatMode,
          business.vatRateBps,
          totals.vatKobo,
          totals.totalKobo,
          input.amountPaidKobo,
          input.amountPaidKobo,
          balanceDueKobo,
          input.paymentMethod,
          input.note,
          input.soldBy,
          input.source,
          template,
          status,
          issuedDateLagos,
          issuedAt,
          req.user!.id
        );

        db.prepare(
          `INSERT INTO ledger_entries (
            id, business_id, entry_type, entry_kind, amount_kobo, cash_received_kobo,
            payment_method, receipt_id, parent_entry_id, customer_name, customer_phone,
            note, sold_by, source, entry_date, created_at, created_by
          ) VALUES (?, ?, 'SALE', 'RECEIPT', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          business.id,
          totals.totalKobo,
          input.amountPaidKobo,
          input.paymentMethod,
          receiptId,
          input.customerName,
          input.customerPhone,
          input.note || `Sale ${receiptNumber}`,
          input.soldBy,
          input.source,
          issuedDateLagos,
          issuedAt,
          req.user!.id
        );

        db.prepare(
          `INSERT INTO public_receipts (
            public_id, receipt_id, receipt_number, receipt_kind, parent_receipt_number,
            business_name, business_logo_data_url, business_address, business_phone, business_email,
            brand_color, currency, customer_name, customer_phone, items_json,
            subtotal_kobo, discount_total_kobo, vat_enabled, vat_mode, vat_rate_bps,
            vat_kobo, total_kobo, amount_paid_kobo, balance_due_kobo, payment_method,
            note, sold_by, template, status, issued_date_lagos, issued_at
          ) VALUES (?, ?, ?, 'SALE', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          publicId,
          receiptId,
          receiptNumber,
          business.name,
          business.logoDataUrl,
          business.address,
          business.phone,
          business.email,
          business.brandColor,
          business.currency,
          input.customerName,
          input.customerPhone,
          itemsJson,
          totals.subtotalKobo,
          totals.discountTotalKobo,
          business.vatEnabled ? 1 : 0,
          business.vatMode,
          business.vatRateBps,
          totals.vatKobo,
          totals.totalKobo,
          input.amountPaidKobo,
          balanceDueKobo,
          input.paymentMethod,
          input.note,
          input.soldBy,
          template,
          status,
          issuedDateLagos,
          issuedAt
        );

        upsertCustomerSuggestion(business.id, input.customerName, input.customerPhone, issuedAt);

        for (const item of totals.items) {
          const existingItem = db
            .prepare('SELECT id FROM catalog_items WHERE business_id = ? AND LOWER(description) = LOWER(?)')
            .get(business.id, item.description) as { id: string } | undefined;
          if (existingItem) {
            db.prepare(
              'UPDATE catalog_items SET unit_price_kobo = ?, use_count = use_count + 1, updated_at = ? WHERE id = ?'
            ).run(item.unitPriceKobo, issuedAt, existingItem.id);
          } else {
            db.prepare(
              'INSERT INTO catalog_items (id, business_id, description, unit_price_kobo, use_count, updated_at) VALUES (?, ?, ?, ?, 1, ?)'
            ).run(crypto.randomUUID(), business.id, item.description, item.unitPriceKobo, issuedAt);
          }
        }

        const row = db.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId);
        return mapReceiptRow(row);
      });

      res.status(201).json({ receipt: created });
    } catch (err) {
      logError('create_receipt', err, { userId: req.user!.id });
      res.status(500).json({ error: 'Unable to issue receipt' });
    }
  };

  router.post('/receipts', requireAuth, handleIssueReceipt);
  router.post('/rpc/issue_receipt', requireAuth, handleIssueReceipt);

  // Shared helper for receiving balance on a part-paid receipt
  function executeReceiveReceiptBalance(params: {
    business: BusinessProfile;
    userId: string;
    parentId: string;
    amountKobo: number;
    paymentMethod: string;
    note: string;
    soldBy: string;
    issuedDateLagos: string;
    template?: string;
  }) {
    const {
      business,
      userId,
      parentId,
      amountKobo,
      paymentMethod,
      note,
      soldBy,
      issuedDateLagos,
      template: tplOverride,
    } = params;

    if (isDayClosed(business.id, issuedDateLagos)) {
      return {
        error: `Day ${issuedDateLagos} is closed. Record payment on today's date instead.`,
        status: 409 as const,
      };
    }

    const issuedAt = new Date().toISOString();

    return runTransaction(() => {
      const parentRow = db
        .prepare('SELECT * FROM receipts WHERE id = ? AND business_id = ?')
        .get(parentId, business.id) as any;

      if (!parentRow) return { error: 'Receipt not found', status: 404 as const };
      if (parentRow.status === 'VOID') {
        return { error: 'Cannot receive balance on a voided receipt', status: 400 as const };
      }
      if (parentRow.receipt_kind !== 'SALE') {
        return { error: 'Balance payments only apply to an original sale receipt', status: 400 as const };
      }
      const currentBalance = Number(parentRow.balance_due_kobo);
      if (currentBalance <= 0) {
        return { error: 'This receipt has already been paid in full', status: 400 as const };
      }
      if (amountKobo > currentBalance) {
        return { error: 'Payment amount exceeds remaining balance due', status: 400 as const };
      }

      const bizRow = db
        .prepare('SELECT next_sequence, receipt_prefix FROM businesses WHERE id = ? AND owner_id = ?')
        .get(business.id, userId) as { next_sequence: number; receipt_prefix: string };

      const seq = Number(bizRow.next_sequence);
      const receiptNumber = formatReceiptNumber(bizRow.receipt_prefix, seq);
      const childId = crypto.randomUUID();
      const childPublicId = crypto.randomBytes(16).toString('base64url');
      const template = tplOverride || parentRow.template || business.defaultTemplate;

      const newParentPaid = Number(parentRow.amount_paid_kobo) + amountKobo;
      const newParentBalance = Math.max(0, Number(parentRow.total_kobo) - newParentPaid);
      const newParentStatus = newParentBalance === 0 ? 'PAID' : 'PART_PAID';

      const balanceItem: ReceiptLineItem[] = [
        {
          description: `Balance payment for Receipt ${parentRow.receipt_number}`,
          qty: 1,
          unitPriceKobo: amountKobo,
          discountKobo: 0,
          grossKobo: amountKobo,
          lineTotalKobo: amountKobo,
        },
      ];
      const itemsJson = JSON.stringify(balanceItem);

      db.prepare('UPDATE businesses SET next_sequence = next_sequence + 1, updated_at = ? WHERE id = ?').run(
        issuedAt,
        business.id
      );

      db.prepare(
        `INSERT INTO receipts (
          id, business_id, public_id, sequence_number, receipt_number, receipt_kind,
          parent_receipt_id, parent_receipt_number, customer_name, customer_phone,
          items_json, subtotal_kobo, discount_total_kobo, vat_enabled, vat_mode, vat_rate_bps,
          vat_kobo, total_kobo, initial_paid_kobo, amount_paid_kobo, balance_due_kobo,
          payment_method, note, sold_by, source, template, status,
          issued_date_lagos, issued_at, created_by
        ) VALUES (?, ?, ?, ?, ?, 'BALANCE_PAYMENT', ?, ?, ?, ?, ?, ?, 0, 0, 'exclusive', 0, 0, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, 'PAID', ?, ?, ?)`
      ).run(
        childId,
        business.id,
        childPublicId,
        seq,
        receiptNumber,
        parentRow.id,
        parentRow.receipt_number,
        parentRow.customer_name,
        parentRow.customer_phone,
        itemsJson,
        amountKobo,
        amountKobo,
        amountKobo,
        amountKobo,
        newParentBalance,
        paymentMethod,
        note || `Remaining balance: ${newParentBalance === 0 ? 'Settled in full' : formatKobo(newParentBalance, business.currency)}`,
        soldBy || parentRow.sold_by || '',
        template,
        issuedDateLagos,
        issuedAt,
        userId
      );

      db.prepare('UPDATE receipts SET amount_paid_kobo = ?, balance_due_kobo = ?, status = ? WHERE id = ?').run(
        newParentPaid,
        newParentBalance,
        newParentStatus,
        parentRow.id
      );

      db.prepare(
        'UPDATE public_receipts SET amount_paid_kobo = ?, balance_due_kobo = ?, status = ? WHERE receipt_id = ?'
      ).run(newParentPaid, newParentBalance, newParentStatus, parentRow.id);

      db.prepare(
        `INSERT INTO public_receipts (
          public_id, receipt_id, receipt_number, receipt_kind, parent_receipt_number,
          business_name, business_logo_data_url, business_address, business_phone, business_email,
          brand_color, currency, customer_name, customer_phone, items_json,
          subtotal_kobo, discount_total_kobo, vat_enabled, vat_mode, vat_rate_bps,
          vat_kobo, total_kobo, amount_paid_kobo, balance_due_kobo, payment_method,
          note, sold_by, template, status, issued_date_lagos, issued_at
        ) VALUES (?, ?, ?, 'BALANCE_PAYMENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'exclusive', 0, 0, ?, ?, ?, ?, ?, ?, ?, 'PAID', ?, ?)`
      ).run(
        childPublicId,
        childId,
        receiptNumber,
        parentRow.receipt_number,
        business.name,
        business.logoDataUrl,
        business.address,
        business.phone,
        business.email,
        business.brandColor,
        business.currency,
        parentRow.customer_name,
        parentRow.customer_phone,
        itemsJson,
        amountKobo,
        amountKobo,
        amountKobo,
        newParentBalance,
        paymentMethod,
        note || `Balance payment for ${parentRow.receipt_number}`,
        soldBy || parentRow.sold_by || '',
        template,
        issuedDateLagos,
        issuedAt
      );

      db.prepare(
        `INSERT INTO ledger_entries (
          id, business_id, entry_type, entry_kind, amount_kobo, cash_received_kobo,
          payment_method, receipt_id, parent_entry_id, customer_name, customer_phone,
          note, sold_by, source, entry_date, created_at, created_by
        ) VALUES (?, ?, 'PAYMENT_RECEIVED', 'DEBT_PAYMENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?)`
      ).run(
        crypto.randomUUID(),
        business.id,
        amountKobo,
        amountKobo,
        paymentMethod,
        childId,
        parentRow.id,
        parentRow.customer_name,
        parentRow.customer_phone,
        note || `Balance received for ${parentRow.receipt_number}`,
        soldBy || parentRow.sold_by || '',
        issuedDateLagos,
        issuedAt,
        userId
      );

      const newChild = db.prepare('SELECT * FROM receipts WHERE id = ?').get(childId);
      const updatedParent = db.prepare('SELECT * FROM receipts WHERE id = ?').get(parentRow.id);
      return {
        receipt: mapReceiptRow(newChild),
        parentReceipt: mapReceiptRow(updatedParent),
      };
    });
  }

  router.post('/receipts/:id/receive-balance', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const parsed = ReceiveBalanceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payment details' });
      return;
    }
    try {
      const result = executeReceiveReceiptBalance({
        business,
        userId: req.user!.id,
        parentId: String(req.params.id || ''),
        amountKobo: parsed.data.amountKobo,
        paymentMethod: parsed.data.paymentMethod,
        note: parsed.data.note,
        soldBy: parsed.data.soldBy,
        issuedDateLagos: parsed.data.issuedDateLagos || getLagosDateString(),
        template: parsed.data.template,
      });
      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.status(201).json(result);
    } catch (err) {
      logError('receive_balance', err, { userId: req.user!.id });
      res.status(500).json({ error: 'Unable to record balance payment' });
    }
  });

  // Void receipt
  router.post('/receipts/:id/void', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const parsed = VoidReceiptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Void reason required' });
      return;
    }

    const receiptId = String(req.params.id || '');
    const now = new Date().toISOString();
    const todayLagos = getLagosDateString();

    try {
      // If this receipt belongs to a V2 payment, delegate to V2 reversal so debt & invoice reopen cleanly
      const v2PaymentResult = executeVoidV2PaymentByReceipt({
        businessId: business.id,
        userId: req.user!.id,
        receiptId,
        reason: parsed.data.reason,
      });
      if (v2PaymentResult) {
        if ('error' in v2PaymentResult) {
          res.status(v2PaymentResult.status ?? 400).json({ error: v2PaymentResult.error });
          return;
        }
        res.json({ receipt: mapReceiptRow(v2PaymentResult.receiptRow) });
        return;
      }

      const result = runTransaction(() => {
        const row = db
          .prepare('SELECT * FROM receipts WHERE id = ? AND business_id = ?')
          .get(receiptId, business.id) as any;
        if (!row) return { error: 'Receipt not found', status: 404 as const };
        if (row.status === 'VOID') return { error: 'Receipt is already voided', status: 400 as const };

        if (row.receipt_kind === 'BALANCE_PAYMENT' && row.parent_receipt_id) {
          const parentRow = db
            .prepare('SELECT * FROM receipts WHERE id = ? AND business_id = ?')
            .get(row.parent_receipt_id, business.id) as any;
          if (parentRow && parentRow.status !== 'VOID') {
            const restoredPaid = Math.max(0, Number(parentRow.amount_paid_kobo) - Number(row.total_kobo));
            const restoredBalance = Math.max(0, Number(parentRow.total_kobo) - restoredPaid);
            const restoredStatus = restoredBalance === 0 ? 'PAID' : 'PART_PAID';
            db.prepare('UPDATE receipts SET amount_paid_kobo = ?, balance_due_kobo = ?, status = ? WHERE id = ?').run(
              restoredPaid,
              restoredBalance,
              restoredStatus,
              parentRow.id
            );
            db.prepare(
              'UPDATE public_receipts SET amount_paid_kobo = ?, balance_due_kobo = ?, status = ? WHERE receipt_id = ?'
            ).run(restoredPaid, restoredBalance, restoredStatus, parentRow.id);
          }
        }

        db.prepare(
          `UPDATE receipts
           SET status = 'VOID', void_reason = ?, voided_at = ?, voided_by = ?
           WHERE id = ? AND business_id = ?`
        ).run(parsed.data.reason, now, req.user!.id, receiptId, business.id);

        db.prepare(
          `UPDATE public_receipts
           SET status = 'VOID', void_reason = ?, voided_at = ?
           WHERE receipt_id = ?`
        ).run(parsed.data.reason, now, receiptId);

        const todayClosed = isDayClosed(business.id, todayLagos);
        db.prepare(
          `INSERT INTO ledger_entries (
            id, business_id, entry_type, entry_kind, amount_kobo, cash_received_kobo,
            payment_method, receipt_id, parent_entry_id, customer_name, customer_phone,
            note, sold_by, source, is_correction, correction_reason,
            entry_date, created_at, created_by
          ) VALUES (?, ?, 'ADJUSTMENT', 'VOID_REVERSAL', ?, ?, ?, ?, NULL, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          business.id,
          -Number(row.total_kobo),
          -Number(row.initial_paid_kobo),
          row.payment_method,
          receiptId,
          row.customer_name || '',
          row.customer_phone || '',
          `VOID ${row.receipt_number}: ${parsed.data.reason}`,
          row.sold_by || '',
          todayClosed ? 1 : 0,
          todayClosed ? `Voided ${row.receipt_number}: ${parsed.data.reason}` : '',
          todayLagos,
          now,
          req.user!.id
        );

        const updated = db.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId);
        return { receipt: mapReceiptRow(updated) };
      });

      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (err) {
      logError('void_receipt', err, { userId: req.user!.id, receiptId });
      res.status(500).json({ error: 'Unable to void receipt' });
    }
  });

  // ============ PHASE 2: QUICK SALES & CREDIT SALES ============

  router.post('/sales/quick', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Complete onboarding first' });
      return;
    }
    const parsed = QuickSaleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid quick sale' });
      return;
    }
    const input = parsed.data;
    const entryDate = input.entryDate || getLagosDateString();
    if (isDayClosed(business.id, entryDate)) {
      res.status(409).json({
        error: `Day ${entryDate} is closed. Post a visible correction entry instead.`,
        code: 'CLOSED_DAY',
      });
      return;
    }

    const now = new Date().toISOString();
    const entryId = crypto.randomUUID();
    try {
      const entry = runTransaction(() => {
        db.prepare(
          `INSERT INTO ledger_entries (
            id, business_id, entry_type, entry_kind, amount_kobo, cash_received_kobo,
            payment_method, customer_name, customer_phone, note, sold_by, source,
            entry_date, created_at, created_by
          ) VALUES (?, ?, 'SALE', 'QUICK_SALE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          entryId,
          business.id,
          input.amountKobo,
          input.amountKobo,
          input.paymentMethod,
          input.customerName,
          input.customerPhone,
          input.itemNote || 'Quick sale',
          input.soldBy,
          input.source,
          entryDate,
          now,
          req.user!.id
        );
        upsertCustomerSuggestion(business.id, input.customerName, input.customerPhone, now);
        const row = db.prepare('SELECT * FROM ledger_entries WHERE id = ?').get(entryId);
        return mapLedgerRow(row);
      });
      res.status(201).json({ entry });
    } catch (err) {
      logError('quick_sale', err, { userId: req.user!.id });
      res.status(500).json({ error: 'Unable to record quick sale' });
    }
  });

  // Issue an official receipt later from a Quick Sale entry (without double-counting ledger)
  router.post('/ledger/:entryId/issue-receipt', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const entryId = String(req.params.entryId || '');
    const now = new Date().toISOString();

    try {
      const result = runTransaction(() => {
        const entryRow = db
          .prepare('SELECT * FROM ledger_entries WHERE id = ? AND business_id = ?')
          .get(entryId, business.id) as any;

        if (!entryRow) return { error: 'Entry not found', status: 404 as const };
        if (entryRow.entry_kind !== 'QUICK_SALE') {
          return { error: 'Receipts can only be generated from quick sale entries', status: 400 as const };
        }
        if (entryRow.receipt_id) {
          const existing = db.prepare('SELECT * FROM receipts WHERE id = ?').get(entryRow.receipt_id);
          return { receipt: mapReceiptRow(existing) };
        }

        const bizRow = db
          .prepare('SELECT next_sequence, receipt_prefix FROM businesses WHERE id = ? AND owner_id = ?')
          .get(business.id, req.user!.id) as { next_sequence: number; receipt_prefix: string };

        const seq = Number(bizRow.next_sequence);
        const receiptNumber = formatReceiptNumber(bizRow.receipt_prefix, seq);
        const receiptId = crypto.randomUUID();
        const publicId = crypto.randomBytes(16).toString('base64url');
        const amountKobo = Number(entryRow.amount_kobo);
        const items: ReceiptLineItem[] = [
          {
            description: entryRow.note || 'Store purchase',
            qty: 1,
            unitPriceKobo: amountKobo,
            discountKobo: 0,
            grossKobo: amountKobo,
            lineTotalKobo: amountKobo,
          },
        ];
        const itemsJson = JSON.stringify(items);

        db.prepare('UPDATE businesses SET next_sequence = next_sequence + 1, updated_at = ? WHERE id = ?').run(
          now,
          business.id
        );

        db.prepare(
          `INSERT INTO receipts (
            id, business_id, public_id, sequence_number, receipt_number, receipt_kind,
            customer_name, customer_phone, items_json, subtotal_kobo, discount_total_kobo,
            vat_enabled, vat_mode, vat_rate_bps, vat_kobo, total_kobo,
            initial_paid_kobo, amount_paid_kobo, balance_due_kobo, payment_method,
            note, sold_by, source, template, status, issued_date_lagos, issued_at, created_by
          ) VALUES (?, ?, ?, ?, ?, 'SALE', ?, ?, ?, ?, 0, 0, 'exclusive', 0, 0, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'PAID', ?, ?, ?)`
        ).run(
          receiptId,
          business.id,
          publicId,
          seq,
          receiptNumber,
          entryRow.customer_name || '',
          entryRow.customer_phone || '',
          itemsJson,
          amountKobo,
          amountKobo,
          amountKobo,
          amountKobo,
          entryRow.payment_method || 'Cash',
          entryRow.note || '',
          entryRow.sold_by || '',
          entryRow.source || 'manual',
          business.defaultTemplate,
          entryRow.entry_date,
          now,
          req.user!.id
        );

        db.prepare(
          `INSERT INTO public_receipts (
            public_id, receipt_id, receipt_number, receipt_kind, business_name,
            business_logo_data_url, business_address, business_phone, business_email,
            brand_color, currency, customer_name, customer_phone, items_json,
            subtotal_kobo, discount_total_kobo, vat_enabled, vat_mode, vat_rate_bps,
            vat_kobo, total_kobo, amount_paid_kobo, balance_due_kobo, payment_method,
            note, sold_by, template, status, issued_date_lagos, issued_at
          ) VALUES (?, ?, ?, 'SALE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'exclusive', 0, 0, ?, ?, 0, ?, ?, ?, ?, 'PAID', ?, ?)`
        ).run(
          publicId,
          receiptId,
          receiptNumber,
          business.name,
          business.logoDataUrl,
          business.address,
          business.phone,
          business.email,
          business.brandColor,
          business.currency,
          entryRow.customer_name || '',
          entryRow.customer_phone || '',
          itemsJson,
          amountKobo,
          amountKobo,
          amountKobo,
          entryRow.payment_method || 'Cash',
          entryRow.note || '',
          entryRow.sold_by || '',
          business.defaultTemplate,
          entryRow.entry_date,
          now
        );

        db.prepare('UPDATE ledger_entries SET receipt_id = ? WHERE id = ?').run(receiptId, entryId);
        const created = db.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId);
        return { receipt: mapReceiptRow(created) };
      });

      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.status(201).json(result);
    } catch (err) {
      logError('issue_receipt_from_quick_sale', err, { userId: req.user!.id, entryId });
      res.status(500).json({ error: 'Unable to issue receipt for this sale' });
    }
  });

  // Credit sale ("borrowed") -> creates debt; 0 cash received until paid
  router.post('/sales/credit', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Complete onboarding first' });
      return;
    }
    const parsed = CreditSaleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid credit sale' });
      return;
    }
    const input = parsed.data;
    const entryDate = input.entryDate || getLagosDateString();
    if (isDayClosed(business.id, entryDate)) {
      res.status(409).json({
        error: `Day ${entryDate} is closed. Post a visible correction entry instead.`,
        code: 'CLOSED_DAY',
      });
      return;
    }

    const now = new Date().toISOString();
    const creditSaleId = crypto.randomUUID();
    const ledgerId = crypto.randomUUID();

    try {
      const created = runTransaction(() => {
        db.prepare(
          `INSERT INTO credit_sales (
            id, business_id, customer_name, customer_phone, item_note,
            total_kobo, amount_paid_kobo, balance_due_kobo, due_date, sold_by,
            status, entry_date, created_at, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'UNPAID', ?, ?, ?)`
        ).run(
          creditSaleId,
          business.id,
          input.customerName,
          input.customerPhone,
          input.itemNote,
          input.amountKobo,
          input.amountKobo,
          input.dueDate || null,
          input.soldBy,
          entryDate,
          now,
          req.user!.id
        );

        db.prepare(
          `INSERT INTO ledger_entries (
            id, business_id, entry_type, entry_kind, amount_kobo, cash_received_kobo,
            payment_method, credit_sale_id, customer_name, customer_phone,
            note, sold_by, source, entry_date, created_at, created_by
          ) VALUES (?, ?, 'SALE', 'CREDIT_SALE', ?, 0, 'Other', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          ledgerId,
          business.id,
          input.amountKobo,
          creditSaleId,
          input.customerName,
          input.customerPhone,
          input.itemNote || `Credit sale to ${input.customerName}`,
          input.soldBy,
          input.source,
          entryDate,
          now,
          req.user!.id
        );

        upsertCustomerSuggestion(business.id, input.customerName, input.customerPhone, now);
        const row = db.prepare('SELECT * FROM credit_sales WHERE id = ?').get(creditSaleId);
        return mapCreditSaleRow(row);
      });

      res.status(201).json({ creditSale: created });
    } catch (err) {
      logError('credit_sale', err, { userId: req.user!.id });
      res.status(500).json({ error: 'Unable to record credit sale' });
    }
  });

  // ============ PHASE 2: DEBTORS & CREDITORS ============

  router.get('/debtors', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    const todayLagos = getLagosDateString();
    const receipts = db
      .prepare('SELECT * FROM receipts WHERE business_id = ? ORDER BY sequence_number DESC')
      .all(business.id)
      .map(mapReceiptRow);

    const creditSales = db
      .prepare('SELECT * FROM credit_sales WHERE business_id = ? ORDER BY entry_date DESC, created_at DESC')
      .all(business.id)
      .map(mapCreditSaleRow);

    const debtors = groupDebtsByCustomer({
      todayDateLagos: todayLagos,
      receipts,
      creditSales,
    });

    const recentDebtPayments = receipts
      .filter((r) => r.receiptKind === 'BALANCE_PAYMENT' && r.status !== 'VOID')
      .slice(0, 20);

    res.json({
      debtors,
      totalOwedKobo: debtors.reduce((s, d) => s + d.totalOwedKobo, 0),
      recentDebtPayments,
    });
  });

  // Record payment on either a part-paid receipt OR a credit sale -> issues linked receipt + reduces debt atomically
  const handleRecordDebtPayment = (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const parsed = RecordDebtPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid debt payment' });
      return;
    }
    const input = parsed.data;
    const issuedDateLagos = input.issuedDateLagos || getLagosDateString();

    if (input.debtKind === 'RECEIPT') {
      try {
        const result = executeReceiveReceiptBalance({
          business,
          userId: req.user!.id,
          parentId: input.debtId,
          amountKobo: input.amountKobo,
          paymentMethod: input.paymentMethod,
          note: input.note,
          soldBy: input.soldBy,
          issuedDateLagos,
          template: input.template,
        });
        if ('error' in result) {
          res.status(result.status ?? 400).json({ error: result.error });
          return;
        }
        res.status(201).json(result);
      } catch (err) {
        logError('record_debt_payment_receipt', err, { userId: req.user!.id });
        res.status(500).json({ error: 'Unable to record debt payment' });
      }
      return;
    }

    if (isDayClosed(business.id, issuedDateLagos)) {
      res.status(409).json({
        error: `Day ${issuedDateLagos} is closed. Record payment on today's date instead.`,
        code: 'CLOSED_DAY',
      });
      return;
    }

    const issuedAt = new Date().toISOString();
    try {
      const result = runTransaction(() => {
        const csRow = db
          .prepare('SELECT * FROM credit_sales WHERE id = ? AND business_id = ?')
          .get(input.debtId, business.id) as any;

        if (!csRow) return { error: 'Credit sale not found', status: 404 as const };
        if (csRow.status === 'VOID') return { error: 'Credit sale is voided', status: 400 as const };
        const currentBal = Number(csRow.balance_due_kobo);
        if (currentBal <= 0) return { error: 'Credit sale is already settled', status: 400 as const };
        if (input.amountKobo > currentBal) {
          return { error: 'Payment amount exceeds remaining balance owed', status: 400 as const };
        }

        const bizRow = db
          .prepare('SELECT next_sequence, receipt_prefix FROM businesses WHERE id = ? AND owner_id = ?')
          .get(business.id, req.user!.id) as { next_sequence: number; receipt_prefix: string };

        const seq = Number(bizRow.next_sequence);
        const receiptNumber = formatReceiptNumber(bizRow.receipt_prefix, seq);
        const receiptId = crypto.randomUUID();
        const publicId = crypto.randomBytes(16).toString('base64url');
        const template = input.template || business.defaultTemplate;

        const newPaid = Number(csRow.amount_paid_kobo) + input.amountKobo;
        const newBalance = Math.max(0, Number(csRow.total_kobo) - newPaid);
        const newStatus = newBalance === 0 ? 'PAID' : 'PART_PAID';

        const paymentItem: ReceiptLineItem[] = [
          {
            description: csRow.item_note
              ? `Credit payment: ${csRow.item_note}`
              : `Credit balance payment (${csRow.entry_date})`,
            qty: 1,
            unitPriceKobo: input.amountKobo,
            discountKobo: 0,
            grossKobo: input.amountKobo,
            lineTotalKobo: input.amountKobo,
          },
        ];
        const itemsJson = JSON.stringify(paymentItem);

        db.prepare('UPDATE businesses SET next_sequence = next_sequence + 1, updated_at = ? WHERE id = ?').run(
          issuedAt,
          business.id
        );

        db.prepare(
          `INSERT INTO receipts (
            id, business_id, public_id, sequence_number, receipt_number, receipt_kind,
            customer_name, customer_phone, items_json, subtotal_kobo, discount_total_kobo,
            vat_enabled, vat_mode, vat_rate_bps, vat_kobo, total_kobo,
            initial_paid_kobo, amount_paid_kobo, balance_due_kobo, payment_method,
            note, sold_by, source, template, status, issued_date_lagos, issued_at, created_by
          ) VALUES (?, ?, ?, ?, ?, 'BALANCE_PAYMENT', ?, ?, ?, ?, 0, 0, 'exclusive', 0, 0, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, 'PAID', ?, ?, ?)`
        ).run(
          receiptId,
          business.id,
          publicId,
          seq,
          receiptNumber,
          csRow.customer_name,
          csRow.customer_phone,
          itemsJson,
          input.amountKobo,
          input.amountKobo,
          input.amountKobo,
          input.amountKobo,
          newBalance,
          input.paymentMethod,
          input.note || `Credit balance payment (${newBalance === 0 ? 'Settled' : `${formatKobo(newBalance, business.currency)} remaining`})`,
          input.soldBy || csRow.sold_by || '',
          template,
          issuedDateLagos,
          issuedAt,
          req.user!.id
        );

        db.prepare(
          'UPDATE credit_sales SET amount_paid_kobo = ?, balance_due_kobo = ?, status = ?, receipt_id = COALESCE(receipt_id, ?) WHERE id = ?'
        ).run(newPaid, newBalance, newStatus, receiptId, csRow.id);

        db.prepare(
          `INSERT INTO public_receipts (
            public_id, receipt_id, receipt_number, receipt_kind, business_name,
            business_logo_data_url, business_address, business_phone, business_email,
            brand_color, currency, customer_name, customer_phone, items_json,
            subtotal_kobo, discount_total_kobo, vat_enabled, vat_mode, vat_rate_bps,
            vat_kobo, total_kobo, amount_paid_kobo, balance_due_kobo, payment_method,
            note, sold_by, template, status, issued_date_lagos, issued_at
          ) VALUES (?, ?, ?, 'BALANCE_PAYMENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'exclusive', 0, 0, ?, ?, ?, ?, ?, ?, ?, 'PAID', ?, ?)`
        ).run(
          publicId,
          receiptId,
          receiptNumber,
          business.name,
          business.logoDataUrl,
          business.address,
          business.phone,
          business.email,
          business.brandColor,
          business.currency,
          csRow.customer_name,
          csRow.customer_phone,
          itemsJson,
          input.amountKobo,
          input.amountKobo,
          input.amountKobo,
          newBalance,
          input.paymentMethod,
          input.note || `Payment on credit sale (${csRow.entry_date})`,
          input.soldBy || csRow.sold_by || '',
          template,
          issuedDateLagos,
          issuedAt
        );

        db.prepare(
          `INSERT INTO ledger_entries (
            id, business_id, entry_type, entry_kind, amount_kobo, cash_received_kobo,
            payment_method, receipt_id, credit_sale_id, customer_name, customer_phone,
            note, sold_by, source, entry_date, created_at, created_by
          ) VALUES (?, ?, 'PAYMENT_RECEIVED', 'DEBT_PAYMENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          business.id,
          input.amountKobo,
          input.amountKobo,
          input.paymentMethod,
          receiptId,
          csRow.id,
          csRow.customer_name,
          csRow.customer_phone,
          input.note || `Debt payment from ${csRow.customer_name}`,
          input.soldBy || csRow.sold_by || '',
          issuedDateLagos,
          issuedAt,
          req.user!.id
        );

        const receipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId);
        const creditSale = db.prepare('SELECT * FROM credit_sales WHERE id = ?').get(csRow.id);
        return {
          receipt: mapReceiptRow(receipt),
          creditSale: mapCreditSaleRow(creditSale),
        };
      });

      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.status(201).json(result);
    } catch (err) {
      logError('record_debt_payment_credit', err, { userId: req.user!.id });
      res.status(500).json({ error: 'Unable to record debt payment' });
    }
  };

  router.post('/debts/record-payment', requireAuth, handleRecordDebtPayment);
  router.post('/rpc/record_credit_payment', requireAuth, handleRecordDebtPayment);

  // Creditors (what business owes suppliers)
  router.get('/creditors', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const rows = db
      .prepare('SELECT * FROM creditors WHERE business_id = ? ORDER BY status ASC, due_date ASC, created_at DESC')
      .all(business.id);
    res.json({ creditors: rows.map(mapCreditorRow) });
  });

  router.post('/creditors', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const parsed = CreditorInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid creditor details' });
      return;
    }
    const input = parsed.data;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO creditors (
        id, business_id, supplier_name, phone, description, amount_kobo, due_date, status, created_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'UNPAID', ?, ?)`
    ).run(
      id,
      business.id,
      input.supplierName,
      input.phone,
      input.description,
      input.amountKobo,
      input.dueDate || null,
      now,
      req.user!.id
    );
    const row = db.prepare('SELECT * FROM creditors WHERE id = ?').get(id);
    res.status(201).json({ creditor: mapCreditorRow(row) });
  });

  router.post('/creditors/:id/mark-paid', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const parsed = MarkCreditorPaidSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payment info' });
      return;
    }
    const input = parsed.data;
    const entryDate = input.entryDate || getLagosDateString();
    if (input.recordAsExpense && isDayClosed(business.id, entryDate)) {
      res.status(409).json({
        error: `Day ${entryDate} is closed. Choose today's date or uncheck expense recording.`,
        code: 'CLOSED_DAY',
      });
      return;
    }

    const creditorId = String(req.params.id || '');
    const now = new Date().toISOString();
    try {
      const result = runTransaction(() => {
        const row = db
          .prepare('SELECT * FROM creditors WHERE id = ? AND business_id = ?')
          .get(creditorId, business.id) as any;
        if (!row) return { error: 'Creditor not found', status: 404 as const };
        if (row.status === 'PAID') return { error: 'Already marked as paid', status: 400 as const };

        let expenseId: string | null = null;
        if (input.recordAsExpense) {
          expenseId = crypto.randomUUID();
          const ledgerId = crypto.randomUUID();
          const note = input.note || `Supplier payment: ${row.supplier_name}${row.description ? ` (${row.description})` : ''}`;

          db.prepare(
            `INSERT INTO expenses (
              id, business_id, entry_date, amount_kobo, category, payee,
              payment_method, note, source, ledger_entry_id, created_at, updated_at, created_by
            ) VALUES (?, ?, ?, ?, 'Stock', ?, ?, ?, 'manual', ?, ?, ?, ?)`
          ).run(
            expenseId,
            business.id,
            entryDate,
            Number(row.amount_kobo),
            row.supplier_name,
            input.paymentMethod,
            note,
            ledgerId,
            now,
            now,
            req.user!.id
          );

          db.prepare(
            `INSERT INTO ledger_entries (
              id, business_id, entry_type, entry_kind, amount_kobo, cash_received_kobo,
              payment_method, expense_id, customer_name, note, source,
              entry_date, created_at, created_by
            ) VALUES (?, ?, 'EXPENSE', 'EXPENSE', ?, 0, ?, ?, ?, ?, 'manual', ?, ?, ?)`
          ).run(
            ledgerId,
            business.id,
            Number(row.amount_kobo),
            input.paymentMethod,
            expenseId,
            row.supplier_name,
            note,
            entryDate,
            now,
            req.user!.id
          );
        }

        db.prepare(
          'UPDATE creditors SET status = \'PAID\', paid_at = ?, paid_method = ?, expense_id = ? WHERE id = ?'
        ).run(now, input.paymentMethod, expenseId, creditorId);

        const updated = db.prepare('SELECT * FROM creditors WHERE id = ?').get(creditorId);
        return { creditor: mapCreditorRow(updated) };
      });
      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (err) {
      logError('mark_creditor_paid', err, { userId: req.user!.id, creditorId });
      res.status(500).json({ error: 'Unable to mark creditor paid' });
    }
  });

  router.delete('/creditors/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const id = String(req.params.id || '');
    const info = db
      .prepare('DELETE FROM creditors WHERE id = ? AND business_id = ?')
      .run(id, business.id);
    if (!info.changes) {
      res.status(404).json({ error: 'Creditor not found' });
      return;
    }
    res.json({ ok: true });
  });

  // ============ PHASE 2: EXPENSES & PRIVATE PROOF STORAGE ============

  // Upload expense proof photo -> stored privately per-owner in data/expense-proofs/<userId>/
  router.post('/expenses/proof', requireAuth, (req: AuthenticatedRequest, res) => {
    const dataUrl = typeof req.body?.dataUrl === 'string' ? req.body.dataUrl : '';
    const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) {
      res.status(400).json({ error: 'Upload a valid PNG, JPG, or WEBP image.' });
      return;
    }
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buf = Buffer.from(match[2], 'base64');
    if (buf.length > 1_500_000) {
      res.status(400).json({ error: 'Proof photo must be under 1.5 MB.' });
      return;
    }
    const userDir = path.join(EXPENSE_PROOFS_DIR, req.user!.id);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    const fileName = `${crypto.randomUUID()}.${ext}`;
    fs.writeFileSync(path.join(userDir, fileName), buf);
    const proofPath = `${req.user!.id}/${fileName}`;
    res.status(201).json({
      proofPath,
      proofUrl: `/api/expenses/proof/${encodeURIComponent(proofPath)}`,
    });
  });

  // Serve private expense proof ONLY to its authenticated owner
  router.get('/expenses/proof/:filePath', requireAuth, (req: AuthenticatedRequest, res) => {
    const raw = decodeURIComponent(String(req.params.filePath || ''));
    const parts = raw.split('/');
    if (parts.length !== 2 || parts[0] !== req.user!.id || !/^[a-f0-9-]+\.(png|jpg|webp)$/i.test(parts[1])) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const fullPath = path.join(EXPENSE_PROOFS_DIR, parts[0], parts[1]);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Proof image not found' });
      return;
    }
    res.sendFile(fullPath);
  });

  router.get('/expenses', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const paymentMethod = typeof req.query.paymentMethod === 'string' ? req.query.paymentMethod.trim() : '';
    const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom.trim() : '';
    const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo.trim() : '';

    const conditions = ['business_id = ?', 'is_deleted = 0'];
    const params: any[] = [business.id];

    if (category && category !== 'ALL') {
      conditions.push('LOWER(category) = LOWER(?)');
      params.push(category);
    }
    if (paymentMethod && paymentMethod !== 'ALL') {
      conditions.push('payment_method = ?');
      params.push(paymentMethod);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
      conditions.push('entry_date >= ?');
      params.push(dateFrom);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      conditions.push('entry_date <= ?');
      params.push(dateTo);
    }
    if (q) {
      conditions.push('(LOWER(category) LIKE ? OR LOWER(payee) LIKE ? OR LOWER(note) LIKE ?)');
      const pat = `%${q}%`;
      params.push(pat, pat, pat);
    }

    const rows = db
      .prepare(`SELECT * FROM expenses WHERE ${conditions.join(' AND ')} ORDER BY entry_date DESC, created_at DESC LIMIT 300`)
      .all(...params);
    const closedDates = new Set(getAllClosures(business.id).map((c) => c.closeDate));
    const expenses = rows.map(mapExpenseRow).map((e) => ({
      ...e,
      isClosedDay: closedDates.has(e.entryDate),
    }));
    res.json({ expenses });
  });

  router.get('/expenses/:id/revisions', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const id = String(req.params.id || '');
    const rows = db
      .prepare('SELECT * FROM expense_revisions WHERE expense_id = ? AND business_id = ? ORDER BY changed_at DESC')
      .all(id, business.id);
    const revisions: ExpenseRevisionRecord[] = rows.map((r: any) => ({
      id: r.id,
      expenseId: r.expense_id,
      businessId: r.business_id,
      action: r.action,
      previousJson: r.previous_json,
      nextJson: r.next_json || null,
      reason: r.reason || '',
      changedAt: r.changed_at,
      changedBy: r.changed_by,
    }));
    res.json({ revisions });
  });

  router.post('/expenses', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const parsed = ExpenseInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid expense' });
      return;
    }
    const input = parsed.data;
    const entryDate = input.entryDate || getLagosDateString();
    if (isDayClosed(business.id, entryDate)) {
      res.status(409).json({
        error: `Day ${entryDate} is closed. Post a visible correction entry instead.`,
        code: 'CLOSED_DAY',
      });
      return;
    }

    const now = new Date().toISOString();
    const expenseId = crypto.randomUUID();
    const ledgerId = crypto.randomUUID();
    let proofPath: string | null = null;
    if (input.proofPath) {
      const parts = input.proofPath.split('/');
      if (
        parts.length !== 2 ||
        parts[0] !== req.user!.id ||
        !/^[a-f0-9-]+\.(png|jpg|webp)$/i.test(parts[1])
      ) {
        res.status(403).json({ error: 'Forbidden proof path' });
        return;
      }
      proofPath = input.proofPath;
    }

    try {
      const expense = runTransaction(() => {
        db.prepare(
          `INSERT INTO expenses (
            id, business_id, entry_date, amount_kobo, category, payee,
            payment_method, note, proof_path, source, ledger_entry_id,
            created_at, updated_at, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          expenseId,
          business.id,
          entryDate,
          input.amountKobo,
          input.category,
          input.payee,
          input.paymentMethod,
          input.note,
          proofPath,
          input.source,
          ledgerId,
          now,
          now,
          req.user!.id
        );

        db.prepare(
          `INSERT INTO ledger_entries (
            id, business_id, entry_type, entry_kind, amount_kobo, cash_received_kobo,
            payment_method, expense_id, customer_name, note, source,
            entry_date, created_at, created_by
          ) VALUES (?, ?, 'EXPENSE', 'EXPENSE', ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          ledgerId,
          business.id,
          input.amountKobo,
          input.paymentMethod,
          expenseId,
          input.payee,
          `${input.category}${input.payee ? ` · ${input.payee}` : ''}${input.note ? ` — ${input.note}` : ''}`,
          input.source,
          entryDate,
          now,
          req.user!.id
        );

        const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(expenseId);
        return mapExpenseRow(row);
      });

      res.status(201).json({ expense });
    } catch (err) {
      logError('create_expense', err, { userId: req.user!.id });
      res.status(500).json({ error: 'Unable to record expense' });
    }
  });

  router.patch('/expenses/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const id = String(req.params.id || '');
    const existingRow = db
      .prepare('SELECT * FROM expenses WHERE id = ? AND business_id = ? AND is_deleted = 0')
      .get(id, business.id) as any;
    if (!existingRow) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }

    if (isDayClosed(business.id, existingRow.entry_date)) {
      res.status(409).json({
        error: `Day ${existingRow.entry_date} is closed. Editing is locked — post a visible correction entry instead.`,
        code: 'CLOSED_DAY',
        closedDate: existingRow.entry_date,
      });
      return;
    }

    const merged = {
      entryDate: req.body.entryDate ?? existingRow.entry_date,
      amountKobo: req.body.amountKobo ?? Number(existingRow.amount_kobo),
      category: req.body.category ?? existingRow.category,
      payee: req.body.payee ?? existingRow.payee,
      paymentMethod: req.body.paymentMethod ?? existingRow.payment_method,
      note: req.body.note ?? existingRow.note,
      proofPath: req.body.proofPath !== undefined ? req.body.proofPath : existingRow.proof_path,
      source: req.body.source ?? existingRow.source,
    };
    const parsed = ExpenseInputSchema.safeParse(merged);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid expense update' });
      return;
    }
    const input = parsed.data;
    const targetDate = input.entryDate || existingRow.entry_date;
    if (isDayClosed(business.id, targetDate)) {
      res.status(409).json({
        error: `Target day ${targetDate} is closed.`,
        code: 'CLOSED_DAY',
        closedDate: targetDate,
      });
      return;
    }

    const now = new Date().toISOString();
    let proofPath: string | null = null;
    if (input.proofPath) {
      const parts = input.proofPath.split('/');
      if (
        parts.length !== 2 ||
        parts[0] !== req.user!.id ||
        !/^[a-f0-9-]+\.(png|jpg|webp)$/i.test(parts[1])
      ) {
        res.status(403).json({ error: 'Forbidden proof path' });
        return;
      }
      proofPath = input.proofPath;
    }

    try {
      const updated = runTransaction(() => {
        const prevSnap = mapExpenseRow(existingRow);
        db.prepare(
          `UPDATE expenses
           SET entry_date = ?, amount_kobo = ?, category = ?, payee = ?,
               payment_method = ?, note = ?, proof_path = ?, updated_at = ?
           WHERE id = ? AND business_id = ?`
        ).run(
          targetDate,
          input.amountKobo,
          input.category,
          input.payee,
          input.paymentMethod,
          input.note,
          proofPath,
          now,
          id,
          business.id
        );

        if (existingRow.ledger_entry_id) {
          db.prepare(
            `UPDATE ledger_entries
             SET entry_date = ?, amount_kobo = ?, payment_method = ?, customer_name = ?, note = ?
             WHERE id = ? AND business_id = ?`
          ).run(
            targetDate,
            input.amountKobo,
            input.paymentMethod,
            input.payee,
            `${input.category}${input.payee ? ` · ${input.payee}` : ''}${input.note ? ` — ${input.note}` : ''}`,
            existingRow.ledger_entry_id,
            business.id
          );
        }

        const nextRow = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
        const nextSnap = mapExpenseRow(nextRow);

        db.prepare(
          `INSERT INTO expense_revisions (id, expense_id, business_id, action, previous_json, next_json, reason, changed_at, changed_by)
           VALUES (?, ?, ?, 'EDIT', ?, ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          id,
          business.id,
          JSON.stringify(prevSnap),
          JSON.stringify(nextSnap),
          typeof req.body.reason === 'string' ? req.body.reason.trim() : 'Edited expense',
          now,
          req.user!.id
        );

        return nextSnap;
      });
      res.json({ expense: updated });
    } catch (err) {
      logError('update_expense', err, { userId: req.user!.id, id });
      res.status(500).json({ error: 'Unable to update expense' });
    }
  });

  router.delete('/expenses/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const id = String(req.params.id || '');
    const existingRow = db
      .prepare('SELECT * FROM expenses WHERE id = ? AND business_id = ? AND is_deleted = 0')
      .get(id, business.id) as any;
    if (!existingRow) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }

    if (isDayClosed(business.id, existingRow.entry_date)) {
      res.status(409).json({
        error: `Day ${existingRow.entry_date} is closed. Expenses on a closed day cannot be deleted — post a visible correction entry instead.`,
        code: 'CLOSED_DAY',
        closedDate: existingRow.entry_date,
      });
      return;
    }

    const now = new Date().toISOString();
    try {
      runTransaction(() => {
        const prevSnap = mapExpenseRow(existingRow);
        db.prepare('UPDATE expenses SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ?').run(
          now,
          now,
          id
        );
        if (existingRow.ledger_entry_id) {
          db.prepare('DELETE FROM ledger_entries WHERE id = ? AND business_id = ?').run(
            existingRow.ledger_entry_id,
            business.id
          );
        }
        db.prepare(
          `INSERT INTO expense_revisions (id, expense_id, business_id, action, previous_json, next_json, reason, changed_at, changed_by)
           VALUES (?, ?, ?, 'DELETE', ?, NULL, 'Deleted expense', ?, ?)`
        ).run(crypto.randomUUID(), id, business.id, JSON.stringify(prevSnap), now, req.user!.id);
      });
      res.json({ ok: true });
    } catch (err) {
      logError('delete_expense', err, { userId: req.user!.id, id });
      res.status(500).json({ error: 'Unable to delete expense' });
    }
  });

  // ============ PHASE 2: DAILY CASH BOOK, CLOSE DAY & CORRECTIONS ============

  router.get('/cashbook', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const todayLagos = getLagosDateString();
    const rawDate = typeof req.query.date === 'string' ? req.query.date.trim() : todayLagos;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : todayLagos;

    const allEntries = getAllLedgerEntries(business.id);
    const closures = getAllClosures(business.id);

    const dayView = buildCashBookDayView({
      date,
      businessOpeningCashKobo: business.openingCashKobo,
      allEntries,
      closures,
    });

    const yesterdayLagos = shiftLagosDate(todayLagos, -1);
    const yesterdayClosed = closures.some((c) => c.closeDate === yesterdayLagos);
    const yesterdayHasActivity = allEntries.some((e) => e.entryDate === yesterdayLagos);

    res.json({
      dayView,
      closures: closures.slice(0, 30),
      todayDateLagos: todayLagos,
      yesterdayDateLagos: yesterdayLagos,
      yesterdayClosed,
      yesterdayHasActivity,
    });
  });

  router.post('/cashbook/close', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const parsed = CloseDaySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid close-day submission' });
      return;
    }
    const input = parsed.data;
    if (isDayClosed(business.id, input.closeDate)) {
      res.status(409).json({ error: `Day ${input.closeDate} is already closed.` });
      return;
    }

    const now = new Date().toISOString();
    try {
      const result = runTransaction(() => {
        const allEntries = getAllLedgerEntries(business.id);
        const closures = getAllClosures(business.id);
        const dayView = buildCashBookDayView({
          date: input.closeDate,
          businessOpeningCashKobo: business.openingCashKobo,
          allEntries,
          closures,
        });

        const expectedCashKobo = dayView.closingCashInHandKobo;
        const varianceKobo = calculateCloseDayVariance(expectedCashKobo, input.countedCashKobo);
        const totalSalesKobo =
          dayView.receiptSalesKobo + dayView.quickSalesKobo + dayView.creditSalesGivenKobo;

        const closureId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO day_closures (
            id, business_id, close_date, opening_cash_kobo, expected_cash_kobo,
            counted_cash_kobo, variance_kobo, total_sales_kobo, quick_sales_kobo,
            receipt_sales_kobo, credit_sales_kobo, payments_received_kobo,
            expenses_kobo, net_kobo, note, closed_at, closed_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          closureId,
          business.id,
          input.closeDate,
          dayView.openingCashKobo,
          expectedCashKobo,
          input.countedCashKobo,
          varianceKobo,
          totalSalesKobo,
          dayView.quickSalesKobo,
          dayView.receiptSalesKobo,
          dayView.creditSalesGivenKobo,
          dayView.paymentsReceivedKobo,
          dayView.moneyOutTotalKobo,
          dayView.netKobo,
          input.note,
          now,
          req.user!.id
        );

        const closureRow = db.prepare('SELECT * FROM day_closures WHERE id = ?').get(closureId);
        const closure = mapClosureRow(closureRow);
        return {
          closure,
          dayView: {
            ...dayView,
            isClosed: true,
            closure,
          },
        };
      });

      res.status(201).json(result);
    } catch (err) {
      logError('close_day', err, { userId: req.user!.id });
      res.status(500).json({ error: 'Unable to close day' });
    }
  });

  // Visible correction entry (especially for closed days)
  router.post('/cashbook/correction', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const parsed = CorrectionEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid correction entry' });
      return;
    }
    const input = parsed.data;
    const now = new Date().toISOString();
    const signedCash = input.direction === 'IN' ? input.amountKobo : -input.amountKobo;
    const id = crypto.randomUUID();

    try {
      const entry = runTransaction(() => {
        db.prepare(
          `INSERT INTO ledger_entries (
            id, business_id, entry_type, entry_kind, amount_kobo, cash_received_kobo,
            payment_method, expense_id, note, sold_by, source,
            is_correction, correction_reason, entry_date, created_at, created_by
          ) VALUES (?, ?, 'ADJUSTMENT', 'CORRECTION', ?, ?, ?, ?, ?, ?, 'manual', 1, ?, ?, ?, ?)`
        ).run(
          id,
          business.id,
          signedCash,
          signedCash,
          input.paymentMethod,
          input.expenseId || null,
          `Correction (${input.direction === 'IN' ? '+' : '−'}): ${input.reason}`,
          input.soldBy,
          input.reason,
          input.entryDate,
          now,
          req.user!.id
        );

        if (input.expenseId) {
          const expRow = db
            .prepare('SELECT * FROM expenses WHERE id = ? AND business_id = ?')
            .get(input.expenseId, business.id);
          if (expRow) {
            db.prepare(
              `INSERT INTO expense_revisions (id, expense_id, business_id, action, previous_json, next_json, reason, changed_at, changed_by)
               VALUES (?, ?, ?, 'CORRECTION', ?, ?, ?, ?, ?)`
            ).run(
              crypto.randomUUID(),
              input.expenseId,
              business.id,
              JSON.stringify(mapExpenseRow(expRow)),
              JSON.stringify({ direction: input.direction, amountKobo: input.amountKobo, paymentMethod: input.paymentMethod }),
              input.reason,
              now,
              req.user!.id
            );
          }
        }

        const row = db.prepare('SELECT * FROM ledger_entries WHERE id = ?').get(id);
        return mapLedgerRow(row);
      });
      res.status(201).json({ entry });
    } catch (err) {
      logError('correction_entry', err, { userId: req.user!.id });
      res.status(500).json({ error: 'Unable to post correction entry' });
    }
  });

  // ============ PHASE 2: REPORTS & CSV EXPORTS ============

  function buildReportsData(business: BusinessProfile, dateFrom: string, dateTo: string): ReportsSummary {
    const ledgerRows = db
      .prepare(
        `SELECT l.*, r.receipt_number
         FROM ledger_entries l
         LEFT JOIN receipts r ON r.id = l.receipt_id
         WHERE l.business_id = ? AND l.entry_date >= ? AND l.entry_date <= ?
         ORDER BY l.entry_date ASC, l.created_at ASC`
      )
      .all(business.id, dateFrom, dateTo)
      .map(mapLedgerRow);

    const expenseRows = db
      .prepare(
        `SELECT * FROM expenses
         WHERE business_id = ? AND is_deleted = 0 AND entry_date >= ? AND entry_date <= ?`
      )
      .all(business.id, dateFrom, dateTo)
      .map(mapExpenseRow);

    let receiptSalesKobo = 0;
    let quickSalesKobo = 0;
    let creditSalesGivenKobo = 0;
    let paymentsReceivedKobo = 0;
    let moneyInTotalKobo = 0;
    let expensesTotalKobo = 0;

    const methodMap = new Map<string, { inKobo: number; outKobo: number }>();
    const soldByMap = new Map<string, { salesKobo: number; count: number }>();
    const customerMap = new Map<string, { totalKobo: number; count: number }>();
    const dailyMap = new Map<string, { moneyInKobo: number; expensesKobo: number }>();

    for (const entry of ledgerRows) {
      const { moneyInKobo, moneyOutKobo } = getEntrySignedFlow(entry);
      const method = entry.paymentMethod || 'Cash';

      moneyInTotalKobo += moneyInKobo;
      expensesTotalKobo += moneyOutKobo;

      const m = methodMap.get(method) || { inKobo: 0, outKobo: 0 };
      m.inKobo += moneyInKobo;
      m.outKobo += moneyOutKobo;
      methodMap.set(method, m);

      const d = dailyMap.get(entry.entryDate) || { moneyInKobo: 0, expensesKobo: 0 };
      d.moneyInKobo += moneyInKobo;
      d.expensesKobo += moneyOutKobo;
      dailyMap.set(entry.entryDate, d);

      if (entry.entryType === 'SALE') {
        if (entry.entryKind === 'QUICK_SALE') {
          quickSalesKobo += entry.amountKobo;
        } else if (entry.entryKind === 'CREDIT_SALE') {
          creditSalesGivenKobo += entry.amountKobo;
        } else {
          receiptSalesKobo += entry.amountKobo;
        }

        const seller = entry.soldBy.trim() || 'Owner / Unassigned';
        const sb = soldByMap.get(seller) || { salesKobo: 0, count: 0 };
        sb.salesKobo += entry.amountKobo;
        sb.count += 1;
        soldByMap.set(seller, sb);

        if (entry.customerName.trim()) {
          const cn = entry.customerName.trim();
          const cm = customerMap.get(cn) || { totalKobo: 0, count: 0 };
          cm.totalKobo += entry.amountKobo;
          cm.count += 1;
          customerMap.set(cn, cm);
        }
      } else if (entry.entryType === 'PAYMENT_RECEIVED') {
        paymentsReceivedKobo += entry.cashReceivedKobo;
      } else if (entry.entryType === 'ADJUSTMENT' && entry.entryKind === 'VOID_REVERSAL') {
        receiptSalesKobo += entry.amountKobo;
      }
    }

    const catMap = new Map<string, { totalKobo: number; count: number }>();
    for (const exp of expenseRows) {
      const c = catMap.get(exp.category) || { totalKobo: 0, count: 0 };
      c.totalKobo += exp.amountKobo;
      c.count += 1;
      catMap.set(exp.category, c);
    }

    // Current outstanding debts across business
    const openReceiptsBal = db
      .prepare(
        `SELECT COALESCE(SUM(balance_due_kobo), 0) AS bal
         FROM receipts WHERE business_id = ? AND receipt_kind = 'SALE' AND status = 'PART_PAID'`
      )
      .get(business.id) as { bal: number };
    const openCreditBal = db
      .prepare(
        `SELECT COALESCE(SUM(balance_due_kobo), 0) AS bal
         FROM credit_sales WHERE business_id = ? AND status IN ('UNPAID', 'PART_PAID')`
      )
      .get(business.id) as { bal: number };

    return {
      dateFrom,
      dateTo,
      salesTotalKobo: receiptSalesKobo + quickSalesKobo + creditSalesGivenKobo,
      receiptSalesKobo,
      quickSalesKobo,
      creditSalesGivenKobo,
      paymentsReceivedKobo,
      moneyInTotalKobo,
      expensesTotalKobo,
      netMoneyInMinusOutKobo: moneyInTotalKobo - expensesTotalKobo,
      outstandingDebtsKobo: Number(openReceiptsBal.bal || 0) + Number(openCreditBal.bal || 0),
      byPaymentMethod: Array.from(methodMap.entries()).map(([method, v]) => ({
        method,
        inKobo: v.inKobo,
        outKobo: v.outKobo,
        netKobo: v.inKobo - v.outKobo,
      })),
      byExpenseCategory: Array.from(catMap.entries())
        .map(([category, v]) => ({ category, totalKobo: v.totalKobo, count: v.count }))
        .sort((a, b) => b.totalKobo - a.totalKobo),
      bySoldBy: Array.from(soldByMap.entries())
        .map(([soldBy, v]) => ({ soldBy, salesKobo: v.salesKobo, count: v.count }))
        .sort((a, b) => b.salesKobo - a.salesKobo),
      topCustomers: Array.from(customerMap.entries())
        .map(([customerName, v]) => ({ customerName, totalKobo: v.totalKobo, count: v.count }))
        .sort((a, b) => b.totalKobo - a.totalKobo)
        .slice(0, 10),
      dailySeries: Array.from(dailyMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, v]) => ({ date, moneyInKobo: v.moneyInKobo, expensesKobo: v.expensesKobo })),
    };
  }

  router.get('/reports', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const today = getLagosDateString();
    const dateFrom =
      typeof req.query.dateFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.dateFrom)
        ? req.query.dateFrom
        : `${today.slice(0, 7)}-01`;
    const dateTo =
      typeof req.query.dateTo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.dateTo)
        ? req.query.dateTo
        : today;

    const report = buildReportsData(business, dateFrom, dateTo);
    res.json({ report });
  });

  router.get('/reports/csv', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    const today = getLagosDateString();
    const type = String(req.query.type || 'ledger');
    const dateFrom =
      typeof req.query.dateFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.dateFrom)
        ? req.query.dateFrom
        : '2000-01-01';
    const dateTo =
      typeof req.query.dateTo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.dateTo)
        ? req.query.dateTo
        : today;

    let csv = '';
    if (type === 'receipts') {
      const rows = db
        .prepare(
          'SELECT * FROM receipts WHERE business_id = ? AND issued_date_lagos >= ? AND issued_date_lagos <= ? ORDER BY sequence_number ASC'
        )
        .all(business.id, dateFrom, dateTo)
        .map(mapReceiptRow);
      csv = buildCsv(
        ['Date', 'Receipt #', 'Kind', 'Customer', 'Phone', 'Total', 'Paid', 'Balance Due', 'Method', 'Sold By', 'Status'],
        rows.map((r) => [
          r.issuedDateLagos,
          r.receiptNumber,
          r.receiptKind,
          r.customerName || 'Walk-in',
          r.customerPhone,
          formatKobo(r.totalKobo, business.currency),
          formatKobo(r.amountPaidKobo, business.currency),
          formatKobo(r.balanceDueKobo, business.currency),
          r.paymentMethod,
          r.soldBy,
          r.status,
        ])
      );
    } else if (type === 'expenses') {
      const rows = db
        .prepare(
          'SELECT * FROM expenses WHERE business_id = ? AND is_deleted = 0 AND entry_date >= ? AND entry_date <= ? ORDER BY entry_date ASC, created_at ASC'
        )
        .all(business.id, dateFrom, dateTo)
        .map(mapExpenseRow);
      csv = buildCsv(
        ['Date', 'Category', 'Payee', 'Amount', 'Method', 'Note'],
        rows.map((e) => [
          e.entryDate,
          e.category,
          e.payee,
          formatKobo(e.amountKobo, business.currency),
          e.paymentMethod,
          e.note,
        ])
      );
    } else if (type === 'debtors') {
      const receipts = db
        .prepare('SELECT * FROM receipts WHERE business_id = ?')
        .all(business.id)
        .map(mapReceiptRow);
      const creditSales = db
        .prepare('SELECT * FROM credit_sales WHERE business_id = ?')
        .all(business.id)
        .map(mapCreditSaleRow);
      const groups = groupDebtsByCustomer({ todayDateLagos: today, receipts, creditSales });
      csv = buildCsv(
        ['Customer', 'Phone', 'Total Owed', 'Oldest Debt Date', 'Age (Days)', 'Open Items'],
        groups.map((g) => [
          g.customerName,
          g.customerPhone,
          formatKobo(g.totalOwedKobo, business.currency),
          g.oldestDebtDate,
          g.oldestDebtAgeDays,
          g.openCount,
        ])
      );
    } else {
      const rows = db
        .prepare(
          `SELECT l.*, r.receipt_number
           FROM ledger_entries l
           LEFT JOIN receipts r ON r.id = l.receipt_id
           WHERE l.business_id = ? AND l.entry_date >= ? AND l.entry_date <= ?
           ORDER BY l.entry_date ASC, l.created_at ASC`
        )
        .all(business.id, dateFrom, dateTo)
        .map(mapLedgerRow);
      csv = buildCsv(
        ['Date', 'Type', 'Kind', 'Receipt #', 'Customer / Payee', 'Method', 'Money In', 'Money Out', 'Note', 'Sold By'],
        rows.map((e) => {
          const flow = getEntrySignedFlow(e);
          return [
            e.entryDate,
            e.entryType,
            e.entryKind,
            e.receiptNumber || '',
            e.customerName,
            e.paymentMethod || 'Cash',
            formatKobo(flow.moneyInKobo, business.currency),
            formatKobo(flow.moneyOutKobo, business.currency),
            e.note,
            e.soldBy,
          ];
        })
      );
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tallymark-${type}-${today}.csv"`);
    res.send(csv);
  });

  // Export all user data
  router.get('/account/export', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const business = getOwnedBusiness(user.id);
    if (!business) {
      res.json({
        exportedAt: new Date().toISOString(),
        user,
        business: null,
        receipts: [],
        ledgerEntries: [],
        creditSales: [],
        creditors: [],
        expenses: [],
        dayClosures: [],
      });
      return;
    }

    const customers = db
      .prepare('SELECT * FROM customers WHERE business_id = ? ORDER BY created_at ASC')
      .all(business.id);
    const catalogItems = db
      .prepare('SELECT * FROM catalog_items WHERE business_id = ? ORDER BY use_count DESC')
      .all(business.id);
    const receipts = db
      .prepare('SELECT * FROM receipts WHERE business_id = ? ORDER BY sequence_number ASC')
      .all(business.id)
      .map(mapReceiptRow);
    const ledgerEntries = getAllLedgerEntries(business.id);
    const creditSales = db
      .prepare('SELECT * FROM credit_sales WHERE business_id = ?')
      .all(business.id)
      .map(mapCreditSaleRow);
    const creditors = db
      .prepare('SELECT * FROM creditors WHERE business_id = ?')
      .all(business.id)
      .map(mapCreditorRow);
    const expenses = db
      .prepare('SELECT * FROM expenses WHERE business_id = ?')
      .all(business.id)
      .map(mapExpenseRow);
    const dayClosures = getAllClosures(business.id);
    const invoices = db
      .prepare('SELECT * FROM invoices WHERE business_id = ? ORDER BY created_at ASC')
      .all(business.id);
    const invoiceLines = db
      .prepare('SELECT * FROM invoice_lines WHERE business_id = ? ORDER BY invoice_id ASC, position ASC')
      .all(business.id);
    const quotes = db
      .prepare('SELECT * FROM quotes WHERE business_id = ? ORDER BY created_at ASC')
      .all(business.id);
    const quoteLines = db
      .prepare('SELECT * FROM quote_lines WHERE business_id = ? ORDER BY quote_id ASC, position ASC')
      .all(business.id);
    const payments = db
      .prepare('SELECT * FROM payments WHERE business_id = ? ORDER BY created_at ASC')
      .all(business.id);
    const debts = db
      .prepare('SELECT * FROM debts WHERE business_id = ? ORDER BY created_at ASC')
      .all(business.id);
    const paymentClaims = db
      .prepare(
        `SELECT id, business_id, invoice_id, claim_ref, payer_name, amount_kobo, reference,
                proof_path, proof_mime, proof_size_bytes, proof_deleted_at,
                status, decision_reason, decided_at, decided_by, payment_id, created_at
         FROM payment_claims WHERE business_id = ? ORDER BY created_at ASC`
      )
      .all(business.id);
    const paymentReminders = db
      .prepare('SELECT * FROM payment_reminders WHERE business_id = ? ORDER BY sent_at ASC')
      .all(business.id);
    const auditLog = db
      .prepare('SELECT * FROM audit_log WHERE business_id = ? ORDER BY created_at ASC')
      .all(business.id);
    const usageCounters = db
      .prepare('SELECT * FROM usage_counters WHERE business_id = ? ORDER BY month_key ASC')
      .all(business.id);
    const pushSubscriptions = db
      .prepare(
        `SELECT id, business_id, user_id, endpoint, user_agent, created_at, last_used_at
         FROM push_subscriptions WHERE business_id = ? ORDER BY created_at ASC`
      )
      .all(business.id);

    res.setHeader('Content-Disposition', `attachment; filename="tallymark-export-${getLagosDateString()}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      user,
      business,
      customers,
      catalogItems,
      receipts,
      ledgerEntries,
      creditSales,
      creditors,
      expenses,
      dayClosures,
      invoices,
      invoiceLines,
      quotes,
      quoteLines,
      payments,
      debts,
      paymentClaims,
      paymentReminders,
      auditLog,
      usageCounters,
      pushSubscriptions,
    });
  });

  // ============ PHASE 3: SPEAK YOUR DAY (GEMINI SERVER-SIDE + CONFIRM) ============

  const voiceParseRateLimitMax = Math.max(1, Number(process.env.VOICE_RATE_LIMIT_MAX || 12));
  const voiceParseLimiter = createPerUserRateLimiter(voiceParseRateLimitMax, 10 * 60 * 1000);

  // Parses transcript into editable PROPOSED entries only. Never writes to the database.
  router.post('/voice/parse', requireAnyAuth, voiceParseLimiter, async (req: AuthenticatedRequest, res) => {
    if (!req.isSupabaseUser) {
      const business = getOwnedBusiness(req.user!.id);
      if (!business) {
        res.status(404).json({ error: 'Complete business onboarding first' });
        return;
      }
    }

    const parsed = VoiceTranscriptRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid transcript' });
      return;
    }

    try {
      const todayLagos = getLagosDateString();
      // Sends ONLY the transcript string to Gemini — zero business or customer records.
      const drafted = await parseTranscriptWithGemini(parsed.data.transcript, todayLagos);
      res.json({
        entries: drafted.entries,
        summaryNote: drafted.summaryNote,
        model: 'gemini-4-hydrogen',
      });
    } catch (err) {
      if (err instanceof VoiceAiError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      logError('voice_parse', err, { userId: req.user!.id });
      res.status(500).json({ error: 'Unable to draft entries from speech right now' });
    }
  });

  // Saves user-confirmed voice draft entries atomically with source = 'voice'.
  router.post('/voice/confirm', requireAuth, (req: AuthenticatedRequest, res) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Complete business onboarding first' });
      return;
    }

    const parsed = ConfirmVoiceEntriesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Check your entries before saving',
      });
      return;
    }

    const todayLagos = getLagosDateString();
    const baseMs = Date.now();

    try {
      const result = runTransaction(() => {
        // Pre-validate closed-day lock across all items before writing anything
        for (const item of parsed.data.entries) {
          const entryDate = item.entryDate || todayLagos;
          if (isDayClosed(business.id, entryDate)) {
            return {
              error: `Day ${entryDate} is closed. Change the date or post a visible correction entry instead.`,
              status: 409 as const,
              code: 'CLOSED_DAY',
              closedDate: entryDate,
            };
          }
        }

        const createdEntries: LedgerEntryRecord[] = [];

        parsed.data.entries.forEach((item, idx) => {
          const entryDate = item.entryDate || todayLagos;
          const now = new Date(baseMs + idx).toISOString();
          const ledgerId = crypto.randomUUID();

          if (item.type === 'sale') {
            db.prepare(
              `INSERT INTO ledger_entries (
                id, business_id, entry_type, entry_kind, amount_kobo, cash_received_kobo,
                payment_method, customer_name, customer_phone, note, sold_by, source,
                entry_date, created_at, created_by
              ) VALUES (?, ?, 'SALE', 'QUICK_SALE', ?, ?, ?, ?, ?, ?, ?, 'voice', ?, ?, ?)`
            ).run(
              ledgerId,
              business.id,
              item.amountKobo,
              item.amountKobo,
              item.paymentMethod,
              item.customerName,
              item.customerPhone,
              item.note || 'Voice sale',
              item.soldBy,
              entryDate,
              now,
              req.user!.id
            );
            upsertCustomerSuggestion(business.id, item.customerName, item.customerPhone, now);
          } else if (item.type === 'expense') {
            const expenseId = crypto.randomUUID();
            const category = item.category.trim() || 'Other';
            db.prepare(
              `INSERT INTO expenses (
                id, business_id, entry_date, amount_kobo, category, payee,
                payment_method, note, source, ledger_entry_id, created_at, updated_at, created_by
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'voice', ?, ?, ?, ?)`
            ).run(
              expenseId,
              business.id,
              entryDate,
              item.amountKobo,
              category,
              item.customerName,
              item.paymentMethod,
              item.note || `${category} expense`,
              ledgerId,
              now,
              now,
              req.user!.id
            );

            db.prepare(
              `INSERT INTO ledger_entries (
                id, business_id, entry_type, entry_kind, amount_kobo, cash_received_kobo,
                payment_method, expense_id, customer_name, note, sold_by, source,
                entry_date, created_at, created_by
              ) VALUES (?, ?, 'EXPENSE', 'EXPENSE', ?, 0, ?, ?, ?, ?, ?, 'voice', ?, ?, ?)`
            ).run(
              ledgerId,
              business.id,
              item.amountKobo,
              item.paymentMethod,
              expenseId,
              item.customerName,
              item.note || `${category} expense`,
              item.soldBy,
              entryDate,
              now,
              req.user!.id
            );
          } else if (item.type === 'credit_sale') {
            const creditSaleId = crypto.randomUUID();
            db.prepare(
              `INSERT INTO credit_sales (
                id, business_id, customer_name, customer_phone, item_note,
                total_kobo, amount_paid_kobo, balance_due_kobo, due_date, sold_by,
                status, entry_date, created_at, created_by
              ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, 'UNPAID', ?, ?, ?)`
            ).run(
              creditSaleId,
              business.id,
              item.customerName.trim(),
              item.customerPhone,
              item.note,
              item.amountKobo,
              item.amountKobo,
              item.soldBy,
              entryDate,
              now,
              req.user!.id
            );

            db.prepare(
              `INSERT INTO ledger_entries (
                id, business_id, entry_type, entry_kind, amount_kobo, cash_received_kobo,
                payment_method, credit_sale_id, customer_name, customer_phone,
                note, sold_by, source, entry_date, created_at, created_by
              ) VALUES (?, ?, 'SALE', 'CREDIT_SALE', ?, 0, 'Other', ?, ?, ?, ?, ?, 'voice', ?, ?, ?)`
            ).run(
              ledgerId,
              business.id,
              item.amountKobo,
              creditSaleId,
              item.customerName.trim(),
              item.customerPhone,
              item.note || `Credit sale to ${item.customerName.trim()}`,
              item.soldBy,
              entryDate,
              now,
              req.user!.id
            );
            upsertCustomerSuggestion(business.id, item.customerName, item.customerPhone, now);
          } else if (item.type === 'payment_received') {
            db.prepare(
              `INSERT INTO ledger_entries (
                id, business_id, entry_type, entry_kind, amount_kobo, cash_received_kobo,
                payment_method, customer_name, customer_phone, note, sold_by, source,
                entry_date, created_at, created_by
              ) VALUES (?, ?, 'PAYMENT_RECEIVED', 'DEBT_PAYMENT', ?, ?, ?, ?, ?, ?, ?, 'voice', ?, ?, ?)`
            ).run(
              ledgerId,
              business.id,
              item.amountKobo,
              item.amountKobo,
              item.paymentMethod,
              item.customerName,
              item.customerPhone,
              item.note ||
                (item.customerName ? `Payment received from ${item.customerName}` : 'Debt payment received'),
              item.soldBy,
              entryDate,
              now,
              req.user!.id
            );
            upsertCustomerSuggestion(business.id, item.customerName, item.customerPhone, now);
          }

          const inserted = db.prepare('SELECT * FROM ledger_entries WHERE id = ?').get(ledgerId);
          createdEntries.push(mapLedgerRow(inserted));
        });

        return { savedCount: createdEntries.length, entries: createdEntries };
      });

      if ('error' in result) {
        res.status(result.status ?? 409).json({
          error: result.error,
          code: result.code,
          closedDate: result.closedDate,
        });
        return;
      }

      res.status(201).json(result);
    } catch (err) {
      logError('voice_confirm', err, { userId: req.user!.id });
      res.status(500).json({ error: 'Unable to save confirmed entries' });
    }
  });

  const analyticsLimiter = createRateLimiter(30, 60_000);

  router.post('/analytics', analyticsLimiter, async (req, res) => {
    const parsed = AnalyticsEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid analytics event payload' });
      return;
    }

    const { eventName, path: cleanPath, timestamp } = parsed.data;
    const createdAt = timestamp || new Date().toISOString();
    const id = crypto.randomUUID();

    try {
      db.prepare('INSERT INTO analytics_events (id, event_name, path, created_at) VALUES (?, ?, ?, ?)').run(
        id,
        eventName,
        cleanPath,
        createdAt
      );

      // Best-effort mirror to Supabase analytics_events when configured (no IP/UA/user PII sent)
      const rawSupaUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '')
        .trim()
        .replace(/^["']+|["']+$/g, '');
      let supaUrl = '';
      try {
        if (rawSupaUrl) supaUrl = new URL(rawSupaUrl).origin;
      } catch {
        supaUrl = '';
      }
      const supaKey = (
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.VITE_SUPABASE_ANON_KEY ||
        process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
        process.env.SUPABASE_ANON_KEY ||
        ''
      )
        .trim()
        .replace(/^["']+|["']+$/g, '')
        .trim();
      if (supaUrl && supaKey) {
        fetch(`${supaUrl}/rest/v1/analytics_events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: supaKey,
            Authorization: `Bearer ${supaKey}`,
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            event_name: eventName,
            path: cleanPath,
            created_at: createdAt,
          }),
        }).catch(() => {});
      }

      res.status(202).json({ ok: true });
    } catch (err) {
      logError('analytics_ingest', err);
      res.status(500).json({ error: 'Unable to record event' });
    }
  });

  router.delete('/account', requireAnyAuth, async (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    try {
      if (req.isSupabaseUser) {
        const rawSupaUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '')
          .trim()
          .replace(/^["']+|["']+$/g, '');
        let supaUrl = '';
        try {
          if (rawSupaUrl) supaUrl = new URL(rawSupaUrl).origin;
        } catch {
          supaUrl = '';
        }
        const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '')
          .trim()
          .replace(/^["']+|["']+$/g, '')
          .trim();
        let deletedAuthUser = false;

        if (supaUrl && serviceKey) {
          const purgeSupaBucketPrefix = async (bucket: string, prefixDir: string) => {
            try {
              const listRes = await fetch(`${supaUrl}/storage/v1/object/list/${bucket}`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  apikey: serviceKey,
                  Authorization: `Bearer ${serviceKey}`,
                },
                body: JSON.stringify({ prefix: `${prefixDir}/`, limit: 1000 }),
                signal: AbortSignal.timeout(8000),
              });
              if (listRes.ok) {
                const objects = (await listRes.json()) as Array<{ name?: string }>;
                const prefixes = (objects || [])
                  .map((obj) => (obj.name ? `${prefixDir}/${obj.name}` : ''))
                  .filter(Boolean);
                if (prefixes.length > 0) {
                  await fetch(`${supaUrl}/storage/v1/object/${bucket}`, {
                    method: 'DELETE',
                    headers: {
                      'Content-Type': 'application/json',
                      apikey: serviceKey,
                      Authorization: `Bearer ${serviceKey}`,
                    },
                    body: JSON.stringify({ prefixes }),
                    signal: AbortSignal.timeout(8000),
                  });
                }
              }
            } catch {
              // Do not block auth deletion if storage folder is empty
            }
          };

          // Lookup owner's business ID so we purge all private claim-proofs under businessId/
          let supaBusinessId: string | null = null;
          try {
            const bizRes = await fetch(
              `${supaUrl}/rest/v1/businesses?select=id&owner_id=eq.${encodeURIComponent(userId)}`,
              {
                headers: {
                  apikey: serviceKey,
                  Authorization: `Bearer ${serviceKey}`,
                },
                signal: AbortSignal.timeout(8000),
              }
            );
            if (bizRes.ok) {
              const rows = (await bizRes.json()) as Array<{ id?: string }>;
              supaBusinessId = rows?.[0]?.id || null;
            }
          } catch {
            supaBusinessId = null;
          }

          // Best-effort purge of owner's private expense-proofs & claim-proofs folders
          await purgeSupaBucketPrefix('expense-proofs', userId);
          await purgeSupaBucketPrefix('claim-proofs', userId);
          if (supaBusinessId) {
            await purgeSupaBucketPrefix('claim-proofs', supaBusinessId);
            // Delete day_closures first so closed-day triggers never interfere with cascade delete
            try {
              await fetch(
                `${supaUrl}/rest/v1/day_closures?business_id=eq.${encodeURIComponent(supaBusinessId)}`,
                {
                  method: 'DELETE',
                  headers: {
                    apikey: serviceKey,
                    Authorization: `Bearer ${serviceKey}`,
                  },
                  signal: AbortSignal.timeout(8000),
                }
              );
            } catch {
              // continue to auth user delete
            }
          }

          const delRes = await fetch(`${supaUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
            method: 'DELETE',
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
            },
            signal: AbortSignal.timeout(8000),
          });
          if (!delRes.ok) {
            const errTxt = await delRes.text();
            throw new Error(`Supabase user delete failed (${delRes.status}): ${errTxt}`);
          }
          deletedAuthUser = true;
        }

        clearSessionCookie(res);
        res.json({ ok: true, deletedAuthUser });
        return;
      }

      const proofRows = db
        .prepare(
          `SELECT proof_path FROM payment_claims
           WHERE business_id IN (SELECT id FROM businesses WHERE owner_id = ?)
             AND proof_path IS NOT NULL`
        )
        .all(userId) as Array<{ proof_path: string }>;

      runTransaction(() => {
        const bizIds = db
          .prepare('SELECT id FROM businesses WHERE owner_id = ?')
          .all(userId) as Array<{ id: string }>;

        for (const { id: bizId } of bizIds) {
          // Clear day closures first so SQLite closed-day delete triggers allow full account purge
          db.prepare('DELETE FROM day_closures WHERE business_id = ?').run(bizId);
          // Break self-referential / cross-table links cleanly before cascading deletes
          db.prepare('UPDATE quotes SET converted_invoice_id = NULL, revised_from_id = NULL WHERE business_id = ?').run(bizId);
          db.prepare('UPDATE invoices SET reissued_from_id = NULL, source_quote_id = NULL WHERE business_id = ?').run(bizId);
          db.prepare('UPDATE receipts SET parent_receipt_id = NULL WHERE business_id = ?').run(bizId);
          db.prepare('DELETE FROM payment_claims WHERE business_id = ?').run(bizId);
          db.prepare('DELETE FROM payment_reminders WHERE business_id = ?').run(bizId);
          db.prepare('DELETE FROM payments WHERE business_id = ?').run(bizId);
          db.prepare('DELETE FROM debts WHERE business_id = ?').run(bizId);
          db.prepare('DELETE FROM quote_lines WHERE business_id = ?').run(bizId);
          db.prepare('DELETE FROM quotes WHERE business_id = ?').run(bizId);
          db.prepare('DELETE FROM invoice_lines WHERE business_id = ?').run(bizId);
          db.prepare('DELETE FROM invoices WHERE business_id = ?').run(bizId);
          db.prepare('DELETE FROM push_subscriptions WHERE business_id = ?').run(bizId);
          db.prepare('DELETE FROM audit_log WHERE business_id = ?').run(bizId);
          db.prepare('DELETE FROM usage_counters WHERE business_id = ?').run(bizId);
          db.prepare('DELETE FROM ledger_entries WHERE business_id = ?').run(bizId);
          db.prepare('DELETE FROM credit_sales WHERE business_id = ?').run(bizId);
          db.prepare('DELETE FROM creditors WHERE business_id = ?').run(bizId);
          db.prepare('DELETE FROM expenses WHERE business_id = ?').run(bizId);
          db.prepare('DELETE FROM receipts WHERE business_id = ?').run(bizId);
          db.prepare('DELETE FROM customers WHERE business_id = ?').run(bizId);
          db.prepare('DELETE FROM catalog_items WHERE business_id = ?').run(bizId);
        }
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      });
      for (const row of proofRows) {
        deletePrivateProofFile(row.proof_path);
      }
      const userDir = path.join(EXPENSE_PROOFS_DIR, userId);
      if (fs.existsSync(userDir)) {
        fs.rmSync(userDir, { recursive: true, force: true });
      }
      clearSessionCookie(res);
      res.json({ ok: true, deletedAuthUser: true });
    } catch (err) {
      logError('delete_account', err, { userId });
      res.status(500).json({ error: 'Unable to delete account' });
    }
  });

  router.use('/v2', createV2Router({ getOwnedBusiness, mapReceiptRow }));

  return router;
}
