import { Router } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { one, q, tx } from '../db.js';
import { ah, bad, conflict, forbidden, notFound, pageParams, parse, uuid } from '../lib/http.js';
import { requireAdmin } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { sendMail } from '../lib/mailer.js';
import { getSettings, invalidateSettings } from '../lib/settings.js';
import { imageUpload, processImage, publicUrl, removeFile } from '../lib/storage.js';
import { activateSubscription, grantSellerPermissions, revokeSellerPrivileges } from '../lib/subscriptions.js';
import { contentHash, CONDITIONS, likeEscape } from '../lib/listings.js';
import { slugify } from '../lib/security.js';
import { loadMessages } from './chat.js';
import { loadListingDetail } from './listings.js';

const r = Router();
r.use(requireAdmin);

const note = z.string().trim().max(2000).optional();
const requiredNote = (msg: string) => z.string().trim().min(3, msg).max(2000);

/* ============================== OVERVIEW ============================== */

r.get(
  '/overview',
  ah(async (_req, res) => {
    const stats = await one<any>(`
      SELECT
        (SELECT count(*)::int FROM users WHERE role='user' AND deleted_at IS NULL) AS total_users,
        (SELECT count(*)::int FROM users WHERE role='user' AND email_verified_at IS NOT NULL AND deleted_at IS NULL) AS verified_users,
        (SELECT count(*)::int FROM users WHERE role='user' AND status='pending_approval') AS pending_users,
        (SELECT count(*)::int FROM users WHERE role='user' AND status='approved') AS approved_users,
        (SELECT count(*)::int FROM users WHERE role='user' AND status IN ('suspended','banned')) AS suspended_users,
        (SELECT count(*)::int FROM seller_requests WHERE status IN ('pending','info_requested')) AS seller_requests,
        (SELECT count(DISTINCT user_id)::int FROM seller_subscriptions WHERE status='active' AND expires_at > now()) AS active_sellers,
        (SELECT count(*)::int FROM payments WHERE status IN ('under_review','pending')) AS pending_payments,
        (SELECT COALESCE(sum(amount),0) FROM payments WHERE status='verified' AND refund_status <> 'refunded' AND method <> 'admin_waiver') AS total_revenue,
        (SELECT count(*)::int FROM listings WHERE status='pending_approval' AND deleted_at IS NULL) AS pending_listings,
        (SELECT count(*)::int FROM listings WHERE status='published' AND deleted_at IS NULL) AS published_listings,
        (SELECT count(*)::int FROM listings WHERE status IN ('rejected','changes_requested') AND deleted_at IS NULL) AS rejected_listings,
        (SELECT count(DISTINCT target_id)::int FROM reports WHERE target_type='listing' AND status IN ('open','investigating')) AS reported_listings,
        (SELECT count(*)::int FROM reports WHERE status IN ('open','investigating')) AS open_reports,
        (SELECT count(DISTINCT conversation_id)::int FROM messages WHERE created_at > now() - interval '30 days') AS active_conversations
    `);
    const revenue = await q(
      `SELECT to_char(date_trunc('month', verified_at), 'YYYY-MM') AS month, currency, sum(amount) AS total
         FROM payments WHERE status='verified' AND method <> 'admin_waiver' AND refund_status <> 'refunded' AND verified_at > now() - interval '12 months'
        GROUP BY 1, 2 ORDER BY 1`,
    );
    const activity = await q(
      `SELECT a.id, a.action, a.target_type, a.target_id, a.meta, a.created_at, p.full_name AS actor_name
         FROM activity_logs a LEFT JOIN user_profiles p ON p.user_id=a.actor_id ORDER BY a.created_at DESC LIMIT 12`,
    );
    res.json({ stats, revenue, activity });
  }),
);

/* ============================== USERS ============================== */

