import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { HttpError, bad } from '../lib/http.js';

const handler = (_req: Request, res: Response) =>
  res.status(429).json({ error: { message: 'Too many requests. Please slow down and try again shortly.', code: 'rate_limited' } });

const keyByUser = (req: Request) => req.user?.id ?? req.ip ?? 'anon';
const relaxed = process.env.RATE_LIMIT_RELAXED === 'true' && !config.isProd; // for automated local tests only

const mk = (windowMs: number, limit: number, byUser = false) =>
  rateLimit({ windowMs, limit: relaxed ? limit * 100 : limit, standardHeaders: 'draft-7', legacyHeaders: false, handler, keyGenerator: byUser ? keyByUser : undefined });

export const apiLimiter = mk(60_000, 300);
export const authLimiter = mk(15 * 60_000, 20);
export const registerLimiter = mk(60 * 60_000, 8);
export const emailLimiter = mk(60 * 60_000, 6);
export const writeLimiter = mk(60_000, 40, true);
export const uploadLimiter = mk(10 * 60_000, 40, true);
export const reportLimiter = mk(60 * 60_000, 15, true);

/** Simple per-user sliding window used for chat (limit is admin-configurable). */
const buckets = new Map<string, number[]>();
export function allowAction(key: string, perMinute: number): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < 60_000);
  if (arr.length >= (relaxed ? perMinute * 100 : perMinute)) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}

/** Cloudflare Turnstile verification. Skipped only when no secret is configured. */
export async function verifyCaptcha(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!config.captcha.secret) return next();
    const token = req.body?.captcha_token;
    if (typeof token !== 'string' || !token) throw bad('Please complete the CAPTCHA.', 'captcha_required');
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: config.captcha.secret, response: token, remoteip: req.ip ?? '' }),
    });
    const data = (await r.json()) as { success?: boolean };
    if (!data.success) throw bad('CAPTCHA verification failed. Please try again.', 'captcha_failed');
    next();
  } catch (e) {
    next(e instanceof HttpError ? e : bad('CAPTCHA verification failed.', 'captcha_failed'));
  }
}
