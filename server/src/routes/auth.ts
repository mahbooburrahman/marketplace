import { Router } from 'express';
import { z } from 'zod';
import { one, q, tx } from '../db.js';
import { config } from '../config.js';
import { ah, bad, parse, HttpError } from '../lib/http.js';
import { hashPassword, newToken, passwordProblem, sha256, verifyPassword } from '../lib/security.js';
import { sendMail } from '../lib/mailer.js';
import { notify } from '../lib/notify.js';
import { audit } from '../lib/audit.js';
import { clearSession, createSession, requireAuth } from '../middleware/auth.js';
import { authLimiter, emailLimiter, registerLimiter, verifyCaptcha } from '../middleware/limits.js';
import { publicUrl } from '../lib/storage.js';

const r = Router();

const VERIFY_TTL_H = 24;
const RESET_TTL_MIN = 60;
const MAX_FAILED = 5;
const dummyHash = hashPassword('timing-equaliser-0');
const LOCK_MIN = 15;

const email = z.string().trim().toLowerCase().email('Enter a valid email address.').max(254);
const password = z.string().superRefine((v, ctx) => {
  const p = passwordProblem(v);
  if (p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: p });
});

async function issueEmailToken(userId: string, purpose: 'verify_email' | 'reset_password', ttlMs: number) {
  // Invalidate earlier unused tokens of the same purpose
  await q('UPDATE email_tokens SET used_at = now() WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL', [userId, purpose]);
  const { token, hash } = newToken(32);
  await q('INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1,$2,$3,$4)', [
    userId, purpose, hash, new Date(Date.now() + ttlMs),
  ]);
  return token;
}

async function sendVerification(userId: string, to: string, name: string) {
  const token = await issueEmailToken(userId, 'verify_email', VERIFY_TTL_H * 3600_000);
  await sendMail({
    to,
    subject: 'Verify your email address',
    heading: `Welcome, ${name}!`,
    lines: [
      'Thanks for registering. Please confirm your email address to continue.',
      `This link expires in ${VERIFY_TTL_H} hours.`,
      'Once you verify, you can message sellers right away.',
    ],
    cta: { label: 'Verify email', url: `${config.appUrl}/verify-email?token=${token}` },
  });
}

export function serializeMe(u: NonNullable<Express.Request['user']>) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    status: u.status,
    full_name: u.full_name,
    phone: u.phone,
    location: u.location,
    avatar_url: publicUrl(u.avatar_path),
    email_verified: u.email_verified,
    is_seller: u.is_seller,
    can_chat: u.email_verified && u.status === 'approved',
  };
}

r.post(
  '/register',
  registerLimiter,
  verifyCaptcha,
  ah(async (req, res) => {
    const body = parse(
      z
        .object({
          full_name: z.string().trim().min(2, 'Enter your full name.').max(80),
          email,
          phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid mobile number.'),
          password,
          confirm_password: z.string(),
          accept_terms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms and conditions.' }) }),
        })
        .refine((b) => b.password === b.confirm_password, { message: 'Passwords do not match.', path: ['confirm_password'] }),
      req.body,
    );

    const existing = await one<{ id: string; email_verified_at: string | null }>(
      'SELECT id, email_verified_at FROM users WHERE lower(email)=lower($1)', [body.email],
    );
    if (existing) {
      // Same response either way so the form cannot be used to discover registered emails.
      if (!existing.email_verified_at) {
        const p = await one<{ full_name: string }>('SELECT full_name FROM user_profiles WHERE user_id=$1', [existing.id]);
        await sendVerification(existing.id, body.email, p?.full_name ?? 'there');
      } else {
        await sendMail({
          to: body.email,
          subject: 'Registration attempt',
          heading: 'Someone tried to register with your email',
          lines: ['An account with this email already exists. If this was you, log in or reset your password.'],
          cta: { label: 'Log in', url: `${config.appUrl}/login` },
        });
      }
      return res.status(201).json({ message: 'Check your inbox for a verification link to finish registering.' });
    }

    const hash = await hashPassword(body.password);
    const user = await tx(async (c) => {
      const u = await one<{ id: string }>(
        `INSERT INTO users (email, password_hash, terms_accepted_at) VALUES ($1,$2,now()) RETURNING id`,
        [body.email, hash], c,
      );
      await q('INSERT INTO user_profiles (user_id, full_name, phone) VALUES ($1,$2,$3)', [u!.id, body.full_name, body.phone], c);
      return u!;
    });
    await audit(req, 'user.registered', { type: 'user', id: user.id });
    await sendVerification(user.id, body.email, body.full_name);
    res.status(201).json({ message: 'Check your inbox for a verification link to finish registering.' });
  }),
);