r.get(
  '/users',
  ah(async (req, res) => {
    const { page, limit, offset } = pageParams(req.query, 100);
    const params: unknown[] = [];
    const p = (v: unknown) => (params.push(v), `$${params.length}`);
    const where = [`u.deleted_at IS NULL`, `u.role <> 'system'`];
    if (typeof req.query.status === 'string' && req.query.status) where.push(`u.status = ${p(req.query.status)}::user_status`);
    if (typeof req.query.role === 'string' && req.query.role) where.push(`u.role = ${p(req.query.role)}`);
    if (req.query.sellers === '1') where.push(`is_active_seller(u.id)`);
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      const like = p(`%${likeEscape(req.query.q.trim())}%`);
      where.push(`(u.email ILIKE ${like} OR pr.full_name ILIKE ${like} OR pr.phone ILIKE ${like})`);
    }
    const rows = await q<any>(
      `SELECT u.id, u.email, u.role, u.status, u.email_verified_at, u.created_at, u.last_seen_at,
              pr.full_name, pr.phone, pr.location, is_active_seller(u.id) AS is_seller, count(*) OVER()::int AS total
         FROM users u LEFT JOIN user_profiles pr ON pr.user_id=u.id
        WHERE ${where.join(' AND ')} ORDER BY u.created_at DESC LIMIT ${p(limit)} OFFSET ${p(offset)}`,
      params,
    );
    const total = rows[0]?.total ?? 0;
    res.json({ items: rows.map(({ total: _t, ...x }) => x), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  }),
);

r.get(
  '/users/:id',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const user = await one<any>(
      `SELECT u.id, u.email, u.role, u.status, u.status_reason, u.email_verified_at, u.approved_at, u.created_at, u.last_seen_at,
              pr.full_name, pr.phone, pr.location, pr.bio, pr.avatar_path, is_active_seller(u.id) AS is_seller,
              ap.full_name AS approved_by_name
         FROM users u LEFT JOIN user_profiles pr ON pr.user_id=u.id LEFT JOIN user_profiles ap ON ap.user_id=u.approved_by
        WHERE u.id=$1 AND u.role <> 'system'`,
      [id],
    );
    if (!user) throw notFound('User not found.');
    const [permissions, subscriptions, payments, requests, listingCounts, activity, reports] = await Promise.all([
      q(`SELECT permission_code, granted_at, expires_at FROM user_permissions WHERE user_id=$1`, [id]),
      q(`SELECT * FROM seller_subscriptions WHERE user_id=$1 ORDER BY created_at DESC`, [id]),
      q(`SELECT id, amount, currency, method, status, refund_status, reference_number, created_at FROM payments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [id]),
      q(`SELECT id, status, message, admin_note, created_at FROM seller_requests WHERE user_id=$1 ORDER BY created_at DESC`, [id]),
      q(`SELECT status, count(*)::int AS n FROM listings WHERE seller_id=$1 AND deleted_at IS NULL GROUP BY status`, [id]),
      q(`SELECT a.action, a.target_type, a.target_id, a.meta, a.created_at, a.ip, p.full_name AS actor_name
           FROM activity_logs a LEFT JOIN user_profiles p ON p.user_id=a.actor_id
          WHERE a.actor_id=$1 OR (a.target_type='user' AND a.target_id=$2) ORDER BY a.created_at DESC LIMIT 50`, [id, id]),
      q(`SELECT id, reason, status, details, created_at FROM reports WHERE target_type='user' AND target_id=$1 ORDER BY created_at DESC`, [id]),
    ]);
    res.json({ user: { ...user, avatar_url: publicUrl(user.avatar_path) }, permissions, subscriptions, payments, requests, listing_counts: listingCounts, activity, reports });
  }),
);

const STATUS_EMAIL: Record<string, { title: string; line: string }> = {
  approve: { title: 'Your account has been approved', line: 'Your account has been approved for buyer communication. You can now contact sellers.' },
  reject: { title: 'Your account application was not approved', line: 'Unfortunately your account was not approved for messaging.' },
  suspend: { title: 'Your account has been suspended', line: 'Your account has been suspended. You cannot post or send messages while suspended.' },
  ban: { title: 'Your account has been banned', line: 'Your account has been permanently banned from the platform.' },
  restore: { title: 'Your account has been restored', line: 'Your account has been restored.' },
};

r.post(
  '/users/:id/status',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const body = parse(z.object({ action: z.enum(['approve', 'reject', 'suspend', 'ban', 'restore']), reason: note }), req.body);
    if (id === req.user!.id) throw forbidden('You cannot change your own account status.');
    const u = await one<any>(`SELECT id, role, status, email_verified_at FROM users WHERE id=$1 AND deleted_at IS NULL AND role <> 'system'`, [id]);
    if (!u) throw notFound('User not found.');
    if (u.role === 'admin') throw forbidden('Change the role to user before moderating an administrator.');
    if ((body.action === 'reject' || body.action === 'suspend' || body.action === 'ban') && !body.reason) {
      throw bad('Please give a reason — it is shown to the user.', 'validation_error', { reason: 'A reason is required.' });
    }

    let next: string;
    switch (body.action) {
      case 'approve':
        if (!u.email_verified_at) throw bad('This user has not verified their email yet.');
        if (u.status === 'banned') throw bad('Restore the account before approving it.');
        next = 'approved';
        break;
      case 'reject':
        next = 'rejected';
        break;
      case 'suspend':
        next = 'suspended';
        break;
      case 'ban':
        next = 'banned';
        break;
      default:
        next = u.email_verified_at ? 'approved' : 'email_unverified';
    }
    await tx(async (c) => {
      await q(
        `UPDATE users SET status=$2::user_status, status_reason=$3, updated_at=now(),
                approved_at = CASE WHEN $2='approved' THEN now() ELSE approved_at END,
                approved_by = CASE WHEN $2='approved' THEN $4::uuid ELSE approved_by END
          WHERE id=$1`,
        [id, next, body.action === 'approve' || body.action === 'restore' ? null : body.reason ?? null, req.user!.id], c,
      );
      if (next === 'banned') {
        await q('DELETE FROM sessions WHERE user_id=$1', [id], c);
        await revokeSellerPrivileges(c, id, 'suspended');
        await q(`UPDATE seller_subscriptions SET status='revoked', revoked_reason='Account banned' WHERE user_id=$1 AND status IN ('active','awaiting_payment','payment_review')`, [id], c);
      }
      await audit(req, `user.${body.action}`, { type: 'user', id }, { from: u.status, to: next, reason: body.reason }, c);
    });
    const m = STATUS_EMAIL[body.action];
    await notify({
      userId: id,
      type: `account.${body.action}`,
      title: m.title,
      body: body.reason ? `${m.line} Reason: ${body.reason}` : m.line,
      link: '/dashboard/status',
      email: { lines: [m.line, ...(body.reason ? [`Reason: ${body.reason}`] : [])], cta: 'View account status' },
    });
    res.json({ status: next });
  }),
);

r.post(
  '/users/:id/role',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const { role } = parse(z.object({ role: z.enum(['user', 'admin']) }), req.body);
    if (id === req.user!.id) throw forbidden('You cannot change your own role.');
    const u = await one<any>(`SELECT role, status, email_verified_at FROM users WHERE id=$1 AND role <> 'system' AND deleted_at IS NULL`, [id]);
    if (!u) throw notFound('User not found.');
    if (role === 'admin' && (u.status !== 'approved' || !u.email_verified_at)) throw bad('Only verified, approved accounts can be made administrators.');
    await q('UPDATE users SET role=$2, updated_at=now() WHERE id=$1', [id, role]);
    await audit(req, 'user.role_changed', { type: 'user', id }, { from: u.role, to: role });
    res.json({ role });
  }),
);

/* ============================== SELLERS ============================== */

r.get(
  '/seller-requests',
  ah(async (req, res) => {
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
    const rows = await q(
      `SELECT sr.*, p.full_name, p.phone, u.email, u.status AS user_status, u.created_at AS user_since, rv.full_name AS reviewed_by_name
         FROM seller_requests sr JOIN users u ON u.id=sr.user_id LEFT JOIN user_profiles p ON p.user_id=sr.user_id
         LEFT JOIN user_profiles rv ON rv.user_id=sr.reviewed_by
        WHERE ($1::seller_request_status IS NULL AND sr.status IN ('pending','info_requested')) OR sr.status = $1::seller_request_status
        ORDER BY sr.created_at DESC LIMIT 200`,
      [status],
    );
    res.json({ items: rows });
  }),
);

const assignSchema = z.object({
  plan_id: uuid,
  custom_price: z.coerce.number().min(0).optional(),
  custom_listing_limit: z.coerce.number().int().min(1).max(100000).optional(),
  custom_duration_days: z.coerce.number().int().min(1).max(3650).optional(),
  waive_payment: z.boolean().optional(),
  note,
});

/** Create a subscription for a user (from a request, or directly by the admin). */
async function assignPlan(c: PoolClient, adminId: string, userId: string, requestId: string | null, a: z.infer<typeof assignSchema>) {
  const plan = await one<any>('SELECT * FROM seller_plans WHERE id=$1 AND deleted_at IS NULL', [a.plan_id], c);
  if (!plan) throw bad('Choose a valid plan.');
  const open = await one(`SELECT id FROM seller_subscriptions WHERE user_id=$1 AND status IN ('awaiting_payment','payment_review')`, [userId], c);
  if (open) throw conflict('This user already has a plan awaiting payment.');
  const settings = await getSettings(c);
  const price = a.custom_price ?? plan.price;
  const sub = await one<any>(
    `INSERT INTO seller_subscriptions (user_id, plan_id, request_id, status, plan_name, price, currency, listing_limit, max_active_listings,
         duration_days, featured_allowed, featured_quota, assigned_by, payment_due_at)
     VALUES ($1,$2,$3,'awaiting_payment',$4,$5,$6,$7,$8,$9,$10,$11,$12, now() + make_interval(days => $13)) RETURNING *`,
    [userId, plan.id, requestId, plan.name, price, plan.currency, a.custom_listing_limit ?? plan.listing_limit,
      Math.min(plan.max_active_listings, a.custom_listing_limit ?? plan.max_active_listings), a.custom_duration_days ?? plan.duration_days,
      plan.featured_allowed, plan.featured_quota, adminId, Number(settings.payments.payment_window_days ?? 7)],
    c,
  );
  let activated = false;
  if (a.waive_payment || Number(price) === 0) {
    // Explicit admin approval in place of payment — recorded as a verified waiver for the audit trail.
    await q(`INSERT INTO payments (user_id, subscription_id, amount, currency, method, provider, status, verified_by, verified_at)
             VALUES ($1,$2,0,$3,'admin_waiver','manual','verified',$4,now())`, [userId, sub.id, sub.currency, adminId], c);
    await activateSubscription(c, sub.id, adminId);
    activated = true;
  }
  return { sub, activated };
}

async function approveAccountIfPending(c: PoolClient, adminId: string, userId: string) {
  const u = await one<any>('SELECT status, email_verified_at FROM users WHERE id=$1', [userId], c);
  if (!u?.email_verified_at) throw bad('The user must verify their email first.');
  if (!['pending_approval', 'approved'].includes(u.status)) throw bad(`This account is ${u.status.replace('_', ' ')}. Restore it first.`);
  if (u.status === 'pending_approval') {
    await q(`UPDATE users SET status='approved', approved_at=now(), approved_by=$2 WHERE id=$1`, [userId, adminId], c);
    return true;
  }
  return false;
}

async function announceAssignment(userId: string, sub: any, activated: boolean, adminNote?: string) {
  if (activated) {
    await notify({ userId, type: 'seller.active', title: 'Seller privileges activated', body: `Your ${sub.plan_name} plan is active. You can now create listings.`,
      link: '/dashboard/listings/new', email: { cta: 'Create your first listing' } });
  } else {
    await notify({
      userId,
      type: 'seller.approved',
      title: 'Seller authorization approved — payment required',
      body: `You've been approved for the ${sub.plan_name} plan (${sub.currency} ${Number(sub.price).toLocaleString()}). Complete payment to activate listing privileges.${adminNote ? ` Note: ${adminNote}` : ''}`,
      link: '/dashboard/seller',
      email: { cta: 'Complete payment' },
    });
  }
}

r.post(
  '/seller-requests/:id/approve',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const body = parse(assignSchema, req.body);
    const result = await tx(async (c) => {
      const sr = await one<any>(`SELECT * FROM seller_requests WHERE id=$1 FOR UPDATE`, [id], c);
      if (!sr || !['pending', 'info_requested'].includes(sr.status)) throw notFound('Request not found or already reviewed.');
      const accountApproved = await approveAccountIfPending(c, req.user!.id, sr.user_id);
      const out = await assignPlan(c, req.user!.id, sr.user_id, id, body);
      await q(`UPDATE seller_requests SET status='approved', admin_note=$2, reviewed_by=$3, reviewed_at=now(), updated_at=now() WHERE id=$1`, [id, body.note ?? null, req.user!.id], c);
      await audit(req, 'seller.request_approved', { type: 'seller_request', id }, { user_id: sr.user_id, plan: out.sub.plan_name, price: out.sub.price, waived: out.activated, account_approved: accountApproved }, c);
      if (out.activated) await audit(req, 'seller.privileges_granted', { type: 'user', id: sr.user_id }, { subscription_id: out.sub.id, via: 'waiver' }, c);
      return { ...out, userId: sr.user_id };
    });
    await announceAssignment(result.userId, result.sub, result.activated, body.note);
    res.json({ subscription: result.sub, activated: result.activated });
  }),
);

