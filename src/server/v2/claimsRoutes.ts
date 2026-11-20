import crypto from 'node:crypto';
import fs from 'node:fs';
import express, { type Request, type Response, type Router } from 'express';
import { db, logError, runTransaction } from '../db.ts';
import { type AuthenticatedRequest, requireAuth } from '../auth.ts';
import { getLagosDateString, type CurrencyCode } from '../../shared/money.ts';
import type { PaymentMethod } from '../../shared/schemas.ts';
import type { BusinessProfile } from '../../shared/types.ts';
import {
  ConfirmClaimSchema,
  PushSubscribeSchema,
  PushUnsubscribeSchema,
  RejectClaimSchema,
  SubmitPaymentClaimSchema,
} from '../../shared/v2/schemas.ts';
import type {
  DuplicateClaimWarning,
  PaymentClaimRecord,
  PaymentClaimStatus,
} from '../../shared/v2/types.ts';
import {
  checkPersistentRateLimit,
  extractClientIp,
  hashClientIp,
  isKillSwitchEnabled,
  issueBotChallenge,
  verifyBotCheck,
} from './botCheck.ts';
import {
  createSignedProofUrlParams,
  deletePrivateProofFile,
  MAX_PROOF_BYTES,
  resolveConfinedProofPath,
  storePrivateProofFile,
  verifyAndSanitizeProof,
  verifySignedProofUrlParams,
} from './proofSecurity.ts';
import {
  buildNonPiiClaimPushPayload,
  getVapidConfig,
  isSafePushEndpoint,
  sendBusinessWebPush,
} from './push.ts';
import { runProofRetentionJob } from './retention.ts';

