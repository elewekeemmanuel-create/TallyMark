import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db, runTransaction } from './db.ts';
import type { UserProfile } from '../shared/types.ts';

export const SESSION_COOKIE_NAME = 'tm_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const MAGIC_LINK_TTL_MS = 1000 * 60 * 15; // 15 minutes

const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');
function getSessionSecret(): string {
  return process.env.SESSION_SECRET || EPHEMERAL_SECRET;
}

export function hashToken(token: string): string {
  return crypto.createHmac('sha256', getSessionSecret()).update(token).digest('hex');
}

export function createSessionForUser(userId: string): { token: string; expiresAt: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    tokenHash,
    userId,
    expiresAt,
    now.toISOString()
  );
  return { token, expiresAt };
}

export function setSessionCookie(res: Response, token: string, expiresAt: string) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
  });
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !storedHash.startsWith('scrypt:')) return false;
  const parts = storedHash.split(':');
  if (parts.length !== 3) return false;
  const [, salt, hex] = parts;
  const expected = Buffer.from(hex, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function registerPasswordUser(params: {
  name: string;
  email: string;
  password: string;
}): { ok: true; user: UserProfile } | { ok: false; code: 'DUPLICATE_EMAIL' } {
  const email = params.email.trim().toLowerCase();
  const displayName = params.name.trim() || email;
  const passwordHash = hashPassword(params.password);

  return runTransaction(() => {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
    if (existing) {
      return { ok: false as const, code: 'DUPLICATE_EMAIL' as const };
    }
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare(
      'INSERT INTO users (id, email, name, auth_provider, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, email, displayName, 'password', passwordHash, createdAt);
    return {
      ok: true as const,
      user: {
        id,
        email,
        name: displayName,
        authProvider: 'password' as const,
        createdAt,
      },
    };
  });
}

export function authenticatePasswordUser(params: {
  email: string;
  password: string;
}): UserProfile | null {
  const email = params.email.trim().toLowerCase();
  const row = db
    .prepare('SELECT id, email, name, auth_provider, password_hash, created_at FROM users WHERE email = ?')
    .get(email) as
    | {
        id: string;
        email: string;
        name: string;
        auth_provider: 'password' | 'google' | 'magic_link';
        password_hash: string | null;
        created_at: string;
      }
    | undefined;

  if (!row || !verifyPassword(params.password, row.password_hash)) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name || row.email,
    authProvider: row.auth_provider,
    createdAt: row.created_at,
  };
}

export function upsertUser(params: {
  email: string;
  name?: string;
  authProvider: 'password' | 'google' | 'magic_link';
}): UserProfile {
  const email = params.email.trim().toLowerCase();
  const fallbackName = email.split('@')[0] || 'Business Owner';
  const displayName = (params.name || '').trim() || fallbackName;

  return runTransaction(() => {
    const existing = db
      .prepare('SELECT id, email, name, auth_provider, created_at FROM users WHERE email = ?')
      .get(email) as
      | { id: string; email: string; name: string; auth_provider: 'password' | 'google' | 'magic_link'; created_at: string }
      | undefined;

    if (existing) {
      if (params.name && params.name.trim() && params.name.trim() !== existing.name) {
        db.prepare('UPDATE users SET name = ? WHERE id = ?').run(displayName, existing.id);
      }
      return {
        id: existing.id,
        email: existing.email,
        name: params.name?.trim() || existing.name,
        authProvider: existing.auth_provider,
        createdAt: existing.created_at,
      };
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare('INSERT INTO users (id, email, name, auth_provider, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      email,
      displayName,
      params.authProvider,
      createdAt
    );

    return {
      id,
      email,
      name: displayName,
      authProvider: params.authProvider,
      createdAt,
    };
  });
}

export function createMagicLinkToken(email: string, name?: string): { token: string; expiresAt: string } {
  const token = crypto.randomBytes(24).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS).toISOString();
  db.prepare('INSERT INTO magic_links (token_hash, email, name, expires_at) VALUES (?, ?, ?, ?)').run(
    tokenHash,
    email.trim().toLowerCase(),
    (name || '').trim(),
    expiresAt
  );
  return { token, expiresAt };
}

export function consumeMagicLinkToken(token: string): UserProfile | null {
  const tokenHash = hashToken(token);
  return runTransaction(() => {
    const row = db
      .prepare('SELECT token_hash, email, name, expires_at, used_at FROM magic_links WHERE token_hash = ?')
      .get(tokenHash) as
      | { token_hash: string; email: string; name: string; expires_at: string; used_at: string | null }
      | undefined;

    if (!row || row.used_at) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;

    db.prepare('UPDATE magic_links SET used_at = ? WHERE token_hash = ?').run(new Date().toISOString(), tokenHash);
    return upsertUser({
      email: row.email,
      name: row.name || undefined,
      authProvider: 'magic_link',
    });
  });
}

export interface AuthenticatedRequest extends Request {
  user?: UserProfile;
  sessionTokenHash?: string;
  isSupabaseUser?: boolean;
  supabaseAccessToken?: string;
}

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const raw = authHeader.slice(7).trim();
    if (raw) return raw;
  }
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.trim()) {
    return cookieToken.trim();
  }
  return null;
}