r.post(
  '/seller-requests/:id/reject',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const { note: n } = parse(z.object({ note: requiredNote('Give the applicant a reason.') }), req.body);
    const sr = await one<any>(`UPDATE seller_requests SET status='rejected', admin_note=$2, reviewed_by=$3, reviewed_at=now(), updated_at=now()
                                WHERE id=$1 AND status IN ('pending','info_requested') RETURNING user_id`, [id, n, req.user!.id]);
    if (!sr) throw notFound('Request not found or already reviewed.');
    await audit(req, 'seller.request_rejected', { type: 'seller_request', id }, { reason: n });
    await notify({ userId: sr.user_id, type: 'seller.rejected', title: 'Seller authorization request not approved', body: `Reason: ${n}`, link: '/dashboard/seller', email: {} });
    res.json({ ok: true });
  }),
);

r.post(
  '/seller-requests/:id/request-info',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const { note: n } = parse(z.object({ note: requiredNote('Say what information you need.') }), req.body);
    const sr = await one<any>(`UPDATE seller_requests SET status='info_requested', info_requested=$2, reviewed_by=$3, updated_at=now()
                                WHERE id=$1 AND status IN ('pending','info_requested') RETURNING user_id`, [id, n, req.user!.id]);
    if (!sr) throw notFound('Request not found or already reviewed.');
    await audit(req, 'seller.info_requested', { type: 'seller_request', id }, { message: n });
    await notify({ userId: sr.user_id, type: 'seller.info_requested', title: 'More information needed for your seller request', body: n, link: '/dashboard/seller', email: { cta: 'Reply' } });
    res.json({ ok: true });
  }),
);

/** Grant seller privileges directly, without a request */
r.post(
  '/users/:id/grant-seller',
  ah(async (req, res) => {
    const userId = parse(uuid, req.params.id);
    const body = parse(assignSchema, req.body);
    const out = await tx(async (c) => {
      await approveAccountIfPending(c, req.user!.id, userId);
      const o = await assignPlan(c, req.user!.id, userId, null, body);
      await audit(req, 'seller.plan_assigned', { type: 'user', id: userId }, { plan: o.sub.plan_name, price: o.sub.price, waived: o.activated }, c);
      return o;
    });
    await announceAssignment(userId, out.sub, out.activated, body.note);
    res.json({ subscription: out.sub, activated: out.activated });
  }),
);

r.get(
  '/subscriptions',
  ah(async (req, res) => {
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
    const rows = await q(
      `SELECT s.*, p.full_name, u.email FROM seller_subscriptions s JOIN users u ON u.id=s.user_id LEFT JOIN user_profiles p ON p.user_id=s.user_id
        WHERE $1::subscription_status IS NULL OR s.status=$1::subscription_status ORDER BY s.created_at DESC LIMIT 300`,
      [status],
    );
    res.json({ items: rows });
  }),
);

r.post(
  '/subscriptions/:id/extend',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const { days, extra_listings } = parse(z.object({ days: z.coerce.number().int().min(1).max(3650), extra_listings: z.coerce.number().int().min(0).max(10000).default(0) }), req.body);
    const sub = await tx(async (c) => {
      const s = await one<any>(
        `UPDATE seller_subscriptions SET expires_at = GREATEST(expires_at, now()) + make_interval(days => $2),
                listing_limit = listing_limit + $3, expiry_reminded_at = NULL
          WHERE id=$1 AND status IN ('active','expired') AND starts_at IS NOT NULL RETURNING *`,
        [id, days, extra_listings], c,
      );
      if (!s) throw notFound('Only active or expired paid subscriptions can be extended.');
      if (s.status === 'expired') {
        // Re-activation still passes the verified-payment guard because the original payment is on record.
        await q(`UPDATE seller_subscriptions SET status='active' WHERE id=$1`, [id], c);
      }
      await grantSellerPermissions(c, s.user_id, req.user!.id, new Date(s.expires_at), s.featured_allowed);
      await audit(req, 'seller.subscription_extended', { type: 'subscription', id }, { days, extra_listings, new_expiry: s.expires_at }, c);
      return s;
    });
    await notify({ userId: sub.user_id, type: 'seller.extended', title: 'Your seller plan was extended', body: `New expiry: ${new Date(sub.expires_at).toDateString()}`, link: '/dashboard/seller', email: {} });
    res.json({ subscription: sub });
  }),
);