r.post(
  '/verify-email',
  authLimiter,
  ah(async (req, res) => {
    const { token } = parse(z.object({ token: z.string().min(20).max(200) }), req.body);
    const row = await one<any>(
      `SELECT t.id, t.user_id, t.expires_at, t.used_at, u.status, u.email, p.full_name
         FROM email_tokens t JOIN users u ON u.id=t.user_id LEFT JOIN user_profiles p ON p.user_id=u.id
        WHERE t.token_hash=$1 AND t.purpose='verify_email'`,
      [sha256(token)],
    );
    if (!row || row.used_at) throw bad('This verification link is invalid or has already been used.', 'invalid_token');
    if (new Date(row.expires_at) < new Date()) throw bad('This verification link has expired. Request a new one.', 'expired_token');

    await tx(async (c) => {
      await q('UPDATE email_tokens SET used_at=now() WHERE id=$1', [row.id], c);
      await q(
        `UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()),
                status = CASE WHEN status='email_unverified' THEN 'approved'::user_status ELSE status END,
                approved_at = CASE WHEN status='email_unverified' THEN now() ELSE approved_at END,
                updated_at = now()
          WHERE id=$1`,
        [row.user_id], c,
      );
    });
    await audit(req, 'user.email_verified', { type: 'user', id: row.user_id });
    if (row.status === 'email_unverified') {
      await notify({
        userId: row.user_id,
        type: 'account.verified',
        title: 'Email verified',
        body: 'Your account is active. You can now message sellers.',
        link: '/dashboard',
      });
    }
    res.json({ message: 'Email verified. Your account is active, so you can now log in and message sellers.' });
  }),
);

r.post(
  '/resend-verification',
  emailLimiter,
  ah(async (req, res) => {
    const body = parse(z.object({ email }), req.body);
    const u = await one<any>(
      `SELECT u.id, u.email, p.full_name FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id
        WHERE lower(u.email)=lower($1) AND u.email_verified_at IS NULL AND u.deleted_at IS NULL`,
      [body.email],
    );
    if (u) await sendVerification(u.id, u.email, u.full_name ?? 'there');
    res.json({ message: 'If that account needs verification, a new link is on its way.' });
  }),
);

r.post(
  '/login',
  authLimiter,
  ah(async (req, res) => {
    const body = parse(z.object({ email, password: z.string().min(1).max(200) }), req.body);
    const u = await one<any>(
      'SELECT id, password_hash, status, status_reason, failed_logins, locked_until, role FROM users WHERE lower(email)=lower($1) AND deleted_at IS NULL',
      [body.email],
    );
    const invalid = new HttpError(401, 'Incorrect email or password.', 'invalid_credentials');
    if (!u || u.role === 'system') {
      await verifyPassword(await dummyHash, body.password); // equalise timing so unknown emails aren't detectable
      throw invalid;
    }
    if (u.locked_until && new Date(u.locked_until) > new Date()) {
      throw new HttpError(429, `Too many failed attempts. Try again in ${LOCK_MIN} minutes or reset your password.`, 'locked');
    }
    if (!(await verifyPassword(u.password_hash, body.password))) {
      const fails = u.failed_logins + 1;
      await q('UPDATE users SET failed_logins=$2, locked_until=$3 WHERE id=$1', [
        u.id, fails >= MAX_FAILED ? 0 : fails, fails >= MAX_FAILED ? new Date(Date.now() + LOCK_MIN * 60_000) : null,
      ]);
      if (fails >= MAX_FAILED) await audit(req, 'user.locked_out', { type: 'user', id: u.id });
      throw invalid;
    }
    if (u.status === 'banned') {
      throw new HttpError(403, 'This account has been banned.' + (u.status_reason ? ` Reason: ${u.status_reason}` : ''), 'account_banned');
    }
    await q('UPDATE users SET failed_logins=0, locked_until=NULL, last_seen_at=now() WHERE id=$1', [u.id]);
    await createSession(res, u.id, req);
    await audit(req, 'user.login', { type: 'user', id: u.id }, {}, undefined, u.id);
    res.json({ ok: true });
  }),
);