function lookupSqliteSession(token: string): { user: UserProfile; tokenHash: string } | { expired: true } | null {
  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT s.token_hash, s.expires_at, u.id, u.email, u.name, u.auth_provider, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(tokenHash) as
    | {
        token_hash: string;
        expires_at: string;
        id: string;
        email: string;
        name: string;
        auth_provider: 'password' | 'google' | 'magic_link';
        created_at: string;
      }
    | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return { expired: true };
  }

  return {
    tokenHash,
    user: {
      id: row.id,
      email: row.email,
      name: row.name || row.email,
      authProvider: row.auth_provider,
      createdAt: row.created_at,
    },
  };
}

function cleanServerEnv(raw: string | undefined): string {
  if (!raw) return '';
  return raw.trim().replace(/^["']+|["']+$/g, '').trim();
}

function normalizeServerUrl(raw: string | undefined): string {
  const cleaned = cleanServerEnv(raw);
  if (!cleaned) return '';
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

export async function verifySupabaseJwt(token: string): Promise<UserProfile | null> {
  const supaUrl = normalizeServerUrl(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL);
  const supaKey = cleanServerEnv(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_ANON_KEY
  );
  if (!supaUrl || !supaKey) return null;
  try {
    const res = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: {
        apikey: supaKey,
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    if (!data?.id) return null;
    const email = String(data.email || '');
    const fullName = String(data.user_metadata?.full_name || data.user_metadata?.name || '').trim();
    return {
      id: String(data.id),
      email,
      name: fullName || email,
      authProvider: data.app_metadata?.provider === 'google' ? 'google' : 'password',
      createdAt: String(data.created_at || new Date().toISOString()),
    };
  } catch {
    return null;
  }
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const found = lookupSqliteSession(token);
  if (!found) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }
  if ('expired' in found) {
    res.status(401).json({ error: 'Session expired' });
    return;
  }

  req.user = found.user;
  req.sessionTokenHash = found.tokenHash;
  next();
}

export async function requireAnyAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const found = lookupSqliteSession(token);
  if (found && !('expired' in found)) {
    req.user = found.user;
    req.sessionTokenHash = found.tokenHash;
    next();
    return;
  }
  if (found && 'expired' in found) {
    res.status(401).json({ error: 'Session expired' });
    return;
  }

  const supaUser = await verifySupabaseJwt(token);
  if (supaUser) {
    req.user = supaUser;
    req.isSupabaseUser = true;
    req.supabaseAccessToken = token;
    next();
    return;
  }

  res.status(401).json({ error: 'Invalid or expired session' });
}