r.post(
  '/subscriptions/:id/revoke',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const { reason } = parse(z.object({ reason: requiredNote('Give a reason.') }), req.body);
    const sub = await tx(async (c) => {
      const s = await one<any>(`UPDATE seller_subscriptions SET status='revoked', revoked_reason=$2 WHERE id=$1 AND status IN ('active','awaiting_payment','payment_review') RETURNING *`, [id, reason], c);
      if (!s) throw notFound('Subscription not found or not revocable.');
      const other = await one(`SELECT 1 FROM seller_subscriptions WHERE user_id=$1 AND status='active' AND expires_at>now()`, [s.user_id], c);
      if (!other) await revokeSellerPrivileges(c, s.user_id, 'suspended');
      await audit(req, 'seller.privileges_revoked', { type: 'user', id: s.user_id }, { subscription_id: id, reason }, c);
      return s;
    });
    await notify({ userId: sub.user_id, type: 'seller.revoked', title: 'Seller privileges revoked', body: `Reason: ${reason}`, link: '/dashboard/seller', email: {} });
    res.json({ ok: true });
  }),
);

/* ============================== PLANS ============================== */

const planSchema = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(['single', 'monthly', 'quarterly', 'annual', 'custom']),
  description: z.string().trim().max(500).default(''),
  price: z.coerce.number().min(0).max(100_000_000),
  currency: z.string().trim().length(3).transform((s) => s.toUpperCase()),
  listing_limit: z.coerce.number().int().min(1).max(100000),
  max_active_listings: z.coerce.number().int().min(1).max(100000),
  duration_days: z.coerce.number().int().min(1).max(3650),
  featured_allowed: z.boolean().default(false),
  featured_quota: z.coerce.number().int().min(0).max(10000).default(0),
  fixed_expiry_date: z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()),
  is_active: z.boolean().default(true),
  sort_order: z.coerce.number().int().default(0),
});

r.get('/plans', ah(async (_req, res) => {
  res.json({ items: await q(`SELECT p.*, (SELECT count(*)::int FROM seller_subscriptions s WHERE s.plan_id=p.id AND s.status='active') AS active_subscribers
                               FROM seller_plans p WHERE deleted_at IS NULL ORDER BY sort_order, price`) });
}));

r.post('/plans', ah(async (req, res) => {
  const b = parse(planSchema, req.body);
  const row = await one<any>(
    `INSERT INTO seller_plans (name, kind, description, price, currency, listing_limit, max_active_listings, duration_days, featured_allowed, featured_quota, fixed_expiry_date, is_active, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [b.name, b.kind, b.description, b.price, b.currency, b.listing_limit, b.max_active_listings, b.duration_days, b.featured_allowed, b.featured_quota, b.fixed_expiry_date ?? null, b.is_active, b.sort_order],
  );
  await audit(req, 'plan.created', { type: 'plan', id: row.id }, b);
  res.status(201).json({ plan: row });
}));

r.put('/plans/:id', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(planSchema, req.body);
  const row = await one<any>(
    `UPDATE seller_plans SET name=$2, kind=$3, description=$4, price=$5, currency=$6, listing_limit=$7, max_active_listings=$8, duration_days=$9,
            featured_allowed=$10, featured_quota=$11, fixed_expiry_date=$12, is_active=$13, sort_order=$14, updated_at=now()
      WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
    [id, b.name, b.kind, b.description, b.price, b.currency, b.listing_limit, b.max_active_listings, b.duration_days, b.featured_allowed, b.featured_quota, b.fixed_expiry_date ?? null, b.is_active, b.sort_order],
  );
  if (!row) throw notFound('Plan not found.');
  await audit(req, 'plan.updated', { type: 'plan', id }, b);
  res.json({ plan: row });
}));