const UPLOAD_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_PENDING_CLAIMS_PER_INVOICE = 3;
const MAX_CLAIMS_PER_IP_HOUR = 5;
const MAX_CLAIMS_PER_IP_DAY = 20;
const DUPLICATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function sha256Hex(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function generateClaimRef(): string {
  return `CLM-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function normalizeRef(raw: string | null | undefined): string {
  return (raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function detectDuplicateWarning(claimRow: any): DuplicateClaimWarning | null {
  const claimCreatedMs = Date.parse(claimRow.created_at) || Date.now();
  const windowStartIso = new Date(claimCreatedMs - DUPLICATE_WINDOW_MS).toISOString();
  const windowEndIso = new Date(claimCreatedMs + DUPLICATE_WINDOW_MS).toISOString();
  const claimAmount = Number(claimRow.amount_kobo);
  const claimRefNorm = normalizeRef(claimRow.reference);

  const matchingClaimRefs: string[] = [];
  const matchingPaymentIds: string[] = [];
  let matchedByAmount = false;
  let matchedByRef = false;

  const otherClaims = db
    .prepare(
      `SELECT id, claim_ref, amount_kobo, reference, created_at
       FROM payment_claims
       WHERE invoice_id = ?
         AND id <> ?
         AND status <> 'REJECTED'
         AND created_at >= ?
         AND created_at <= ?`
    )
    .all(claimRow.invoice_id, claimRow.id, windowStartIso, windowEndIso) as any[];

  for (const other of otherClaims) {
    const sameAmount = Number(other.amount_kobo) === claimAmount;
    const sameRef = Boolean(claimRefNorm && normalizeRef(other.reference) === claimRefNorm);
    if (sameAmount || sameRef) {
      matchingClaimRefs.push(other.claim_ref);
      if (sameAmount) matchedByAmount = true;
      if (sameRef) matchedByRef = true;
    }
  }

  const recentPayments = db
    .prepare(
      `SELECT id, amount_kobo, reference, created_at
       FROM payments
       WHERE invoice_id = ?
         AND is_voided = 0
         AND id <> COALESCE(?, '')
         AND created_at >= ?
         AND created_at <= ?`
    )
    .all(claimRow.invoice_id, claimRow.payment_id || '', windowStartIso, windowEndIso) as any[];

  for (const pay of recentPayments) {
    const sameAmount = Number(pay.amount_kobo) === claimAmount;
    const sameRef = Boolean(claimRefNorm && normalizeRef(pay.reference) === claimRefNorm);
    if (sameAmount || sameRef) {
      matchingPaymentIds.push(pay.id);
      if (sameAmount) matchedByAmount = true;
      if (sameRef) matchedByRef = true;
    }
  }

  if (matchingClaimRefs.length === 0 && matchingPaymentIds.length === 0) {
    return null;
  }

  const parts: string[] = [];
  if (matchedByAmount && matchedByRef) {
    parts.push('Same amount and reference');
  } else if (matchedByRef) {
    parts.push('Same payment reference');
  } else {
    parts.push('Same payment amount');
  }

  return {
    reason: `${parts[0]} already seen on this invoice within 7 days. Check your bank statement before confirming.`,
    matchingClaimRefs,
    matchingPaymentIds,
  };
}

function mapClaimRow(row: any): PaymentClaimRecord {
  const hasProof = Boolean(row.proof_path && !row.proof_deleted_at);
  return {
    id: row.id,
    businessId: row.business_id,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number || null,
    invoiceCustomerName: row.invoice_customer_name || '',
    invoiceTotalKobo: Number(row.invoice_total_kobo ?? 0),
    invoiceBalanceDueKobo: Number(row.invoice_balance_due_kobo ?? 0),
    invoiceCurrency: (row.invoice_currency || 'NGN') as CurrencyCode,
    invoiceStatus: row.invoice_status || 'SENT',
    claimRef: row.claim_ref,
    payerName: row.payer_name,
    amountKobo: Number(row.amount_kobo),
    reference: row.reference || '',
    hasProof,
    proofMime: row.proof_mime || null,
    proofSizeBytes: row.proof_size_bytes !== null && row.proof_size_bytes !== undefined ? Number(row.proof_size_bytes) : null,
    proofDeletedAt: row.proof_deleted_at || null,
    status: row.status as PaymentClaimStatus,
    decisionReason: row.decision_reason || null,
    decidedAt: row.decided_at || null,
    decidedBy: row.decided_by || null,
    paymentId: row.payment_id || null,
    duplicateWarning: detectDuplicateWarning(row),
    createdAt: row.created_at,
  };
}

export interface ClaimsRouteDeps {
  getOwnedBusiness: (userId: string) => BusinessProfile | null;
  logV2Audit: (
    businessId: string,
    actorId: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
    metadata?: Record<string, unknown>
  ) => void;
  executeRecordPayment: (params: {
    business: BusinessProfile;
    userId: string;
    debtId: string;
    amountKobo: number;
    paymentMethod: PaymentMethod;
    paymentDate: string;
    reference: string;
    idempotencyKey: string;
  }) =>
    | { error: string; status?: number; code?: string }
    | { payment: any; receipt: any; debt: any; idempotentReplay: boolean };
}

export function attachV2ClaimsAndPushRoutes(router: Router, deps: ClaimsRouteDeps) {
  const { getOwnedBusiness, logV2Audit, executeRecordPayment } = deps;

  // =========================================================================
  // PUBLIC BOT CHALLENGE (for customer claims & future quote actions)
  // =========================================================================
  router.get('/public/bot-challenge', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');

    const ipHash = hashClientIp(extractClientIp(req));
    const rl = await checkPersistentRateLimit(`bot_challenge:${ipHash}`, 60, 3600);
    if (!rl.allowed) {
      res.status(429).json({ error: 'Too many requests. Please wait a few minutes.' });
      return;
    }

    res.json(issueBotChallenge());
  });

  // =========================================================================
  // PUBLIC CLAIM SUBMISSION (Logged out; NEVER creates money or marks paid)
  // =========================================================================
  router.post('/public/invoices/:publicId/claims', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');

    // Kill switch returns 503 immediately
    if (isKillSwitchEnabled('DISABLE_PUBLIC_CLAIMS')) {
      res.status(503).json({
        error: 'Payment reporting is temporarily paused. Please contact the business directly.',
      });
      return;
    }

    const clientIp = extractClientIp(req);
    const ipHash = hashClientIp(clientIp);

    // Persistent DB rate limits: 5/hour AND 20/day per IP
    const hourLimit = await checkPersistentRateLimit(
      `claim_ip_hour:${ipHash}`,
      MAX_CLAIMS_PER_IP_HOUR,
      3600
    );
    if (!hourLimit.allowed) {
      res.status(429).json({
        error: 'Too many payment reports from this network. Please wait an hour and try again.',
      });
      return;
    }

    const dayLimit = await checkPersistentRateLimit(
      `claim_ip_day:${ipHash}`,
      MAX_CLAIMS_PER_IP_DAY,
      86400
    );
    if (!dayLimit.allowed) {
      res.status(429).json({
        error: 'Daily limit for payment reports reached from this network. Please try again tomorrow.',
      });
      return;
    }

    const parsed = SubmitPaymentClaimSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Check your payment report details and try again.',
      });
      return;
    }

    const input = parsed.data;

    // Bot verification (required)
    const botRes = await verifyBotCheck({
      challenge: input.botChallenge,
      solution: input.botSolution,
      honeypot: input.website,
      turnstileToken: input.turnstileToken,
      clientIp,
    });
    if (!botRes.ok) {
      res.status(400).json({ error: botRes.error || 'Bot verification failed' });
      return;
    }

    const publicId = String(req.params.publicId || '').trim();
    if (publicId.length < 16 || publicId.length > 64) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    try {
      const created = runTransaction(() => {
        const invRow = db
          .prepare(
            "SELECT * FROM invoices WHERE public_id = ? AND status <> 'DRAFT' AND snapshot_json IS NOT NULL"
          )
          .get(publicId) as any;

        if (!invRow) {
          return { error: 'Document not found', status: 404 as const };
        }

        if (!['SENT', 'PART_PAID'].includes(invRow.status) || Number(invRow.balance_due_kobo) <= 0) {
          return {
            error: 'This invoice is no longer open for payment reports.',
            status: 400 as const,
          };
        }

        const remainingKobo = Number(invRow.balance_due_kobo);
        if (input.amountKobo > remainingKobo) {
          return {
            error: `Reported amount exceeds the remaining balance of ₦${(remainingKobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}.`,
            status: 400 as const,
          };
        }

        const pendingRow = db
          .prepare(
            "SELECT COUNT(*) AS cnt FROM payment_claims WHERE invoice_id = ? AND status = 'PENDING'"
          )
          .get(invRow.id) as { cnt: number };

        if (Number(pendingRow?.cnt || 0) >= MAX_PENDING_CLAIMS_PER_INVOICE) {
          return {
            error:
              'There are already 3 payment reports awaiting confirmation on this invoice. Please contact the business directly.',
            status: 429 as const,
          };
        }

        const claimId = crypto.randomUUID();
        const claimRef = generateClaimRef();
        const now = new Date();
        const nowIso = now.toISOString();

        let uploadToken: string | null = null;
        let uploadTokenHash: string | null = null;
        let uploadTokenExpiresAt: string | null = null;

        if (input.hasProof) {
          uploadToken = crypto.randomBytes(32).toString('hex');
          uploadTokenHash = sha256Hex(uploadToken);
          uploadTokenExpiresAt = new Date(now.getTime() + UPLOAD_TOKEN_TTL_MS).toISOString();
        }

        db.prepare(
          `INSERT INTO payment_claims (
            id, business_id, invoice_id, claim_ref, payer_name, amount_kobo, reference,
            upload_token_hash, upload_token_expires_at, upload_token_used_at,
            status, ip_hash, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'PENDING', ?, ?)`
        ).run(
          claimId,
          invRow.business_id,
          invRow.id,
          claimRef,
          input.payerName,
          input.amountKobo,
          input.reference,
          uploadTokenHash,
          uploadTokenExpiresAt,
          ipHash,
          nowIso
        );

        logV2Audit(invRow.business_id, null, 'claim_submitted', 'payment_claim', claimId, {
          claim_ref: claimRef,
          invoice_number: invRow.invoice_number,
          amount_kobo: input.amountKobo,
          has_proof_pending: input.hasProof,
        });

        return {
          claimId,
          claimRef,
          businessId: invRow.business_id as string,
          invoiceNumber: (invRow.invoice_number || 'Invoice') as string,
          uploadToken,
          uploadExpiresInSeconds: uploadToken ? Math.floor(UPLOAD_TOKEN_TTL_MS / 1000) : null,
        };
      });

      if ('error' in created) {
        res.status(created.status ?? 400).json({ error: created.error });
        return;
      }

      // Send strictly non-PII Web Push notification to owner (fire-and-forget, dead subs auto-cleaned)
      sendBusinessWebPush(
        created.businessId,
        buildNonPiiClaimPushPayload(created.invoiceNumber)
      ).catch((err) => logError('v2_claim_push_dispatch', err));

      res.status(201).json({
        claimId: created.claimId,
        claimRef: created.claimRef,
        status: 'PENDING',
        message: 'Payment reported, awaiting confirmation',
        uploadToken: created.uploadToken,
        uploadExpiresInSeconds: created.uploadExpiresInSeconds,
      });
    } catch (err) {
      logError('v2_submit_public_claim', err);
      res.status(500).json({ error: 'Unable to submit payment report right now. Please try again.' });
    }
  });

  // =========================================================================
  // PUBLIC PROOF UPLOAD (Single-use 5-min token bound to claim + magic bytes)
  // =========================================================================
  router.post(
    '/public/claims/:claimId/proof',
    express.raw({ type: '*/*', limit: `${MAX_PROOF_BYTES + 1024 * 1024}` }),
    async (req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.setHeader('Referrer-Policy', 'no-referrer');

      if (isKillSwitchEnabled('DISABLE_PUBLIC_CLAIMS')) {
        res.status(503).json({
          error: 'Payment reporting is temporarily paused. Please contact the business directly.',
        });
        return;
      }

      const ipHash = hashClientIp(extractClientIp(req));
      const rl = await checkPersistentRateLimit(`claim_proof_ip:${ipHash}`, 25, 3600);
      if (!rl.allowed) {
        res.status(429).json({ error: 'Too many upload attempts. Please wait and try again.' });
        return;
      }

      const claimId = String(req.params.claimId || '').trim();
      const authHeader = String(req.headers.authorization || '');
      const headerToken =
        (typeof req.headers['x-upload-token'] === 'string' && req.headers['x-upload-token'].trim()) ||
        (authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '');

      if (!claimId || !headerToken || headerToken.length < 32) {
        res.status(403).json({ error: 'Invalid or missing upload token' });
        return;
      }

      const tokenHash = sha256Hex(headerToken);
      const claimRow = db.prepare('SELECT * FROM payment_claims WHERE id = ?').get(claimId) as any;

      if (!claimRow || !claimRow.upload_token_hash) {
        res.status(403).json({ error: 'Upload token is invalid or bound to a different claim' });
        return;
      }

      const a = Buffer.from(tokenHash, 'utf8');
      const b = Buffer.from(String(claimRow.upload_token_hash), 'utf8');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        res.status(403).json({ error: 'Upload token is invalid or bound to a different claim' });
        return;
      }

      if (claimRow.upload_token_used_at) {
        res.status(403).json({ error: 'Upload token has already been used' });
        return;
      }

      const expiresMs = claimRow.upload_token_expires_at ? Date.parse(claimRow.upload_token_expires_at) : 0;
      if (!expiresMs || Date.now() > expiresMs) {
        res.status(403).json({ error: 'Upload token has expired. Submit a new payment report.' });
        return;
      }

      if (claimRow.status !== 'PENDING' || claimRow.proof_path) {
        res.status(403).json({ error: 'Proof cannot be uploaded for this claim' });
        return;
      }

      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (rawBody.length === 0) {
        res.status(400).json({ error: 'Select a JPEG, PNG, WebP, or PDF proof file to upload.' });
        return;
      }
      if (rawBody.length > MAX_PROOF_BYTES) {
        res.status(413).json({ error: 'Proof file is too large. Maximum size is 5 MB.' });
        return;
      }

      let verified;
      try {
        verified = await verifyAndSanitizeProof(rawBody);
      } catch (err: any) {
        res.status(400).json({
          error: err?.message || 'Unsupported or unsafe proof file. Upload a JPEG, PNG, WebP, or PDF.',
        });
        return;
      }

      let storedPath: string | null = null;
      try {
        storedPath = storePrivateProofFile(
          claimRow.business_id,
          verified.ext,
          verified.sanitizedBytes
        );

        const nowIso = new Date().toISOString();
        const updated = runTransaction(() => {
          const info = db
            .prepare(
              `UPDATE payment_claims
               SET proof_path = ?, proof_mime = ?, proof_size_bytes = ?, upload_token_used_at = ?
               WHERE id = ? AND upload_token_hash = ? AND upload_token_used_at IS NULL AND status = 'PENDING'`
            )
            .run(
              storedPath,
              verified.mime,
              verified.sizeBytes,
              nowIso,
              claimId,
              tokenHash
            );
          return Number(info.changes || 0);
        });

        if (updated !== 1) {
          deletePrivateProofFile(storedPath);
          res.status(403).json({ error: 'Upload token has already been used' });
          return;
        }

        res.status(200).json({
          uploaded: true,
          claimId,
          claimRef: claimRow.claim_ref,
          mime: verified.mime,
          sizeBytes: verified.sizeBytes,
        });
      } catch (err) {
        if (storedPath) deletePrivateProofFile(storedPath);
        logError('v2_upload_claim_proof', err, { claimId });
        res.status(500).json({ error: 'Unable to save payment proof right now' });
      }
    }
  );

  // =========================================================================
  // OWNER CLAIMS REVIEW ROUTES (Authenticated owner only)
  // =========================================================================
  router.get('/claims', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    const statusFilter = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : '';
    const invoiceIdFilter = typeof req.query.invoiceId === 'string' ? req.query.invoiceId.trim() : '';

    const where: string[] = ['pc.business_id = ?'];
    const params: any[] = [business.id];

    if (statusFilter && ['PENDING', 'CONFIRMED', 'REJECTED'].includes(statusFilter)) {
      where.push('pc.status = ?');
      params.push(statusFilter);
    }
    if (invoiceIdFilter) {
      where.push('pc.invoice_id = ?');
      params.push(invoiceIdFilter);
    }

    const rows = db
      .prepare(
        `SELECT pc.*,
                i.invoice_number,
                i.customer_name AS invoice_customer_name,
                i.total_kobo AS invoice_total_kobo,
                i.balance_due_kobo AS invoice_balance_due_kobo,
                i.currency AS invoice_currency,
                i.status AS invoice_status
         FROM payment_claims pc
         JOIN invoices i ON i.id = pc.invoice_id
         WHERE ${where.join(' AND ')}
         ORDER BY CASE pc.status WHEN 'PENDING' THEN 0 ELSE 1 END, pc.created_at DESC
         LIMIT 200`
      )
      .all(...params) as any[];

    res.json({ claims: rows.map(mapClaimRow) });
  });

  // Owner obtains short-lived signed URL for private proof file (120s TTL)
  router.get('/claims/:claimId/proof-url', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    const claimId = String(req.params.claimId || '').trim();
    const row = db
      .prepare('SELECT id, business_id, proof_path, proof_mime, proof_size_bytes, proof_deleted_at FROM payment_claims WHERE id = ? AND business_id = ?')
      .get(claimId, business.id) as any;

    if (!row) {
      res.status(404).json({ error: 'Payment claim not found' });
      return;
    }
    if (!row.proof_path || row.proof_deleted_at) {
      res.status(404).json({ error: 'Proof file is no longer available' });
      return;
    }

    const resolved = resolveConfinedProofPath(row.proof_path);
    if (!resolved || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Proof file not found' });
      return;
    }

    const ttlSeconds = 120;
    const { exp, sig } = createSignedProofUrlParams(row.id, business.id, row.proof_path, ttlSeconds);
    res.json({
      url: `/api/v2/claims/${encodeURIComponent(row.id)}/proof-file?exp=${exp}&sig=${sig}`,
      mime: row.proof_mime || 'application/octet-stream',
      sizeBytes: Number(row.proof_size_bytes || 0),
      expiresInSeconds: ttlSeconds,
    });
  });

  // Serves private proof ONLY with a valid unexpired HMAC-signed URL (never publicly reachable)
  router.get('/claims/:claimId/proof-file', (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");

    const claimId = String(req.params.claimId || '').trim();
    const exp = typeof req.query.exp === 'string' ? req.query.exp : undefined;
    const sig = typeof req.query.sig === 'string' ? req.query.sig : undefined;

    if (!claimId || !exp || !sig) {
      res.status(403).json({ error: 'Signed owner URL required to view proof' });
      return;
    }

    const row = db
      .prepare('SELECT id, business_id, proof_path, proof_mime, proof_deleted_at FROM payment_claims WHERE id = ?')
      .get(claimId) as any;

    if (!row || !row.proof_path || row.proof_deleted_at) {
      res.status(403).json({ error: 'Invalid or expired proof link' });
      return;
    }

    const valid = verifySignedProofUrlParams(row.id, row.business_id, row.proof_path, exp, sig);
    if (!valid) {
      res.status(403).json({ error: 'Invalid or expired proof link' });
      return;
    }

    const resolved = resolveConfinedProofPath(row.proof_path);
    if (!resolved || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Proof file not found' });
      return;
    }

    const mime = String(row.proof_mime || 'application/octet-stream');
    const ext =
      mime === 'image/jpeg'
        ? '.jpg'
        : mime === 'image/png'
        ? '.png'
        : mime === 'image/webp'
        ? '.webp'
        : '.pdf';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="proof${ext}"`);
    res.sendFile(resolved);
  });

  // Owner CONFIRMS claim (amount editable; runs record_payment & issues linked receipt atomically)
  router.post('/claims/:claimId/confirm', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    const parsed = ConfirmClaimSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid confirmation details' });
      return;
    }

    const claimId = String(req.params.claimId || '').trim();
    const input = parsed.data;
    const now = new Date().toISOString();

    try {
      const result = runTransaction(() => {
        const claimRow = db
          .prepare('SELECT * FROM payment_claims WHERE id = ? AND business_id = ?')
          .get(claimId, business.id) as any;
        if (!claimRow) {
          return { error: 'Payment claim not found', status: 404 as const };
        }
        if (claimRow.status !== 'PENDING') {
          return { error: 'This payment report has already been decided', status: 409 as const };
        }

        const debtRow = db
          .prepare(
            "SELECT * FROM debts WHERE business_id = ? AND source_type = 'INVOICE' AND source_id = ?"
          )
          .get(business.id, claimRow.invoice_id) as any;

        if (!debtRow) {
          return { error: 'Invoice receivable record not found', status: 404 as const };
        }

        const amountKobo = input.amountKobo ?? Number(claimRow.amount_kobo);
        const reference = (input.reference !== undefined ? input.reference : claimRow.reference || '').trim();
        const paymentDate = input.paymentDate || getLagosDateString();
        const idempotencyKey = input.idempotencyKey || `claim-confirm-${claimRow.id}`;

        const payResult = executeRecordPayment({
          business,
          userId: req.user!.id,
          debtId: debtRow.id,
          amountKobo,
          paymentMethod: input.paymentMethod || 'Transfer',
          paymentDate,
          reference,
          idempotencyKey,
        });

        if ('error' in payResult) {
          return payResult;
        }

        db.prepare(
          `UPDATE payment_claims
           SET status = 'CONFIRMED', decided_at = ?, decided_by = ?, payment_id = ?
           WHERE id = ?`
        ).run(now, req.user!.id, payResult.payment.id, claimRow.id);

        logV2Audit(business.id, req.user!.id, 'claim_confirmed', 'payment_claim', claimRow.id, {
          claim_ref: claimRow.claim_ref,
          invoice_id: claimRow.invoice_id,
          confirmed_amount_kobo: amountKobo,
          payment_id: payResult.payment.id,
          receipt_number: payResult.receipt?.receiptNumber || null,
        });

        const updatedClaim = db
          .prepare(
            `SELECT pc.*,
                    i.invoice_number,
                    i.customer_name AS invoice_customer_name,
                    i.total_kobo AS invoice_total_kobo,
                    i.balance_due_kobo AS invoice_balance_due_kobo,
                    i.currency AS invoice_currency,
                    i.status AS invoice_status
             FROM payment_claims pc
             JOIN invoices i ON i.id = pc.invoice_id
             WHERE pc.id = ?`
          )
          .get(claimRow.id);

        return {
          claim: mapClaimRow(updatedClaim),
          payment: payResult.payment,
          receipt: payResult.receipt,
          debt: payResult.debt,
        };
      });

      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error, code: (result as any).code });
        return;
      }

      res.json(result);
    } catch (err) {
      logError('v2_confirm_claim', err, { userId: req.user!.id, claimId });
      res.status(500).json({ error: 'Unable to confirm payment report' });
    }
  });

  // Owner REJECTS claim (stores private reason; customer sees only neutral message)
  router.post('/claims/:claimId/reject', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    const parsed = RejectClaimSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Private reason required' });
      return;
    }

    const claimId = String(req.params.claimId || '').trim();
    const now = new Date().toISOString();

    try {
      const result = runTransaction(() => {
        const claimRow = db
          .prepare('SELECT * FROM payment_claims WHERE id = ? AND business_id = ?')
          .get(claimId, business.id) as any;
        if (!claimRow) {
          return { error: 'Payment claim not found', status: 404 as const };
        }
        if (claimRow.status !== 'PENDING') {
          return { error: 'This payment report has already been decided', status: 409 as const };
        }

        db.prepare(
          `UPDATE payment_claims
           SET status = 'REJECTED', decision_reason = ?, decided_at = ?, decided_by = ?
           WHERE id = ?`
        ).run(parsed.data.reason, now, req.user!.id, claimRow.id);

        logV2Audit(business.id, req.user!.id, 'claim_rejected', 'payment_claim', claimRow.id, {
          claim_ref: claimRow.claim_ref,
          invoice_id: claimRow.invoice_id,
        });

        const updatedClaim = db
          .prepare(
            `SELECT pc.*,
                    i.invoice_number,
                    i.customer_name AS invoice_customer_name,
                    i.total_kobo AS invoice_total_kobo,
                    i.balance_due_kobo AS invoice_balance_due_kobo,
                    i.currency AS invoice_currency,
                    i.status AS invoice_status
             FROM payment_claims pc
             JOIN invoices i ON i.id = pc.invoice_id
             WHERE pc.id = ?`
          )
          .get(claimRow.id);

        return { claim: mapClaimRow(updatedClaim) };
      });

      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }

      res.json(result);
    } catch (err) {
      logError('v2_reject_claim', err, { userId: req.user!.id, claimId });
      res.status(500).json({ error: 'Unable to reject payment report' });
    }
  });

  // =========================================================================
  // OPT-IN WEB PUSH ROUTES (VAPID public key, subscribe, unsubscribe)
  // =========================================================================
  router.get('/push/status', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    const vapid = getVapidConfig();
    const subs = db
      .prepare('SELECT endpoint FROM push_subscriptions WHERE business_id = ? AND user_id = ?')
      .all(business.id, req.user!.id) as Array<{ endpoint: string }>;

    res.json({
      vapidConfigured: vapid.configured,
      publicKey: vapid.publicKey,
      subscribedCount: subs.length,
      endpoints: subs.map((s) => s.endpoint),
    });
  });

  router.post('/push/subscribe', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    const parsed = PushSubscribeSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid push subscription' });
      return;
    }

    if (!isSafePushEndpoint(parsed.data.endpoint)) {
      res.status(400).json({ error: 'Push endpoint URL is not allowed' });
      return;
    }

    const now = new Date().toISOString();
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 200);

    runTransaction(() => {
      const existing = db
        .prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?')
        .get(parsed.data.endpoint) as { id: string } | undefined;

      if (existing) {
        db.prepare(
          `UPDATE push_subscriptions
           SET business_id = ?, user_id = ?, p256dh = ?, auth_secret = ?, user_agent = ?, last_used_at = ?
           WHERE id = ?`
        ).run(
          business.id,
          req.user!.id,
          parsed.data.keys.p256dh,
          parsed.data.keys.auth,
          userAgent,
          now,
          existing.id
        );
      } else {
        db.prepare(
          `INSERT INTO push_subscriptions (
            id, business_id, user_id, endpoint, p256dh, auth_secret, user_agent, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          business.id,
          req.user!.id,
          parsed.data.endpoint,
          parsed.data.keys.p256dh,
          parsed.data.keys.auth,
          userAgent,
          now
        );
      }
    });

    res.status(201).json({ subscribed: true });
  });

  router.post('/push/unsubscribe', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const business = getOwnedBusiness(req.user!.id);
    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    const parsed = PushUnsubscribeSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid push endpoint required' });
      return;
    }

    db.prepare(
      'DELETE FROM push_subscriptions WHERE business_id = ? AND user_id = ? AND endpoint = ?'
    ).run(business.id, req.user!.id, parsed.data.endpoint);

    res.json({ unsubscribed: true });
  });

  // =========================================================================
  // INTERNAL 90-DAY PROOF RETENTION CRON TRIGGER (Secret-protected)
  // =========================================================================
  router.post('/internal/retention-run', async (req: Request, res: Response) => {
    const expectedSecret = (process.env.RETENTION_CRON_SECRET || '').trim();
    if (!expectedSecret) {
      res.status(503).json({ error: 'Retention cron secret is not configured' });
      return;
    }
    const authHeader = String(req.headers.authorization || '');
    const supplied =
      (typeof req.headers['x-cron-secret'] === 'string' && req.headers['x-cron-secret'].trim()) ||
      (authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '');

    const a = Buffer.from(supplied, 'utf8');
    const b = Buffer.from(expectedSecret, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    try {
      const result = await runProofRetentionJob();
      res.json(result);
    } catch (err) {
      logError('v2_retention_cron_endpoint', err);
      res.status(500).json({ error: 'Retention job failed' });
    }
  });
}