r.post(
  '/logout',
  ah(async (req, res) => {
    if (req.user) await q('DELETE FROM sessions WHERE id_hash=$1', [req.user.session_hash]);
    clearSession(res);
    res.json({ ok: true });
  }),
);

r.post(
  '/forgot-password',
  emailLimiter,
  ah(async (req, res) => {
    const body = parse(z.object({ email }), req.body);
    const u = await one<any>(
      `SELECT u.id, u.email, p.full_name FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id
        WHERE lower(u.email)=lower($1) AND u.deleted_at IS NULL AND u.role <> 'system' AND u.status <> 'banned'`,
      [body.email],
    );
    if (u) {
      const token = await issueEmailToken(u.id, 'reset_password', RESET_TTL_MIN * 60_000);
      await sendMail({
        to: u.email,
        subject: 'Reset your password',
        heading: 'Password reset requested',
        lines: [`Use the button below to choose a new password. The link expires in ${RESET_TTL_MIN} minutes.`, "If you didn't request this, you can ignore this email."],
        cta: { label: 'Reset password', url: `${config.appUrl}/reset-password?token=${token}` },
      });
    }
    res.json({ message: 'If an account exists for that email, a reset link has been sent.' });
  }),
);

r.post(
  '/reset-password',
  authLimiter,
  ah(async (req, res) => {
    const body = parse(
      z.object({ token: z.string().min(20).max(200), password, confirm_password: z.string() })
        .refine((b) => b.password === b.confirm_password, { message: 'Passwords do not match.', path: ['confirm_password'] }),
      req.body,
    );
    const row = await one<any>(
      `SELECT id, user_id, expires_at, used_at FROM email_tokens WHERE token_hash=$1 AND purpose='reset_password'`,
      [sha256(body.token)],
    );
    if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
      throw bad('This reset link is invalid or has expired. Request a new one.', 'invalid_token');
    }
    const hash = await hashPassword(body.password);
    await tx(async (c) => {
      await q('UPDATE email_tokens SET used_at=now() WHERE id=$1', [row.id], c);
      await q('UPDATE users SET password_hash=$2, failed_logins=0, locked_until=NULL, updated_at=now() WHERE id=$1', [row.user_id, hash], c);
      await q('DELETE FROM sessions WHERE user_id=$1', [row.user_id], c); // sign out everywhere
    });
    await audit(req, 'user.password_reset', { type: 'user', id: row.user_id });
    res.json({ message: 'Your password has been reset. You can now log in.' });
  }),
);

r.post(
  '/change-password',
  requireAuth,
  ah(async (req, res) => {
    const body = parse(
      z.object({ current_password: z.string().min(1), password, confirm_password: z.string() })
        .refine((b) => b.password === b.confirm_password, { message: 'Passwords do not match.', path: ['confirm_password'] }),
      req.body,
    );
    const u = await one<any>('SELECT password_hash FROM users WHERE id=$1', [req.user!.id]);
    if (!u || !(await verifyPassword(u.password_hash, body.current_password))) {
      throw bad('Your current password is incorrect.', 'validation_error', { current_password: 'Incorrect password.' });
    }
    await q('UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1', [req.user!.id, await hashPassword(body.password)]);
    await q('DELETE FROM sessions WHERE user_id=$1 AND id_hash <> $2', [req.user!.id, req.user!.session_hash]);
    await audit(req, 'user.password_changed', { type: 'user', id: req.user!.id });
    res.json({ message: 'Password updated. Other devices have been signed out.' });
  }),
);

r.get(
  '/me',
  ah(async (req, res) => {
    if (!req.user) return res.json({ user: null });
    const counts = await one<any>(
      `SELECT
         (SELECT count(*)::int FROM notifications WHERE user_id=$1 AND read_at IS NULL) AS unread_notifications,
         (SELECT count(*)::int FROM messages m
            JOIN conversation_participants cp ON cp.conversation_id=m.conversation_id AND cp.user_id=$1
           WHERE m.sender_id <> $1 AND m.created_at > cp.last_read_at AND m.deleted_at IS NULL) AS unread_messages`,
      [req.user.id],
    );
    res.json({ user: serializeMe(req.user), counts });
  }),
);

export default r;