r.delete('/plans/:id', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const row = await one(`UPDATE seller_plans SET deleted_at=now(), is_active=false WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id]);
  if (!row) throw notFound('Plan not found.');
  await audit(req, 'plan.deleted', { type: 'plan', id });
  res.json({ ok: true });
}));

/* ============================== PAYMENTS ============================== */

r.get(
  '/payments',
  ah(async (req, res) => {
    const { page, limit, offset } = pageParams(req.query, 100);
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
    const refunds = req.query.refunds === '1';
    const rows = await q<any>(
      `SELECT p.*, s.plan_name, pr.full_name, u.email, vp.full_name AS verified_by_name,
              (SELECT json_agg(json_build_object('id', r.id, 'name', r.original_name, 'mime', r.mime, 'uploaded_at', r.uploaded_at) ORDER BY r.uploaded_at)
                 FROM payment_receipts r WHERE r.payment_id=p.id) AS receipts,
              count(*) OVER()::int AS total
         FROM payments p JOIN seller_subscriptions s ON s.id=p.subscription_id JOIN users u ON u.id=p.user_id
         LEFT JOIN user_profiles pr ON pr.user_id=p.user_id LEFT JOIN user_profiles vp ON vp.user_id=p.verified_by
        WHERE ($1::payment_status IS NULL OR p.status=$1::payment_status) AND (NOT $2 OR p.refund_status IN ('requested','processing'))
        ORDER BY p.created_at DESC LIMIT $3 OFFSET $4`,
      [status, refunds, limit, offset],
    );
    const total = rows[0]?.total ?? 0;
    res.json({
      items: rows.map(({ total: _t, ...x }) => ({ ...x, receipts: (x.receipts ?? []).map((rc: any) => ({ ...rc, url: `/api/seller/receipts/${rc.id}` })) })),
      total, page, pages: Math.max(1, Math.ceil(total / limit)),
    });
  }),
);

r.post(
  '/payments/:id/verify',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const { note: n } = parse(z.object({ note }), req.body);
    const p = await tx(async (c) => {
      const pay = await one<any>(`SELECT * FROM payments WHERE id=$1 FOR UPDATE`, [id], c);
      if (!pay || !['under_review', 'pending'].includes(pay.status)) throw notFound('Payment not found or already processed.');
      const sub = await one<any>(`SELECT status FROM seller_subscriptions WHERE id=$1`, [pay.subscription_id], c);
      if (!['payment_review', 'awaiting_payment'].includes(sub.status)) throw bad(`The subscription is ${sub.status} and cannot be activated.`);
      await q(`UPDATE payments SET status='verified', verified_by=$2, verified_at=now(), rejection_reason=NULL WHERE id=$1`, [id, req.user!.id], c);
      const active = await activateSubscription(c, pay.subscription_id, req.user!.id);
      await audit(req, 'payment.verified', { type: 'payment', id }, { amount: pay.amount, currency: pay.currency, reference: pay.reference_number, note: n }, c);
      await audit(req, 'seller.privileges_granted', { type: 'user', id: pay.user_id }, { subscription_id: pay.subscription_id, expires_at: active.expires_at }, c);
      return { ...pay, sub: active };
    });
    await notify({ userId: p.user_id, type: 'payment.verified', title: 'Payment confirmed — seller privileges active',
      body: `Your ${p.sub.plan_name} plan is active until ${new Date(p.sub.expires_at).toDateString()}.`, link: '/dashboard/listings/new', email: { cta: 'Create a listing' } });
    res.json({ ok: true });
  }),
);

r.post(
  '/payments/:id/reject',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const { reason } = parse(z.object({ reason: requiredNote('Explain why the payment was rejected.') }), req.body);
    const p = await tx(async (c) => {
      const pay = await one<any>(`UPDATE payments SET status='rejected', rejection_reason=$2 WHERE id=$1 AND status IN ('under_review','pending') RETURNING *`, [id, reason], c);
      if (!pay) throw notFound('Payment not found or already processed.');
      await q(`UPDATE seller_subscriptions SET status='awaiting_payment' WHERE id=$1 AND status='payment_review'`, [pay.subscription_id], c);
      await audit(req, 'payment.rejected', { type: 'payment', id }, { reason }, c);
      return pay;
    });
    await notify({ userId: p.user_id, type: 'payment.rejected', title: 'Payment could not be verified', body: `Reason: ${reason}. You can submit the payment again.`, link: '/dashboard/seller', email: { cta: 'Resubmit payment' } });
    res.json({ ok: true });
  }),
);

r.post(
  '/payments/:id/refund',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const b = parse(z.object({ refund_status: z.enum(['processing', 'refunded', 'declined']), note, revoke_access: z.boolean().default(false) }), req.body);
    const p = await tx(async (c) => {
      const pay = await one<any>(`UPDATE payments SET refund_status=$2::refund_status, refund_note=COALESCE($3, refund_note) WHERE id=$1 AND status='verified' RETURNING *`, [id, b.refund_status, b.note ?? null], c);
      if (!pay) throw notFound('Only verified payments can be refunded.');
      if (b.revoke_access) {
        await q(`UPDATE seller_subscriptions SET status='revoked', revoked_reason='Refunded' WHERE id=$1 AND status='active'`, [pay.subscription_id], c);
        const other = await one(`SELECT 1 FROM seller_subscriptions WHERE user_id=$1 AND status='active' AND expires_at>now()`, [pay.user_id], c);
        if (!other) await revokeSellerPrivileges(c, pay.user_id, 'suspended');
      }
      await audit(req, `payment.refund_${b.refund_status}`, { type: 'payment', id }, { note: b.note, revoke_access: b.revoke_access }, c);
      return pay;
    });
    await notify({ userId: p.user_id, type: 'payment.refund', title: `Refund ${b.refund_status}`, body: b.note ?? '', link: '/dashboard/payments', email: {} });
    res.json({ ok: true });
  }),
);

/* ============================== LISTINGS ============================== */

r.get(
  '/listings',
  ah(async (req, res) => {
    const { page, limit, offset } = pageParams(req.query, 100);
    const params: unknown[] = [];
    const p = (v: unknown) => (params.push(v), `$${params.length}`);
    const where = ['l.deleted_at IS NULL'];
    if (typeof req.query.status === 'string' && req.query.status) where.push(`l.status = ${p(req.query.status)}::listing_status`);
    if (req.query.reported === '1') where.push(`EXISTS (SELECT 1 FROM reports r WHERE r.target_type='listing' AND r.target_id=l.id AND r.status IN ('open','investigating'))`);
    if (req.query.featured === '1') where.push('l.is_featured');
    if (typeof req.query.seller === 'string' && /^[0-9a-f-]{36}$/i.test(req.query.seller)) where.push(`l.seller_id = ${p(req.query.seller)}`);
    if (typeof req.query.q === 'string' && req.query.q.trim()) where.push(`l.title ILIKE ${p(`%${likeEscape(req.query.q.trim())}%`)}`);
    const rows = await q<any>(
      `SELECT l.id, l.slug, l.title, l.price, l.currency, l.status, l.status_note, l.is_featured, l.featured_until, l.location, l.created_at,
              l.submitted_at, l.published_at, l.expires_at, l.view_count, c.name AS category_name, l.seller_id, pr.full_name AS seller_name,
              (SELECT thumb_path FROM listing_images i WHERE i.listing_id=l.id ORDER BY sort_order LIMIT 1) AS thumb_path,
              (SELECT count(*)::int FROM reports r WHERE r.target_type='listing' AND r.target_id=l.id AND r.status IN ('open','investigating')) AS open_reports,
              (SELECT count(*)::int FROM listings d WHERE d.content_hash=l.content_hash AND d.id<>l.id AND d.seller_id<>l.seller_id AND d.deleted_at IS NULL) AS possible_duplicates,
              count(*) OVER()::int AS total
         FROM listings l JOIN categories c ON c.id=l.category_id LEFT JOIN user_profiles pr ON pr.user_id=l.seller_id
        WHERE ${where.join(' AND ')}
        ORDER BY CASE WHEN l.status='pending_approval' THEN l.submitted_at END ASC NULLS LAST, l.updated_at DESC
        LIMIT ${p(limit)} OFFSET ${p(offset)}`,
      params,
    );
    const total = rows[0]?.total ?? 0;
    res.json({ items: rows.map(({ total: _t, ...x }) => ({ ...x, image: publicUrl(x.thumb_path) })), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  }),
);

r.get(
  '/listings/:id',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const listing = await loadListingDetail(id, req.user);
    if (!listing) throw notFound('Listing not found.');
    const [raw, history, reports, seller] = await Promise.all([
      one<any>('SELECT status, contact_phone, show_phone, availability, submitted_at, approved_at, content_hash, seller_id FROM listings WHERE id=$1', [id]),
      q(`SELECT a.action, a.note, a.created_at, p.full_name AS actor_name FROM listing_approvals a LEFT JOIN user_profiles p ON p.user_id=a.actor_id WHERE a.listing_id=$1 ORDER BY a.created_at DESC`, [id]),
      q(`SELECT r.id, r.reason, r.details, r.status, r.created_at, p.full_name AS reporter_name FROM reports r LEFT JOIN user_profiles p ON p.user_id=r.reporter_id WHERE r.target_type='listing' AND r.target_id=$1 ORDER BY r.created_at DESC`, [id]),
      one<any>(`SELECT u.id, u.email, u.status, pr.full_name, pr.phone, is_active_seller(u.id) AS active_seller FROM users u LEFT JOIN user_profiles pr ON pr.user_id=u.id WHERE u.id=(SELECT seller_id FROM listings WHERE id=$1)`, [id]),
    ]);
    const duplicates = await q(`SELECT id, title, slug, status, seller_id FROM listings WHERE content_hash=$1 AND id<>$2 AND deleted_at IS NULL LIMIT 10`, [raw.content_hash, id]);
    res.json({ listing: { ...listing, contact_phone_private: raw.contact_phone, availability: raw.availability }, history, reports, seller, duplicates });
  }),
);

type ModAction = 'approve' | 'reject' | 'request_changes' | 'suspend' | 'unpublish' | 'restore';
const MOD_RULES: Record<ModAction, { from: string[]; to: string; log: string; title: string; needsNote: boolean }> = {
  approve: { from: ['pending_approval'], to: 'published', log: 'approved', title: 'Your listing is live', needsNote: false },
  reject: { from: ['pending_approval', 'published', 'approved'], to: 'rejected', log: 'rejected', title: 'Your listing was rejected', needsNote: true },
  request_changes: { from: ['pending_approval', 'published'], to: 'changes_requested', log: 'changes_requested', title: 'Changes requested on your listing', needsNote: true },
  suspend: { from: ['published', 'pending_approval', 'approved', 'sold'], to: 'suspended', log: 'suspended', title: 'Your listing was suspended', needsNote: true },
  unpublish: { from: ['published'], to: 'approved', log: 'unpublished', title: 'Your listing was unpublished', needsNote: true },
  restore: { from: ['suspended', 'approved'], to: 'published', log: 'restored', title: 'Your listing is live again', needsNote: false },
};

r.post(
  '/listings/:id/moderate',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const body = parse(z.object({ action: z.enum(['approve', 'reject', 'request_changes', 'suspend', 'unpublish', 'restore']), note }), req.body);
    const rule = MOD_RULES[body.action];
    if (rule.needsNote && !body.note) throw bad('Add a note for the seller explaining why.', 'validation_error', { note: 'A note is required.' });
    const settings = await getSettings();
    const l = await tx(async (c) => {
      const cur = await one<any>(`SELECT * FROM listings WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id], c);
      if (!cur) throw notFound('Listing not found.');
      if (!rule.from.includes(cur.status)) throw bad(`Cannot ${body.action.replace('_', ' ')} a listing that is ${cur.status.replace('_', ' ')}.`);
      if (rule.to === 'published') {
        const lifetime = Number(settings.listings.lifetime_days ?? 30);
        await q(
          `UPDATE listings SET status='published', approved_by=$2, approved_at=now(), status_note=NULL,
                  published_at = CASE WHEN $3 THEN now() ELSE COALESCE(published_at, now()) END,
                  expires_at = CASE WHEN $3 OR expires_at IS NULL OR expires_at < now() THEN now() + make_interval(days => $4) ELSE expires_at END,
                  expiry_reminded_at = NULL
            WHERE id=$1`,
          [id, req.user!.id, body.action === 'approve', lifetime], c,
        );
      } else {
        await q(`UPDATE listings SET status=$2::listing_status, status_note=$3, is_featured = CASE WHEN $2 IN ('suspended','rejected','approved') THEN false ELSE is_featured END WHERE id=$1`,
          [id, rule.to, body.note ?? null], c);
      }
      await q(`INSERT INTO listing_approvals (listing_id, actor_id, action, note) VALUES ($1,$2,$3,$4)`, [id, req.user!.id, rule.log, body.note ?? null], c);
      await audit(req, `listing.${rule.log}`, { type: 'listing', id }, { from: cur.status, to: rule.to, note: body.note, title: cur.title }, c);
      return cur;
    });
    await notify({
      userId: l.seller_id,
      type: `listing.${rule.log}`,
      title: rule.title,
      body: `"${l.title}"${body.note ? ` — ${body.note}` : ''}`,
      link: rule.to === 'published' ? `/item/${l.slug}` : `/dashboard/listings/${id}/edit`,
      email: { cta: rule.to === 'published' ? 'View listing' : 'Open listing' },
    });
    res.json({ status: rule.to });
  }),
);

