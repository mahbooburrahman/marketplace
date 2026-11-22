import { Router } from 'express';
import { z } from 'zod';
import { one, q } from '../db.js';
import { ah, bad, notFound, pageParams, parse, uuid } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { reportLimiter, uploadLimiter, writeLimiter } from '../middleware/limits.js';
import { imageUpload, processImage, publicUrl, removeFile } from '../lib/storage.js';
import { CARD_FROM, CARD_SELECT, toCard } from '../lib/listings.js';
import { currentSubscription } from '../lib/subscriptions.js';
import { notifyAdmins } from '../lib/notify.js';
import { audit } from '../lib/audit.js';

const r = Router();
r.use(requireAuth);

/** GET /api/account/overview — dashboard summary */
r.get(
  '/overview',
  ah(async (req, res) => {
    const uid = req.user!.id;
    const [counts, request, subscription, recentNotifications, statusInfo] = await Promise.all([
      one<any>(
        `SELECT (SELECT count(*)::int FROM favorites WHERE user_id=$1) AS favorites,
                (SELECT count(*)::int FROM conversation_participants WHERE user_id=$1) AS conversations,
                (SELECT count(*)::int FROM notifications WHERE user_id=$1 AND read_at IS NULL) AS unread_notifications,
                (SELECT count(*)::int FROM listings WHERE seller_id=$1 AND status='published' AND deleted_at IS NULL) AS live_listings,
                (SELECT count(*)::int FROM listings WHERE seller_id=$1 AND status='pending_approval' AND deleted_at IS NULL) AS pending_listings,
                (SELECT count(*)::int FROM listings WHERE seller_id=$1 AND status IN ('rejected','changes_requested') AND deleted_at IS NULL) AS needs_attention,
                (SELECT COALESCE(sum(view_count),0)::int FROM listings WHERE seller_id=$1 AND deleted_at IS NULL) AS total_views`,
        [uid],
      ),
      one(`SELECT id, status, admin_note, info_requested, created_at FROM seller_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`, [uid]),
      currentSubscription(uid),
      q(`SELECT id, type, title, body, link, read_at, created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5`, [uid]),
      one<any>(`SELECT status_reason, created_at, approved_at FROM users WHERE id=$1`, [uid]),
    ]);
    res.json({ counts, seller_request: request, subscription, notifications: recentNotifications, status_reason: statusInfo?.status_reason, member_since: statusInfo?.created_at });
  }),
);

/** PATCH /api/account/profile */
r.patch(
  '/profile',
  writeLimiter,
  ah(async (req, res) => {
    const body = parse(
      z.object({
        full_name: z.string().trim().min(2).max(80),
        display_name: z.string().trim().max(80).optional().default(''),
        phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid mobile number.'),
        location: z.string().trim().max(80).optional().default(''),
        bio: z.string().trim().max(500).optional().default(''),
      }),
      req.body,
    );
    await q(`UPDATE user_profiles SET full_name=$2, phone=$3, location=NULLIF($4,''), bio=NULLIF($5,''), display_name=NULLIF($6,''), updated_at=now() WHERE user_id=$1`,
      [req.user!.id, body.full_name, body.phone, body.location, body.bio, body.display_name]);
    await audit(req, 'user.profile_updated', { type: 'user', id: req.user!.id });
    res.json({ ok: true });
  }),
);

r.get(
  '/profile',
  ah(async (req, res) => {
    const p = await one<any>('SELECT full_name, display_name, phone, location, bio, avatar_path FROM user_profiles WHERE user_id=$1', [req.user!.id]);
    res.json({ profile: { ...p, avatar_url: publicUrl(p?.avatar_path), avatar_path: undefined, email: req.user!.email } });
  }),
);

/** POST /api/account/avatar */
r.post(
  '/avatar',
  uploadLimiter,
  (req, res, next) => imageUpload(1).single('avatar')(req, res, next),
  ah(async (req, res) => {
    if (!req.file) throw bad('Choose an image.');
    const img = await processImage(req.file.buffer, 'avatars', { max: 400 });
    const old = await one<{ avatar_path: string | null }>('SELECT avatar_path FROM user_profiles WHERE user_id=$1', [req.user!.id]);
    await q('UPDATE user_profiles SET avatar_path=$2, updated_at=now() WHERE user_id=$1', [req.user!.id, img.key]);
    await removeFile(old?.avatar_path);
    res.json({ avatar_url: publicUrl(img.key) });
  }),
);

