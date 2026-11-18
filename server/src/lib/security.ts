import argon2 from 'argon2';
import crypto from 'node:crypto';

// Argon2id with OWASP-recommended parameters (19 MiB, 2 iterations).
const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (pw: string) => argon2.hash(pw, ARGON_OPTS);

export async function verifyPassword(hash: string, pw: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, pw);
  } catch {
    return false;
  }
}

/** Random URL-safe token; only its SHA-256 is stored server-side. */
export function newToken(bytes = 32): { token: string; hash: string } {
  const token = crypto.randomBytes(bytes).toString('base64url');
  return { token, hash: sha256(token) };
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** Password policy: 8–128 chars, at least one letter and one number. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 128) return 'Password is too long.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must include letters and numbers.';
  return null;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'item';
}

/** Escape text for safe interpolation into HTML (emails, server-rendered meta tags). */
export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