r.post(
  '/listings/:id/feature',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const { featured, days } = parse(z.object({ featured: z.boolean(), days: z.coerce.number().int().min(1).max(365).default(7) }), req.body);
    const row = await one<any>(
      `UPDATE listings SET is_featured=$2, featured_until = CASE WHEN $2 THEN now() + make_interval(days => $3) ELSE NULL END
        WHERE id=$1 AND deleted_at IS NULL AND ($2 = false OR status='published') RETURNING id`,
      [id, featured, days],
    );
    if (!row) throw bad('Only published listings can be featured.');
    await audit(req, featured ? 'listing.featured' : 'listing.unfeatured', { type: 'listing', id }, { days });
    res.json({ ok: true });
  }),
);

/** Admin edit — if the listing is live, the admin's edit counts as re-approval. */
r.patch(
  '/listings/:id',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const b = parse(
      z.object({
        title: z.string().trim().min(3).max(120),
        description: z.string().trim().min(1).max(5000),
        price: z.coerce.number().min(0),
        category_id: uuid,
        subcategory_id: uuid.nullable().optional(),
        condition: z.enum(CONDITIONS),
        location: z.string().trim().min(2).max(80),
        negotiable: z.boolean(),
      }),
      req.body,
    );
    const cur = await one<any>('SELECT status FROM listings WHERE id=$1 AND deleted_at IS NULL', [id]);
    if (!cur) throw notFound('Listing not found.');
    await tx(async (c) => {
      await q(
        `UPDATE listings SET title=$2, description=$3, price=$4, category_id=$5, subcategory_id=$6, condition=$7, location=$8, negotiable=$9, content_hash=$10,
                approved_at = CASE WHEN status='published' THEN now() ELSE approved_at END,
                approved_by = CASE WHEN status='published' THEN $11::uuid ELSE approved_by END
          WHERE id=$1`,
        [id, b.title, b.description, b.price, b.category_id, b.subcategory_id ?? null, b.condition, b.location, b.negotiable, contentHash(b), req.user!.id], c,
      );
      await q(`INSERT INTO listing_approvals (listing_id, actor_id, action) VALUES ($1,$2,'edited_by_admin')`, [id, req.user!.id], c);
      await audit(req, 'listing.edited_by_admin', { type: 'listing', id }, { fields: Object.keys(b) }, c);
    });
    res.json({ ok: true });
  }),
);

r.delete(
  '/listings/:id',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const { reason } = parse(z.object({ reason: note }), req.body ?? {});
    const l = await one<any>(`UPDATE listings SET status='archived', deleted_at=now(), is_featured=false WHERE id=$1 AND deleted_at IS NULL RETURNING seller_id, title`, [id]);
    if (!l) throw notFound('Listing not found.');
    await audit(req, 'listing.deleted_by_admin', { type: 'listing', id }, { reason, title: l.title });
    await notify({ userId: l.seller_id, type: 'listing.deleted', title: 'Your listing was removed', body: `"${l.title}"${reason ? ` — ${reason}` : ''}`, link: '/dashboard/listings', email: {} });
    res.json({ ok: true });
  }),
);

/** Flag a listing as reported (admin-originated report) */
r.post(
  '/listings/:id/flag',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const b = parse(z.object({ reason: z.enum(['fake_product', 'fraudulent_seller', 'inappropriate', 'spam', 'misleading_price', 'suspicious', 'other']), details: note }), req.body);
    const l = await one('SELECT id FROM listings WHERE id=$1', [id]);
    if (!l) throw notFound();
    await q(`INSERT INTO reports (reporter_id, target_type, target_id, reason, details, status) VALUES ($1,'listing',$2,$3,$4,'investigating')
             ON CONFLICT DO NOTHING`, [req.user!.id, id, b.reason, b.details ?? null]);
    await audit(req, 'listing.flagged', { type: 'listing', id }, b);
    res.json({ ok: true });
  }),
);

/* ============================== CATEGORIES ============================== */

r.get('/categories', ah(async (_req, res) => {
  const cats = await q<any>(`SELECT c.*, (SELECT count(*)::int FROM listings l WHERE l.category_id=c.id AND l.deleted_at IS NULL) AS listing_count
                               FROM categories c WHERE c.deleted_at IS NULL ORDER BY sort_order, name`);
  const subs = await q<any>(`SELECT s.*, (SELECT count(*)::int FROM listings l WHERE l.subcategory_id=s.id AND l.deleted_at IS NULL) AS listing_count
                               FROM subcategories s WHERE deleted_at IS NULL ORDER BY sort_order, name`);
  res.json({ items: cats.map((c) => ({ ...c, image_url: publicUrl(c.image_path), subcategories: subs.filter((s) => s.category_id === c.id) })) });
}));