/** Notifications */
r.get(
  '/notifications',
  ah(async (req, res) => {
    const { limit, offset, page } = pageParams(req.query, 50);
    const rows = await q<any>(
      `SELECT id, type, title, body, link, read_at, created_at, count(*) OVER()::int AS total
         FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.user!.id, limit, offset],
    );
    const total = rows[0]?.total ?? 0;
    res.json({ items: rows.map(({ total: _t, ...x }) => x), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  }),
);

r.post(
  '/notifications/read-all',
  ah(async (req, res) => {
    await q('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [req.user!.id]);
    res.json({ ok: true });
  }),
);

r.post(
  '/notifications/:id/read',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    await q('UPDATE notifications SET read_at=COALESCE(read_at, now()) WHERE id=$1 AND user_id=$2', [id, req.user!.id]);
    res.json({ ok: true });
  }),
);

/** Favorites */
r.get(
  '/favorites',
  ah(async (req, res) => {
    const rows = await q(
      `SELECT ${CARD_SELECT('$1')}, f.created_at AS saved_at ${CARD_FROM} JOIN favorites f ON f.listing_id=l.id AND f.user_id=$1
        WHERE l.deleted_at IS NULL ORDER BY f.created_at DESC LIMIT 200`,
      [req.user!.id],
    );
    res.json({ items: rows.map(toCard) });
  }),
);

r.post(
  '/favorites/:listingId',
  writeLimiter,
  ah(async (req, res) => {
    const id = parse(uuid, req.params.listingId);
    const l = await one(`SELECT id FROM listings WHERE id=$1 AND status='published' AND deleted_at IS NULL`, [id]);
    if (!l) throw notFound('This listing is not available.');
    await q('INSERT INTO favorites (user_id, listing_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user!.id, id]);
    res.json({ is_favorite: true });
  }),
);

r.delete(
  '/favorites/:listingId',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.listingId);
    await q('DELETE FROM favorites WHERE user_id=$1 AND listing_id=$2', [req.user!.id, id]);
    res.json({ is_favorite: false });
  }),
);

/** POST /api/account/reports — report a listing, a user, or a conversation */
r.post(
  '/reports',
  reportLimiter,
  ah(async (req, res) => {
    const body = parse(
      z.object({
        target_type: z.enum(['listing', 'user', 'conversation']),
        target_id: uuid,
        reason: z.enum(['fake_product', 'fraudulent_seller', 'inappropriate', 'spam', 'misleading_price', 'suspicious', 'harassment', 'other']),
        details: z.string().trim().max(2000).optional(),
      }),
      req.body,
    );
    const uid = req.user!.id;
    // Reporters may only report things they can actually see.
    if (body.target_type === 'listing') {
      const l = await one<any>(`SELECT seller_id FROM listings WHERE id=$1 AND status IN ('published','sold') AND deleted_at IS NULL`, [body.target_id]);
      if (!l) throw notFound('Listing not found.');
      if (l.seller_id === uid) throw bad('You cannot report your own listing.');
    } else if (body.target_type === 'conversation') {
      const c = await one('SELECT 1 FROM conversation_participants WHERE conversation_id=$1 AND user_id=$2', [body.target_id, uid]);
      if (!c) throw notFound('Conversation not found.');
    } else {
      if (body.target_id === uid) throw bad('You cannot report yourself.');
      const u = await one(`SELECT 1 FROM users WHERE id=$1 AND role='user' AND deleted_at IS NULL`, [body.target_id]);
      if (!u) throw notFound('User not found.');
    }
    const existing = await one(`SELECT id FROM reports WHERE reporter_id=$1 AND target_type=$2 AND target_id=$3 AND status IN ('open','investigating')`, [uid, body.target_type, body.target_id]);
    if (existing) return res.json({ ok: true, message: 'You have already reported this. Our team is reviewing it.' });
    const row = await one<any>(`INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [uid, body.target_type, body.target_id, body.reason, body.details ?? null]);
    await audit(req, 'report.created', { type: 'report', id: row.id }, { target_type: body.target_type, target_id: body.target_id, reason: body.reason });
    await notifyAdmins('report.new', `New ${body.target_type} report`, `Reason: ${body.reason.replace('_', ' ')}`, '/admin/reports');
    res.status(201).json({ ok: true, message: 'Thanks — our moderators will review this report.' });
  }),
);

export default r;
