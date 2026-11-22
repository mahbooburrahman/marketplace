import { Router } from 'express';
import { z } from 'zod';
import { one, q, tx } from '../db.js';
import { ah, bad, forbidden, HttpError, notFound, parse, uuid } from '../lib/http.js';
import { requireAuth, requireChatAccess } from '../middleware/auth.js';
import { allowAction, uploadLimiter, writeLimiter } from '../middleware/limits.js';
import { imageUpload, processImage, privatePath, publicUrl, removeFile } from '../lib/storage.js';
import { emitToUser, isOnline } from '../lib/realtime.js';
import { notify } from '../lib/notify.js';
import { getSettings } from '../lib/settings.js';
import { audit } from '../lib/audit.js';

const r = Router();
r.use(requireAuth);

/** Load a conversation only if the caller participates in it. Returns 404 otherwise (no ID probing). */
export async function participantConversation(convId: string, userId: string) {
  const conv = await one<any>(
    `SELECT c.* FROM conversations c JOIN conversation_participants p ON p.conversation_id=c.id AND p.user_id=$2 WHERE c.id=$1`,
    [convId, userId],
  );
  if (!conv) throw notFound('Conversation not found.');
  return conv;
}

function serializeMessage(m: any) {
  return {
    id: m.id,
    conversation_id: m.conversation_id,
    sender_id: m.sender_id,
    body: m.deleted_at ? '' : m.body,
    deleted: !!m.deleted_at,
    created_at: m.created_at,
    attachments: (m.attachments ?? []).map((a: any) => ({ id: a.id, url: `/api/chat/attachments/${a.id}`, mime: a.mime, width: a.width, height: a.height })),
  };
}

export async function loadMessages(convId: string, before?: string, limit = 40) {
  const rows = await q<any>(
    `SELECT m.*, COALESCE(json_agg(a.*) FILTER (WHERE a.id IS NOT NULL), '[]') AS attachments
       FROM messages m LEFT JOIN message_attachments a ON a.message_id=m.id
      WHERE m.conversation_id=$1 AND ($2::timestamptz IS NULL OR m.created_at < $2)
      GROUP BY m.id ORDER BY m.created_at DESC LIMIT $3`,
    [convId, before ?? null, limit],
  );
  return rows.reverse().map(serializeMessage);
}

/** POST /api/chat/conversations — buyer starts (or resumes) a chat about a listing */
r.post(
  '/conversations',
  requireChatAccess,
  writeLimiter,
  ah(async (req, res) => {
    const body = parse(z.object({ listing_id: uuid, message: z.string().trim().max(4000).optional() }), req.body);
    const me = req.user!;
    const listing = await one<any>(`SELECT id, seller_id, title, status FROM listings WHERE id=$1 AND deleted_at IS NULL`, [body.listing_id]);
    if (!listing || listing.status !== 'published') throw notFound('This listing is not available.');
    if (listing.seller_id === me.id) throw bad('You cannot message yourself about your own listing.');

    let conv = await one<any>('SELECT * FROM conversations WHERE listing_id=$1 AND buyer_id=$2', [listing.id, me.id]);
    if (!conv) {
      // The conversations_guard trigger re-checks buyer approval, seller status, listing state and blocks.
      conv = await tx(async (c) => {
        const created = await one<any>(
          `INSERT INTO conversations (listing_id, buyer_id, seller_id) VALUES ($1,$2,$3)
           ON CONFLICT (listing_id, buyer_id) DO UPDATE SET listing_id = EXCLUDED.listing_id RETURNING *`,
          [listing.id, me.id, listing.seller_id], c,
        );
        await q(`INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1,$2),($1,$3) ON CONFLICT DO NOTHING`,
          [created.id, me.id, listing.seller_id], c);
        return created;
      });
      await audit(req, 'conversation.created', { type: 'conversation', id: conv.id }, { listing_id: listing.id });
    }
    if (body.message) await postMessage(conv, me, body.message, undefined);
    res.status(201).json({ conversation_id: conv.id });
  }),
);