const catSchema = z.object({
  name: z.string().trim().min(2).max(60),
  slug: z.string().trim().max(60).optional(),
  icon: z.string().trim().max(30).default('tag'),
  is_active: z.boolean().default(true),
});

r.post('/categories', ah(async (req, res) => {
  const b = parse(catSchema, req.body);
  const max = await one<{ m: number }>('SELECT COALESCE(max(sort_order),0)+1 AS m FROM categories');
  const row = await one<any>('INSERT INTO categories (name, slug, icon, is_active, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [b.name, slugify(b.slug || b.name), b.icon, b.is_active, max?.m ?? 0]);
  await audit(req, 'category.created', { type: 'category', id: row.id }, { name: b.name });
  res.status(201).json({ category: row });
}));

r.put('/categories/:id', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(catSchema, req.body);
  const row = await one<any>('UPDATE categories SET name=$2, slug=$3, icon=$4, is_active=$5, updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING *',
    [id, b.name, slugify(b.slug || b.name), b.icon, b.is_active]);
  if (!row) throw notFound();
  await audit(req, 'category.updated', { type: 'category', id }, b);
  res.json({ category: row });
}));

r.delete('/categories/:id', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const inUse = await one<{ n: number }>(`SELECT count(*)::int AS n FROM listings WHERE category_id=$1 AND deleted_at IS NULL AND status IN ('published','pending_approval')`, [id]);
  if (inUse && inUse.n > 0) throw conflict(`This category has ${inUse.n} live or pending listings. Move them or deactivate the category instead.`);
  const row = await one(`UPDATE categories SET deleted_at=now(), is_active=false WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id]);
  if (!row) throw notFound();
  await audit(req, 'category.deleted', { type: 'category', id });
  res.json({ ok: true });
}));

r.post('/categories/reorder', ah(async (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(uuid).max(500) }), req.body);
  await tx(async (c) => {
    let i = 0;
    for (const id of ids) await q('UPDATE categories SET sort_order=$2 WHERE id=$1', [id, i++], c);
  });
  await audit(req, 'category.reordered', undefined, { count: ids.length });
  res.json({ ok: true });
}));

r.post('/categories/:id/image', (req, res, next) => imageUpload(1).single('image')(req, res, next), ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  if (!req.file) throw bad('Choose an image.');
  const img = await processImage(req.file.buffer, 'categories', { max: 800 });
  const old = await one<any>('SELECT image_path FROM categories WHERE id=$1', [id]);
  if (!old) throw notFound();
  await q('UPDATE categories SET image_path=$2, updated_at=now() WHERE id=$1', [id, img.key]);
  await removeFile(old.image_path);
  await audit(req, 'category.image_updated', { type: 'category', id });
  res.json({ image_url: publicUrl(img.key) });
}));

const subSchema = z.object({ name: z.string().trim().min(2).max(60), slug: z.string().trim().max(60).optional() });

r.post('/categories/:id/subcategories', ah(async (req, res) => {
  const catId = parse(uuid, req.params.id);
  const b = parse(subSchema, req.body);
  const max = await one<{ m: number }>('SELECT COALESCE(max(sort_order),0)+1 AS m FROM subcategories WHERE category_id=$1', [catId]);
  const row = await one<any>('INSERT INTO subcategories (category_id, name, slug, sort_order) VALUES ($1,$2,$3,$4) RETURNING *', [catId, b.name, slugify(b.slug || b.name), max?.m ?? 0]);
  await audit(req, 'subcategory.created', { type: 'subcategory', id: row.id }, { name: b.name, category_id: catId });
  res.status(201).json({ subcategory: row });
}));

r.put('/subcategories/:id', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(subSchema, req.body);
  const row = await one('UPDATE subcategories SET name=$2, slug=$3 WHERE id=$1 AND deleted_at IS NULL RETURNING *', [id, b.name, slugify(b.slug || b.name)]);
  if (!row) throw notFound();
  await audit(req, 'subcategory.updated', { type: 'subcategory', id }, b);
  res.json({ subcategory: row });
}));

r.delete('/subcategories/:id', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const row = await one('UPDATE subcategories SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id', [id]);
  if (!row) throw notFound();
  await q('UPDATE listings SET subcategory_id=NULL WHERE subcategory_id=$1 AND status <> $2', [id, 'published']);
  await audit(req, 'subcategory.deleted', { type: 'subcategory', id });
  res.json({ ok: true });
}));

r.post('/categories/:id/subcategories/reorder', ah(async (req, res) => {
  const catId = parse(uuid, req.params.id);
  const { ids } = parse(z.object({ ids: z.array(uuid).max(500) }), req.body);
  await tx(async (c) => {
    let i = 0;
    for (const id of ids) await q('UPDATE subcategories SET sort_order=$3 WHERE id=$1 AND category_id=$2', [id, catId, i++], c);
  });
  res.json({ ok: true });
}));

/* ============================== REPORTS ============================== */

r.get(
  '/reports',
  ah(async (req, res) => {
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
    const type = typeof req.query.type === 'string' && req.query.type ? req.query.type : null;
    const rows = await q<any>(
      `SELECT r.*, rp.full_name AS reporter_name, rv.full_name AS resolved_by_name,
              CASE r.target_type
                WHEN 'listing' THEN (SELECT title FROM listings WHERE id=r.target_id)
                WHEN 'user' THEN (SELECT full_name FROM user_profiles WHERE user_id=r.target_id)
                WHEN 'conversation' THEN (SELECT 'Chat about: ' || l.title FROM conversations c JOIN listings l ON l.id=c.listing_id WHERE c.id=r.target_id)
              END AS target_label,
              CASE r.target_type
                WHEN 'listing' THEN (SELECT seller_id FROM listings WHERE id=r.target_id)
                WHEN 'user' THEN r.target_id
              END AS target_user_id
         FROM reports r LEFT JOIN user_profiles rp ON rp.user_id=r.reporter_id LEFT JOIN user_profiles rv ON rv.user_id=r.resolved_by
        WHERE (($1::report_status IS NULL AND r.status IN ('open','investigating')) OR r.status=$1::report_status)
          AND ($2::text IS NULL OR r.target_type=$2)
        ORDER BY r.created_at DESC LIMIT 300`,
      [status, type],
    );
    res.json({ items: rows });
  }),
);

r.post(
  '/reports/:id/status',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const b = parse(z.object({ status: z.enum(['open', 'investigating', 'resolved', 'dismissed']), note }), req.body);
    const done = b.status === 'resolved' || b.status === 'dismissed';
    const row = await one<any>(
      `UPDATE reports SET status=$2::report_status, resolution_note=COALESCE($3, resolution_note),
              resolved_by = CASE WHEN $4 THEN $5::uuid ELSE NULL END, resolved_at = CASE WHEN $4 THEN now() ELSE NULL END
        WHERE id=$1 RETURNING reporter_id`,
      [id, b.status, b.note ?? null, done, req.user!.id],
    );
    if (!row) throw notFound();
    await audit(req, `report.${b.status}`, { type: 'report', id }, { note: b.note });
    if (done) await notify({ userId: row.reporter_id, type: 'report.closed', title: 'Your report has been reviewed', body: 'Thank you for helping keep the marketplace safe.', link: '/dashboard/notifications' });
    res.json({ ok: true });
  }),
);

/** View a reported conversation — only reachable when a report exists for it; each view is audited. */
r.get(
  '/reports/:id/conversation',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const rep = await one<any>(`SELECT target_type, target_id FROM reports WHERE id=$1`, [id]);
    if (!rep || rep.target_type !== 'conversation') throw notFound('No reported conversation.');
    const conv = await one<any>(
      `SELECT c.*, l.title AS listing_title, bp.full_name AS buyer_name, sp.full_name AS seller_name
         FROM conversations c JOIN listings l ON l.id=c.listing_id
         LEFT JOIN user_profiles bp ON bp.user_id=c.buyer_id LEFT JOIN user_profiles sp ON sp.user_id=c.seller_id WHERE c.id=$1`,
      [rep.target_id],
    );
    if (!conv) throw notFound();
    const messages = await loadMessages(conv.id, undefined, 500);
    await audit(req, 'conversation.viewed_for_report', { type: 'conversation', id: conv.id }, { report_id: id });
    res.json({ conversation: conv, messages });
  }),
);

/* ============================== SETTINGS ============================== */

const settingSchemas: Record<string, z.ZodTypeAny> = {
  site: z.object({
    name: z.string().trim().min(2).max(60),
    tagline: z.string().trim().max(140),
    logo_url: z.string().max(300).default(''),
    favicon_url: z.string().max(300).default(''),
    primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    default_currency: z.string().length(3).transform((s) => s.toUpperCase()),
    default_location: z.string().trim().max(80),
    locations: z.array(z.string().trim().min(2).max(60)).max(200),
  }),
  contact: z.object({ email: z.string().email().or(z.literal('')), phone: z.string().max(40), address: z.string().max(300), whatsapp: z.string().max(40).default('') }),
  legal: z.object({ terms: z.string().max(100_000), privacy: z.string().max(100_000) }),
  email: z.object({ enabled: z.boolean(), send_message_emails: z.boolean() }),
  payments: z.object({
    bank_transfer_enabled: z.boolean(),
    bank_details: z.string().max(2000),
    gateway_enabled: z.boolean(),
    payment_window_days: z.coerce.number().int().min(1).max(90),
  }),
  listings: z.object({
    lifetime_days: z.coerce.number().int().min(1).max(365),
    expiry_reminder_days: z.coerce.number().int().min(0).max(30),
    max_images: z.coerce.number().int().min(1).max(20),
    auto_expire: z.boolean(),
  }),
  chat: z.object({ messages_per_minute: z.coerce.number().int().min(1).max(120) }),
};

r.get('/settings', ah(async (_req, res) => {
  const { config } = await import('../config.js');
  res.json({
    settings: await getSettings(),
    environment: {
      smtp_configured: !!config.mail.host,
      gateway: config.payments.gateway,
      gateway_configured: config.payments.gateway === 'stripe' && !!config.payments.stripeSecretKey && !!config.payments.stripeWebhookSecret,
      captcha_configured: !!config.captcha.secret,
    },
  });
}));

r.put('/settings/:key', ah(async (req, res) => {
  const key = req.params.key;
  const schema = settingSchemas[key];
  if (!schema) throw notFound('Unknown settings section.');
  const value = parse(schema, req.body);
  await q(`INSERT INTO website_settings (key, value, updated_by, updated_at) VALUES ($1,$2,$3,now())
           ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [key, JSON.stringify(value), req.user!.id]);
  invalidateSettings();
  await audit(req, 'settings.updated', { type: 'settings', id: key });
  res.json({ settings: await getSettings() });
}));

