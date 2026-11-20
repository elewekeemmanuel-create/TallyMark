import crypto from 'node:crypto';
import type { Request } from 'express';
import { db } from '../db.ts';

const EPHEMERAL_BOT_SECRET = crypto.randomBytes(32).toString('hex');
const BOT_CHALLENGE_TTL_SEC = 600; // 10 minutes
export const BOT_DIFFICULTY_HEX_ZEROS = 3; // 12 leading zero bits (~4096 hashes, ~15ms on low-end Android)

function getBotSecret(): string {
  return process.env.BOT_CHECK_SECRET || process.env.SESSION_SECRET || EPHEMERAL_BOT_SECRET;
}

export function isKillSwitchEnabled(envName: 'DISABLE_PUBLIC_CLAIMS' | 'DISABLE_PUBLIC_QUOTE_ACTIONS'): boolean {
  const raw = (process.env[envName] || '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

export function extractClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  const raw =
    typeof fwd === 'string' && fwd.trim()
      ? fwd.split(',')[0].trim()
      : Array.isArray(fwd) && fwd[0]
      ? fwd[0].trim()
      : req.ip || req.socket?.remoteAddress || 'unknown';
  return raw.slice(0, 64);
}

export function hashClientIp(ip: string): string {
  return crypto.createHmac('sha256', getBotSecret()).update(`ip:${ip}`).digest('hex').slice(0, 32);
}

/**
 * Persistent rate-limit check backed by Postgres (via Supabase RPC when configured)
 * or SQLite rate_limits table on disk. NEVER stored in server memory.
 */
export async function checkPersistentRateLimit(
  bucketKey: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; count: number; remaining: number }> {
  const supaUrl = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supaService = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (supaUrl && supaService) {
    try {
      const res = await fetch(`${supaUrl}/rest/v1/rpc/check_rate_limit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supaService,
          Authorization: `Bearer ${supaService}`,
        },
        body: JSON.stringify({
          p_bucket_key: bucketKey,
          p_limit: limit,
          p_window_seconds: windowSeconds,
        }),
      });
      if (res.ok) {
        const data: any = await res.json();
        return {
          allowed: Boolean(data?.allowed),
          count: Number(data?.count ?? 1),
          remaining: Number(data?.remaining ?? 0),
        };
      }
    } catch {
      // Fall back to persistent local SQLite rate_limits table if Supabase RPC unreachable
    }
  }

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

/**
 * Issues a signed proof-of-work bot challenge (no external third-party script required).
 */
export function issueBotChallenge(): {
  challenge: string;
  difficulty: number;
  expiresInSeconds: number;
  turnstileSiteKey: string | null;
} {
  const nonce = crypto.randomBytes(16).toString('hex');
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${nonce}.${issuedAt}.${BOT_DIFFICULTY_HEX_ZEROS}`;
  const sig = crypto.createHmac('sha256', getBotSecret()).update(payload).digest('hex').slice(0, 32);
  return {
    challenge: `${payload}.${sig}`,
    difficulty: BOT_DIFFICULTY_HEX_ZEROS,
    expiresInSeconds: BOT_CHALLENGE_TTL_SEC,
    turnstileSiteKey: (process.env.VITE_TURNSTILE_SITE_KEY || '').trim() || null,
  };
}

/**
 * Solves a bot challenge (helper primarily for tests and CLI tools).
 */
export function solveBotChallenge(challenge: string, difficulty = BOT_DIFFICULTY_HEX_ZEROS): string {
  const prefix = '0'.repeat(difficulty);
  for (let i = 0; i < 500_000; i++) {
    const candidate = String(i);
    const digest = crypto.createHash('sha256').update(`${challenge}:${candidate}`).digest('hex');
    if (digest.startsWith(prefix)) {
      return candidate;
    }
  }
  throw new Error('Unable to solve bot challenge');
}

/**
 * Verifies honeypot, signed challenge, single-use replay guard (persisted in DB),
 * SHA-256 proof-of-work, and optional Cloudflare Turnstile secret check.
 */
export async function verifyBotCheck(params: {
  challenge: string;
  solution: string;
  honeypot?: string;
  turnstileToken?: string;
  clientIp?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (params.honeypot && params.honeypot.trim().length > 0) {
    return { ok: false, error: 'Bot verification failed' };
  }

  const turnstileSecret = (process.env.TURNSTILE_SECRET_KEY || '').trim();
  if (turnstileSecret) {
    if (!params.turnstileToken) {
      return { ok: false, error: 'Complete the security check before submitting' };
    }
    try {
      const form = new URLSearchParams();
      form.set('secret', turnstileSecret);
      form.set('response', params.turnstileToken);
      if (params.clientIp) form.set('remoteip', params.clientIp);
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: form,
      });
      const json: any = await r.json();
      if (!json?.success) {
        return { ok: false, error: 'Security check could not be verified. Please try again.' };
      }
    } catch {
      return { ok: false, error: 'Security check unavailable. Please try again.' };
    }
  }

  const parts = (params.challenge || '').split('.');
  if (parts.length !== 4) {
    return { ok: false, error: 'Security check is invalid. Reload and try again.' };
  }
  const [nonce, issuedAtRaw, diffRaw, sig] = parts;
  const issuedAt = Number(issuedAtRaw);
  const difficulty = Number(diffRaw);
  if (
    !/^[a-f0-9]{32}$/.test(nonce) ||
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(difficulty) ||
    difficulty < BOT_DIFFICULTY_HEX_ZEROS ||
    difficulty > 6
  ) {
    return { ok: false, error: 'Security check is invalid. Reload and try again.' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - issuedAt > BOT_CHALLENGE_TTL_SEC || issuedAt > nowSec + 30) {
    return { ok: false, error: 'Security check expired. Please try submitting again.' };
  }

  const payload = `${nonce}.${issuedAtRaw}.${diffRaw}`;
  const expectedSig = crypto
    .createHmac('sha256', getBotSecret())
    .update(payload)
    .digest('hex')
    .slice(0, 32);

  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'Security check signature invalid' };
  }

  const digest = crypto
    .createHash('sha256')
    .update(`${params.challenge}:${params.solution}`)
    .digest('hex');
  if (!digest.startsWith('0'.repeat(difficulty))) {
    return { ok: false, error: 'Bot verification failed' };
  }

  // Single-use replay protection persisted in DB (never in server memory)
  const replay = await checkPersistentRateLimit(`bot_nonce:${nonce}`, 1, BOT_CHALLENGE_TTL_SEC + 60);
  if (!replay.allowed) {
    return { ok: false, error: 'Security check already used. Please submit again.' };
  }

  return { ok: true };
}