/** GET /api/chat/conversations — inbox */
r.get(
  '/conversations',
  ah(async (req, res) => {
    const uid = req.user!.id;
    const rows = await q<any>(
      `SELECT c.id, c.listing_id, c.buyer_id, c.seller_id, c.last_message_at, cp.archived,
              l.title AS listing_title, l.slug AS listing_slug, l.price AS listing_price, l.currency AS listing_currency, l.status AS listing_status,
              (SELECT thumb_path FROM listing_images i WHERE i.listing_id=l.id ORDER BY sort_order LIMIT 1) AS listing_thumb,
              o.id AS other_id, COALESCE(NULLIF(op.display_name,''), op.full_name) AS other_name, op.avatar_path AS other_avatar, o.last_seen_at AS other_last_seen,
              lm.body AS last_body, lm.sender_id AS last_sender, lm.created_at AS last_at, lm.has_attachment,
              (SELECT count(*)::int FROM messages m WHERE m.conversation_id=c.id AND m.sender_id<>$1 AND m.created_at > cp.last_read_at AND m.deleted_at IS NULL) AS unread,
              EXISTS (SELECT 1 FROM blocked_users b WHERE b.blocker_id=$1 AND b.blocked_id=o.id) AS i_blocked,
              EXISTS (SELECT 1 FROM blocked_users b WHERE b.blocker_id=o.id AND b.blocked_id=$1) AS blocked_me
         FROM conversation_participants cp
         JOIN conversations c ON c.id=cp.conversation_id
         JOIN listings l ON l.id=c.listing_id
         JOIN users o ON o.id = CASE WHEN c.buyer_id=$1 THEN c.seller_id ELSE c.buyer_id END
         LEFT JOIN user_profiles op ON op.user_id=o.id
         LEFT JOIN LATERAL (
           SELECT m.body, m.sender_id, m.created_at, EXISTS (SELECT 1 FROM message_attachments a WHERE a.message_id=m.id) AS has_attachment
             FROM messages m WHERE m.conversation_id=c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1
         ) lm ON true
        WHERE cp.user_id=$1
        ORDER BY c.last_message_at DESC LIMIT 200`,
      [uid],
    );
    res.json({
      items: rows.map((x) => ({
        id: x.id,
        role: x.buyer_id === uid ? 'buyer' : 'seller',
        archived: x.archived,
        listing: { id: x.listing_id, title: x.listing_title, slug: x.listing_slug, price: x.listing_price, currency: x.listing_currency, status: x.listing_status, image: publicUrl(x.listing_thumb) },
        other: { id: x.other_id, name: x.other_name, avatar_url: publicUrl(x.other_avatar), online: isOnline(x.other_id), last_seen_at: x.other_last_seen },
        last_message: x.last_at ? { body: x.last_body, from_me: x.last_sender === uid, created_at: x.last_at, has_attachment: x.has_attachment } : null,
        unread: x.unread,
        i_blocked: x.i_blocked,
        blocked_me: x.blocked_me,
      })),
    });
  }),
);