r.post('/settings/upload/:kind', (req, res, next) => imageUpload(1).single('image')(req, res, next), ah(async (req, res) => {
  const kind = req.params.kind;
  if (kind !== 'logo' && kind !== 'favicon') throw notFound();
  if (!req.file) throw bad('Choose an image.');
  const img = await processImage(req.file.buffer, 'branding', { max: kind === 'logo' ? 600 : 128 });
  const s = await getSettings();
  const site = { ...s.site, [`${kind}_url`]: publicUrl(img.key) };
  await q(`INSERT INTO website_settings (key, value, updated_by) VALUES ('site',$1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [JSON.stringify(site), req.user!.id]);
  invalidateSettings();
  await audit(req, `settings.${kind}_uploaded`, { type: 'settings', id: 'site' });
  res.json({ url: publicUrl(img.key) });
}));

r.post('/settings/test-email', ah(async (req, res) => {
  await sendMail({ to: req.user!.email, subject: 'Test email', heading: 'Email is working', lines: ['This is a test message from your marketplace admin panel.'] });
  res.json({ message: `Test email sent to ${req.user!.email}. If SMTP is not configured it was printed to the server console.` });
}));

/* ============================== ANNOUNCEMENTS ============================== */

r.post('/announcements', ah(async (req, res) => {
  const b = parse(z.object({ title: z.string().trim().min(3).max(120), body: z.string().trim().min(3).max(2000), audience: z.enum(['all', 'sellers', 'buyers']), link: z.string().max(200).regex(/^\/(?!\/)/, 'Links must be a path on this site, starting with /').optional() }), req.body);
  const filter = b.audience === 'sellers' ? 'AND is_active_seller(u.id)' : b.audience === 'buyers' ? 'AND NOT is_active_seller(u.id)' : '';
  const users = await q<{ id: string }>(`SELECT u.id FROM users u WHERE u.role='user' AND u.status='approved' AND u.deleted_at IS NULL ${filter}`);
  for (const u of users) await notify({ userId: u.id, type: 'announcement', title: b.title, body: b.body, link: b.link });
  await audit(req, 'announcement.sent', undefined, { title: b.title, audience: b.audience, recipients: users.length });
  res.json({ recipients: users.length });
}));

/* ============================== ACTIVITY LOG ============================== */

r.get('/activity', ah(async (req, res) => {
  const { page, limit, offset } = pageParams(req.query, 100);
  const action = typeof req.query.action === 'string' && req.query.action ? `${likeEscape(req.query.action)}%` : null;
  const actor = typeof req.query.actor === 'string' && /^[0-9a-f-]{36}$/i.test(req.query.actor) ? req.query.actor : null;
  const adminOnly = req.query.admin === '1';
  const rows = await q<any>(
    `SELECT a.*, p.full_name AS actor_name, u.role AS actor_role, count(*) OVER()::int AS total
       FROM activity_logs a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN user_profiles p ON p.user_id=a.actor_id
      WHERE ($1::text IS NULL OR a.action LIKE $1) AND ($2::uuid IS NULL OR a.actor_id=$2) AND (NOT $3 OR u.role IN ('admin','system'))
      ORDER BY a.created_at DESC LIMIT $4 OFFSET $5`,
    [action, actor, adminOnly, limit, offset],
  );
  const total = rows[0]?.total ?? 0;
  res.json({ items: rows.map(({ total: _t, ...x }) => x), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}));

export default r;
