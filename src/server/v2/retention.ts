import crypto from 'node:crypto';
import { db, logError } from '../db.ts';
import { deletePrivateProofFile } from './proofSecurity.ts';

export const PROOF_RETENTION_DAYS = 90;

export interface RetentionRunResult {
  scanned: number;
  deletedCount: number;
  failedCount: number;
  cutoffIso: string;
}

/**
 * Deletes proof files 90 days after a claim decision (CONFIRMED or REJECTED)
 * while preserving all claim metadata (claim_ref, payer_name, amount, status, decision_reason, decided_at).
 */
export async function runProofRetentionJob(now: Date = new Date()): Promise<RetentionRunResult> {
  const cutoffDate = new Date(now.getTime() - PROOF_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoffDate.toISOString();
  const nowIso = now.toISOString();

  let scanned = 0;
  let deletedCount = 0;
  let failedCount = 0;

  // 1. Local SQLite private proofs
  const rows = db
    .prepare(
      `SELECT id, business_id, claim_ref, proof_path
       FROM payment_claims
       WHERE status IN ('CONFIRMED', 'REJECTED')
         AND decided_at IS NOT NULL
         AND decided_at <= ?
         AND proof_path IS NOT NULL
         AND proof_deleted_at IS NULL`
    )
    .all(cutoffIso) as Array<{
    id: string;
    business_id: string;
    claim_ref: string;
    proof_path: string;
  }>;

  scanned += rows.length;

  for (const row of rows) {
    try {
      deletePrivateProofFile(row.proof_path);
      db.prepare(
        'UPDATE payment_claims SET proof_path = NULL, proof_deleted_at = ? WHERE id = ?'
      ).run(nowIso, row.id);
      db.prepare(
        `INSERT INTO audit_log (id, business_id, actor_id, action, entity_type, entity_id, metadata_json, created_at)
         VALUES (?, ?, NULL, 'claim_proof_purged', 'payment_claim', ?, ?, ?)`
      ).run(
        crypto.randomUUID(),
        row.business_id,
        row.id,
        JSON.stringify({ claim_ref: row.claim_ref, retention_days: PROOF_RETENTION_DAYS }),
        nowIso
      );
      deletedCount += 1;
    } catch (err) {
      failedCount += 1;
      logError('v2_proof_retention_local', err, { claimId: row.id });
    }
  }

  // 2. Optional Supabase Storage private bucket cleanup when service role is configured
  const supaUrl = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supaService = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (supaUrl && supaService) {
    try {
      const rpcRes = await fetch(`${supaUrl}/rest/v1/rpc/v2_purge_expired_claim_proofs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supaService,
          Authorization: `Bearer ${supaService}`,
        },
        body: JSON.stringify({ p_cutoff: cutoffIso }),
      });
      if (rpcRes.ok) {
        const purged: Array<{ claim_id: string; proof_path: string }> = await rpcRes.json();
        if (Array.isArray(purged) && purged.length > 0) {
          scanned += purged.length;
          const paths = purged.map((p) => p.proof_path).filter(Boolean);
          if (paths.length > 0) {
            await fetch(`${supaUrl}/storage/v1/object/claim-proofs`, {
              method: 'DELETE',
              headers: {
                'Content-Type': 'application/json',
                apikey: supaService,
                Authorization: `Bearer ${supaService}`,
              },
              body: JSON.stringify({ prefixes: paths }),
            });
          }
          deletedCount += purged.length;
        }
      }
    } catch (err) {
      logError('v2_proof_retention_supabase', err);
    }
  }

  return { scanned, deletedCount, failedCount, cutoffIso };
}