/** GET /api/chat/conversations/:id — header info + messages (cursor: ?before=ISO) */
r.get(
  '/conversations/:id',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const uid = req.user!.id;
    const conv = await participantConversation(id, uid);
    const otherId = conv.buyer_id === uid ? conv.seller_id : conv.buyer_id;
    const [info, other, readState] = await Promise.all([
      one<any>(`SELECT l.id, l.title, l.slug, l.price, l.currency, l.status,
                       (SELECT thumb_path FROM listing_images i WHERE i.listing_id=l.id ORDER BY sort_order LIMIT 1) AS thumb
                  FROM listings l WHERE l.id=$1`, [conv.listing_id]),
      one<any>(`SELECT u.id, COALESCE(NULLIF(p.display_name,''), p.full_name) AS full_name, p.avatar_path, u.last_seen_at,
                       EXISTS (SELECT 1 FROM blocked_users b WHERE b.blocker_id=$2 AND b.blocked_id=u.id) AS i_blocked,
                       EXISTS (SELECT 1 FROM blocked_users b WHERE b.blocker_id=u.id AND b.blocked_id=$2) AS blocked_me
                  FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1`, [otherId, uid]),
      one<any>(`SELECT last_read_at FROM conversation_participants WHERE conversation_id=$1 AND user_id=$2`, [id, otherId]),
    ]);
    const before = typeof req.query.before === 'string' && !isNaN(Date.parse(req.query.before)) ? req.query.before : undefined;
    const messages = await loadMessages(id, before);
    res.json({
      conversation: {
        id,
        role: conv.buyer_id === uid ? 'buyer' : 'seller',
        listing: { ...info, image: publicUrl(info?.thumb), thumb: undefined },
        other: { id: other.id, name: other.full_name, avatar_url: publicUrl(other.avatar_path), online: isOnline(other.id), last_seen_at: other.last_seen_at },
        other_last_read_at: readState?.last_read_at,
        i_blocked: other.i_blocked,
        blocked_me: other.blocked_me,
      },
      messages,
      has_more: messages.length === 40,
    });
  }),
);

const emailThrottle = new Map<string, number>(); // conversation:user -> last email time

async function postMessage(conv: any, me: NonNullable<Express.Request['user']>, body: string, file?: Express.Multer.File) {
  const settings = await getSettings();
  if (!allowAction(`chat:${me.id}`, settings.chat.messages_per_minute ?? 20)) {
    throw new HttpError(429, 'You are sending messages too quickly. Please wait a moment.', 'rate_limited');
  }
  const text = body.trim();
  if (!text && !file) throw bad('Message cannot be empty.');
  let img: Awaited<ReturnType<typeof processImage>> | null = null;
  if (file) img = await processImage(file.buffer, 'chat', { max: 1400, visibility: 'private' });
  let msg: any;
  try {
    msg = await tx(async (c) => {
      // messages_guard trigger verifies participant status and blocks.
      const m = await one<any>(`INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1,$2,$3) RETURNING *`, [conv.id, me.id, text], c);
      m.attachments = [];
      if (img) {
        const a = await one<any>(`INSERT INTO message_attachments (message_id, path, mime, size_bytes, width, height) VALUES ($1,$2,'image/webp',$3,$4,$5) RETURNING *`,
          [m.id, img.key, img.size, img.width, img.height], c);
        m.attachments.push(a);
      }
      await q(`UPDATE conversation_participants SET last_read_at=now(), archived=false WHERE conversation_id=$1 AND user_id=$2`, [conv.id, me.id], c);
      await q(`UPDATE conversation_participants SET archived=false WHERE conversation_id=$1`, [conv.id], c);
      return m;
    });
  } catch (e) {
    if (img) await removeFile(img.key, 'private');
    throw e;
  }
  const out = serializeMessage(msg);
  const otherId = conv.buyer_id === me.id ? conv.seller_id : conv.buyer_id;
  emitToUser(otherId, 'message:new', out);
  emitToUser(me.id, 'message:new', out);

  // In-app notification always; email only when offline and at most every 30 minutes per conversation.
  const key = `${conv.id}:${otherId}`;
  const sendEmail = !isOnline(otherId) && settings.email.send_message_emails !== false && Date.now() - (emailThrottle.get(key) ?? 0) > 30 * 60_000;
  if (sendEmail) emailThrottle.set(key, Date.now());
  const listing = await one<{ title: string }>('SELECT title FROM listings WHERE id=$1', [conv.listing_id]);
  await notify({
    userId: otherId,
    type: 'message.new',
    title: `New message from ${me.display_name || me.full_name}`,
    body: `${listing?.title ?? 'Listing'}: ${text ? text.slice(0, 120) : '📷 Photo'}`,
    link: `/messages/${conv.id}`,
    email: sendEmail ? { subject: 'You have a new message', cta: 'Reply' } : undefined,
  });
  return out;
}

