import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { one, q } from '../db.js';
import { config } from '../config.js';
import { forbidden, HttpError } from '../lib/http.js';
import { newToken, sha256 } from '../lib/security.js';
import type { AuthUser } from '../types.js';

export const SESSION_COOKIE = 'mk_sid';
export const CSRF_COOKIE = 'mk_csrf';

const cookieBase = {
  sameSite: 'lax' as const,
  secure: config.isProd,
  path: '/',
};

export async function loadUserBySessionHash(hash: string): Promise<AuthUser | null> {
  const row = await one<any>(
    `SELECT u.id, u.email, u.role, u.status, u.email_verified_at,
            p.full_name, p.phone, p.avatar_path, p.location,
            is_active_seller(u.id) AS is_seller, s.last_used_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id AND u.deleted_at IS NULL
       LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE s.id_hash = $1 AND s.expires_at > now()`,
    [hash],
  );
  if (!row) return null;
  // Banned users lose access immediately, even with a live session.
  if (row.status === 'banned') return null;
  if (Date.now() - new Date(row.last_used_at).getTime() > 5 * 60_000) {
    q('UPDATE sessions SET last_used_at = now() WHERE id_hash = $1', [hash]).catch(() => {});
    q('UPDATE users SET last_seen_at = now() WHERE id = $1', [row.id]).catch(() => {});
  }
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    full_name: row.full_name ?? '',
    phone: row.phone ?? '',
    avatar_path: row.avatar_path,
    location: row.location,
    email_verified: !!row.email_verified_at,
    is_seller: !!row.is_seller,
    session_hash: hash,
  };
}

/** Attach req.user when a valid session cookie is present. Never throws for anonymous visitors. */
export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string' && token.length > 20) {
      req.user = (await loadUserBySessionHash(sha256(token))) ?? undefined;
    }
    next();
  } catch (e) {
    next(e);
  }
}

export async function createSession(res: Response, userId: string, req: Request) {
  const { token, hash } = newToken(32);
  const expires = new Date(Date.now() + config.sessionDays * 86400_000);
  await q('INSERT INTO sessions (id_hash, user_id, ip, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5)', [
    hash,
    userId,
    req.ip,
    String(req.headers['user-agent'] ?? '').slice(0, 300),
    expires,
  ]);
  res.cookie(SESSION_COOKIE, token, { ...cookieBase, httpOnly: true, expires });
}

export function clearSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { ...cookieBase, httpOnly: true });
}

/**
 * CSRF protection (double-submit cookie). The session cookie is SameSite=Lax and httpOnly;
 * every state-changing request must also echo the readable CSRF cookie in a header,
 * which a cross-site page cannot do.
 */
export function csrf(req: Request, res: Response, next: NextFunction) {
  let token = req.cookies?.[CSRF_COOKIE];
  if (typeof token !== 'string' || token.length < 20) {
    token = crypto.randomBytes(24).toString('base64url');
    res.cookie(CSRF_COOKIE, token, { ...cookieBase, httpOnly: false, maxAge: 7 * 86400_000 });
  }
  const safe = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
  // Gateway webhooks are authenticated by signature, not by cookie.
  if (safe || req.path.startsWith('/api/webhooks/')) return next();
  const header = req.get('x-csrf-token');
  if (!header || header !== req.cookies?.[CSRF_COOKIE]) {
    return next(new HttpError(403, 'Your session expired. Please refresh the page and try again.', 'csrf'));
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Please log in to continue.', 'unauthenticated'));
  if (req.user.status === 'suspended' && req.method !== 'GET' && !req.path.startsWith('/auth')) {
    return next(forbidden('Your account is suspended.', 'account_suspended'));
  }
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Please log in to continue.', 'unauthenticated'));
  if (req.user.role !== 'admin' || req.user.status !== 'approved') return next(forbidden());
  next();
}

export function requireVerifiedEmail(req: Request, _res: Response, next: NextFunction) {
  if (!req.user?.email_verified) return next(forbidden('Please verify your email address first.', 'email_unverified'));
  next();
}

/** Buyers: verified email AND admin-approved account. */
export function requireChatAccess(req: Request, _res: Response, next: NextFunction) {
  const u = req.user;
  if (!u) return next(new HttpError(401, 'Please log in to continue.', 'unauthenticated'));
  if (!u.email_verified) return next(forbidden('Please verify your email address first.', 'email_unverified'));
  if (u.status !== 'approved') return next(forbidden('Your account is awaiting administrator approval for messaging.', 'not_approved'));
  next();
}

/** Sellers: active paid authorization, re-checked in the database on every call. */
export async function requireSeller(req: Request, _res: Response, next: NextFunction) {
  try {
    const u = req.user;
    if (!u) throw new HttpError(401, 'Please log in to continue.', 'unauthenticated');
    const row = await one<{ ok: boolean }>('SELECT is_active_seller($1) AS ok', [u.id]);
    if (!row?.ok) throw forbidden('You need an active seller authorization to manage listings.', 'not_seller');
    next();
  } catch (e) {
    next(e);
  }
}