/** POST /api/chat/conversations/:id/messages — text and/or one image */
r.post(
  '/conversations/:id/messages',
  uploadLimiter,
  (req, res, next) => imageUpload(1).single('image')(req, res, next),
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const { body } = parse(z.object({ body: z.string().max(4000).default('') }), req.body);
    const me = req.user!;
    if (me.status !== 'approved') throw forbidden('Your account cannot send messages right now.', 'not_approved');
    const conv = await participantConversation(id, me.id);
    const message = await postMessage(conv, me, body, req.file);
    res.status(201).json({ message });
  }),
);

/** POST /api/chat/conversations/:id/read — read receipts */
r.post(
  '/conversations/:id/read',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const conv = await participantConversation(id, req.user!.id);
    const row = await one<any>(`UPDATE conversation_participants SET last_read_at=now() WHERE conversation_id=$1 AND user_id=$2 RETURNING last_read_at`, [id, req.user!.id]);
    const otherId = conv.buyer_id === req.user!.id ? conv.seller_id : conv.buyer_id;
    emitToUser(otherId, 'message:read', { conversation_id: id, reader_id: req.user!.id, read_at: row.last_read_at });
    emitToUser(req.user!.id, 'unread:changed', {});
    res.json({ ok: true });
  }),
);

r.post(
  '/conversations/:id/archive',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    await participantConversation(id, req.user!.id);
    const { archived } = parse(z.object({ archived: z.boolean() }), req.body);
    await q('UPDATE conversation_participants SET archived=$3 WHERE conversation_id=$1 AND user_id=$2', [id, req.user!.id, archived]);
    res.json({ ok: true });
  }),
);

/** GET /api/chat/attachments/:id — participants (or an admin with an open report on the conversation) */
r.get(
  '/attachments/:id',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const a = await one<any>(
      `SELECT a.path, a.mime, m.conversation_id FROM message_attachments a JOIN messages m ON m.id=a.message_id WHERE a.id=$1`, [id],
    );
    if (!a) throw notFound();
    const isParticipant = await one('SELECT 1 FROM conversation_participants WHERE conversation_id=$1 AND user_id=$2', [a.conversation_id, req.user!.id]);
    const adminWithReport = req.user!.role === 'admin' &&
      (await one(`SELECT 1 FROM reports WHERE target_type='conversation' AND target_id=$1`, [a.conversation_id]));
    if (!isParticipant && !adminWithReport) throw notFound();
    res.setHeader('Content-Type', a.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(privatePath(a.path));
  }),
);

/** Blocking */
r.get(
  '/blocks',
  ah(async (req, res) => {
    const rows = await q(`SELECT b.blocked_id AS id, COALESCE(NULLIF(p.display_name,''), p.full_name) AS name, b.created_at FROM blocked_users b LEFT JOIN user_profiles p ON p.user_id=b.blocked_id WHERE b.blocker_id=$1 ORDER BY b.created_at DESC`, [req.user!.id]);
    res.json({ items: rows });
  }),
);

r.post(
  '/blocks',
  writeLimiter,
  ah(async (req, res) => {
    const { user_id } = parse(z.object({ user_id: uuid }), req.body);
    if (user_id === req.user!.id) throw bad('You cannot block yourself.');
    // Only allow blocking someone you have actually chatted with.
    const shared = await one(`SELECT 1 FROM conversations WHERE (buyer_id=$1 AND seller_id=$2) OR (buyer_id=$2 AND seller_id=$1) LIMIT 1`, [req.user!.id, user_id]);
    if (!shared) throw notFound('User not found.');
    await q('INSERT INTO blocked_users (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user!.id, user_id]);
    await audit(req, 'user.blocked', { type: 'user', id: user_id });
    res.json({ ok: true });
  }),
);

r.delete(
  '/blocks/:userId',
  ah(async (req, res) => {
    const userId = parse(uuid, req.params.userId);
    await q('DELETE FROM blocked_users WHERE blocker_id=$1 AND blocked_id=$2', [req.user!.id, userId]);
    await audit(req, 'user.unblocked', { type: 'user', id: userId });
    res.json({ ok: true });
  }),
);

export default r;
