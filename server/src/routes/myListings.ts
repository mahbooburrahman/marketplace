import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { one, q, tx } from '../db.js';
import { ah, bad, conflict, forbidden, notFound, pageParams, parse, uuid } from '../lib/http.js';
import { requireAuth, requireSeller } from '../middleware/auth.js';
import { uploadLimiter, writeLimiter } from '../middleware/limits.js';
import { imageUpload, processImage, publicUrl, removeFile } from '../lib/storage.js';
import { contentHash, CONDITIONS, MODERATED_FIELDS } from '../lib/listings.js';
import { slugify } from '../lib/security.js';
import { getSettings } from '../lib/settings.js';
import { notifyAdmins } from '../lib/notify.js';
import { audit } from '../lib/audit.js';

const r = Router();
r.use(requireAuth);

const bool = z.preprocess((v) => v === true || v === 'true' || v === '1' || v === 'on', z.boolean());
const optStr = (max: number) => z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().trim().max(max).optional());

const listingSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters.').max(120),
  category_id: uuid,
  subcategory_id: z.preprocess((v) => (v === '' || v === 'null' ? null : v), uuid.nullable().optional()),
  description: z.string().trim().min(20, 'Please describe the item in at least 20 characters.').max(5000),
  price: z.coerce.number().min(0, 'Price cannot be negative.').max(9_999_999_999),
  negotiable: bool.default(false),
  condition: z.enum(CONDITIONS),
  location: z.string().trim().min(2, 'Enter a location.').max(80),
  contact_phone: optStr(30),
  show_phone: bool.default(false),
  availability: z.enum(['available', 'reserved', 'out_of_stock']).default('available'),
  video_url: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().url('Enter a full video link (https://…).').max(300).refine((u) => u.startsWith('https://'), 'Video links must use https.').optional(),
  ),
  action: z.enum(['draft', 'submit']).default('submit'),
});

const ACTIVE_STATES = `('published','pending_approval','approved')`;

async function validateCategory(categoryId: string, subId: string | null | undefined) {
  const cat = await one('SELECT id FROM categories WHERE id=$1 AND is_active AND deleted_at IS NULL', [categoryId]);
  if (!cat) throw bad('Choose a valid category.', 'validation_error', { category_id: 'Choose a valid category.' });
  if (subId) {
    const sub = await one('SELECT id FROM subcategories WHERE id=$1 AND category_id=$2 AND deleted_at IS NULL', [subId, categoryId]);
    if (!sub) throw bad('Choose a valid subcategory.', 'validation_error', { subcategory_id: 'Choose a valid subcategory.' });
  }
}

async function activeCount(sellerId: string, db?: any) {
  const row = await one<{ n: number }>(`SELECT count(*)::int AS n FROM listings WHERE seller_id=$1 AND status IN ${ACTIVE_STATES} AND deleted_at IS NULL`, [sellerId], db);
  return row?.n ?? 0;
}

async function processFiles(files: Express.Multer.File[] | undefined) {
  const out: Awaited<ReturnType<typeof processImage>>[] = [];
  try {
    for (const f of files ?? []) out.push(await processImage(f.buffer, 'listings', { max: 1600, thumb: 480 }));
    return out;
  } catch (e) {
    for (const o of out) { await removeFile(o.key); await removeFile(o.thumbKey); }
    throw e;
  }
}

async function ownListing(id: string, userId: string) {
  const l = await one<any>('SELECT * FROM listings WHERE id=$1 AND deleted_at IS NULL', [id]);
  // Same 404 for "not yours" and "doesn't exist" so IDs can't be probed.
  if (!l || l.seller_id !== userId) throw notFound('Listing not found.');
  return l;
}

/** GET /api/my/listings */
r.get(
  '/',
  ah(async (req, res) => {
    const { page, limit, offset } = pageParams(req.query, 50);
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
    const rows = await q<any>(
      `SELECT l.id, l.slug, l.title, l.price, l.currency, l.status, l.status_note, l.is_featured, l.featured_until,
              l.view_count, l.created_at, l.updated_at, l.published_at, l.expires_at, l.location, l.condition,
              (SELECT thumb_path FROM listing_images i WHERE i.listing_id=l.id ORDER BY sort_order LIMIT 1) AS thumb_path,
              (SELECT count(*)::int FROM conversations c WHERE c.listing_id=l.id) AS conversation_count,
              (SELECT count(*)::int FROM favorites f WHERE f.listing_id=l.id) AS favorite_count,
              count(*) OVER()::int AS total
         FROM listings l WHERE l.seller_id=$1 AND l.deleted_at IS NULL AND ($2::listing_status IS NULL OR l.status=$2::listing_status)
        ORDER BY l.updated_at DESC LIMIT $3 OFFSET $4`,
      [req.user!.id, status, limit, offset],
    );
    const total = rows[0]?.total ?? 0;
    res.json({ items: rows.map((x) => ({ ...x, image: publicUrl(x.thumb_path), thumb_path: undefined, total: undefined })), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  }),
);

/** GET /api/my/listings/:id — full record for the edit form */
r.get(
  '/:id',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const l = await ownListing(id, req.user!.id);
    const images = await q('SELECT id, path, thumb_path, sort_order FROM listing_images WHERE listing_id=$1 ORDER BY sort_order, created_at', [id]);
    const history = await q(
      `SELECT a.action, a.note, a.created_at FROM listing_approvals a WHERE a.listing_id=$1 ORDER BY a.created_at DESC LIMIT 20`,
      [id],
    );
    res.json({
      listing: { ...l, search_vector: undefined, content_hash: undefined },
      images: images.map((i: any) => ({ id: i.id, url: publicUrl(i.path), thumb: publicUrl(i.thumb_path) })),
      history,
    });
  }),
);

/** POST /api/my/listings — create (as draft or submitted for review) */
r.post(
  '/',
  requireSeller,
  writeLimiter,
  uploadLimiter,
  (req, res, next) => imageUpload(10).array('images', 10)(req, res, next),
  ah(async (req, res) => {
    const body = parse(listingSchema, req.body);
    const settings = await getSettings();
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.length > settings.listings.max_images) throw bad(`You can upload up to ${settings.listings.max_images} photos.`);
    if (body.action === 'submit' && files.length === 0) throw bad('Add at least one photo before submitting.', 'validation_error', { images: 'Add at least one photo.' });
    await validateCategory(body.category_id, body.subcategory_id);

    const hash = contentHash(body);
    const dup = await one('SELECT id FROM listings WHERE seller_id=$1 AND content_hash=$2 AND deleted_at IS NULL AND status NOT IN (\'archived\',\'sold\',\'expired\')', [req.user!.id, hash]);
    if (dup) throw conflict('You already have an identical listing. Edit the existing one instead of posting a duplicate.', 'duplicate_listing');

    const processed = await processFiles(files);
    try {
      const listing = await tx(async (c) => {
        const sub = await one<any>(
          `SELECT * FROM seller_subscriptions WHERE user_id=$1 AND status='active' AND expires_at > now()
            ORDER BY expires_at DESC LIMIT 1 FOR UPDATE`,
          [req.user!.id], c,
        );
        if (!sub) throw forbidden('Your seller plan is not active.', 'not_seller');
        if (sub.listings_used >= sub.listing_limit) {
          throw forbidden(`You have used all ${sub.listing_limit} listings in your ${sub.plan_name} plan.`, 'listing_quota_reached');
        }
        if (body.action === 'submit' && (await activeCount(req.user!.id, c)) >= sub.max_active_listings) {
          throw forbidden(`Your plan allows ${sub.max_active_listings} active listings at a time. Mark something as sold or archive it first.`, 'active_limit_reached');
        }
        const slug = `${slugify(body.title)}-${crypto.randomBytes(4).toString('hex')}`;
        const submitting = body.action === 'submit';
        const l = await one<any>(
          `INSERT INTO listings (seller_id, subscription_id, category_id, subcategory_id, title, slug, description, price, currency,
              negotiable, condition, location, contact_phone, show_phone, availability, video_url, status, content_hash, submitted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id, slug, status`,
          [req.user!.id, sub.id, body.category_id, body.subcategory_id ?? null, body.title, slug, body.description, body.price,
            settings.site.default_currency ?? 'CAD', body.negotiable, body.condition, body.location, body.contact_phone ?? null,
            body.show_phone, body.availability, body.video_url ?? null, submitting ? 'pending_approval' : 'draft', hash,
            submitting ? new Date() : null],
          c,
        );
        let i = 0;
        for (const img of processed) {
          await q('INSERT INTO listing_images (listing_id, path, thumb_path, width, height, sort_order) VALUES ($1,$2,$3,$4,$5,$6)',
            [l.id, img.key, img.thumbKey, img.width, img.height, i++], c);
        }
        await q('UPDATE seller_subscriptions SET listings_used = listings_used + 1 WHERE id=$1', [sub.id], c);
        if (submitting) await q(`INSERT INTO listing_approvals (listing_id, actor_id, action) VALUES ($1,$2,'submitted')`, [l.id, req.user!.id], c);
        return l;
      });
      await audit(req, 'listing.created', { type: 'listing', id: listing.id }, { status: listing.status });
      if (listing.status === 'pending_approval') {
        await notifyAdmins('listing.pending', 'New listing awaiting review', `"${body.title}" by ${req.user!.full_name}`, `/admin/listings?status=pending_approval`);
      }
      res.status(201).json({ listing });
    } catch (e) {
      for (const o of processed) { await removeFile(o.key); await removeFile(o.thumbKey); }
      throw e;
    }
  }),
);

/** PATCH /api/my/listings/:id — edit; key changes on a published listing send it back to review */
r.patch(
  '/:id',
  requireSeller,
  writeLimiter,
  uploadLimiter,
  (req, res, next) => imageUpload(10).array('images', 10)(req, res, next),
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const existing = await ownListing(id, req.user!.id);
    if (['suspended', 'archived', 'sold', 'expired'].includes(existing.status)) {
      throw forbidden(`A ${existing.status.replace('_', ' ')} listing can't be edited.`, 'not_editable');
    }
    const body = parse(listingSchema, req.body);
    const removeIds = parse(z.array(uuid).max(20), JSON.parse(String(req.body.remove_image_ids || '[]')));
    const order = parse(z.array(uuid).max(20), JSON.parse(String(req.body.image_order || '[]')));
    await validateCategory(body.category_id, body.subcategory_id);
    const settings = await getSettings();

    const currentImages = await q<any>('SELECT id, path, thumb_path FROM listing_images WHERE listing_id=$1', [id]);
    const removable = currentImages.filter((i) => removeIds.includes(i.id));
    const files = (req.files as Express.Multer.File[]) ?? [];
    const finalCount = currentImages.length - removable.length + files.length;
    if (finalCount > settings.listings.max_images) throw bad(`You can have up to ${settings.listings.max_images} photos.`);

    const hash = contentHash(body);
    const imagesChanged = removable.length > 0 || files.length > 0;
    const moderatedChange =
      imagesChanged ||
      MODERATED_FIELDS.some((k) => {
        const a = (body as any)[k] ?? null;
        const b = existing[k] ?? null;
        return k === 'price' ? Number(a) !== Number(b) : a !== b;
      });

    let nextStatus = existing.status as string;
    let resubmitted = false;
    if (existing.status === 'published' && moderatedChange) {
      nextStatus = 'pending_approval';
      resubmitted = true;
    } else if (body.action === 'submit' && ['draft', 'rejected', 'changes_requested'].includes(existing.status)) {
      nextStatus = 'pending_approval';
      resubmitted = true;
    }
    if (nextStatus === 'pending_approval' && finalCount === 0) throw bad('Add at least one photo before submitting.', 'validation_error', { images: 'Add at least one photo.' });
    if (resubmitted && existing.status !== 'published') {
      const sub = await one<any>(`SELECT max_active_listings FROM seller_subscriptions WHERE user_id=$1 AND status='active' AND expires_at>now() ORDER BY expires_at DESC LIMIT 1`, [req.user!.id]);
      if (sub && (await activeCount(req.user!.id)) >= sub.max_active_listings) {
        throw forbidden(`Your plan allows ${sub.max_active_listings} active listings at a time.`, 'active_limit_reached');
      }
    }

    const processed = await processFiles(files);
    try {
      await tx(async (c) => {
        await q(
          `UPDATE listings SET title=$2, category_id=$3, subcategory_id=$4, description=$5, price=$6, negotiable=$7, condition=$8,
                  location=$9, contact_phone=$10, show_phone=$11, availability=$12, video_url=$13, content_hash=$14,
                  status=$15::listing_status,
                  submitted_at = CASE WHEN $16 THEN now() ELSE submitted_at END,
                  status_note = CASE WHEN $16 THEN NULL ELSE status_note END
            WHERE id=$1`,
          [id, body.title, body.category_id, body.subcategory_id ?? null, body.description, body.price, body.negotiable, body.condition,
            body.location, body.contact_phone ?? null, body.show_phone, body.availability, body.video_url ?? null, hash, nextStatus, resubmitted],
          c,
        );
        if (removable.length) await q('DELETE FROM listing_images WHERE listing_id=$1 AND id = ANY($2::uuid[])', [id, removable.map((i) => i.id)], c);
        // Apply requested order to kept images, then append the new uploads.
        const kept = currentImages.filter((i) => !removeIds.includes(i.id)).map((i) => i.id);
        const ordered = [...order.filter((x) => kept.includes(x)), ...kept.filter((x) => !order.includes(x))];
        let pos = 0;
        for (const imgId of ordered) await q('UPDATE listing_images SET sort_order=$3 WHERE id=$1 AND listing_id=$2', [imgId, id, pos++], c);
        for (const img of processed) {
          await q('INSERT INTO listing_images (listing_id, path, thumb_path, width, height, sort_order) VALUES ($1,$2,$3,$4,$5,$6)',
            [id, img.key, img.thumbKey, img.width, img.height, pos++], c);
        }
        if (resubmitted) await q(`INSERT INTO listing_approvals (listing_id, actor_id, action, note) VALUES ($1,$2,'submitted',$3)`,
          [id, req.user!.id, existing.status === 'published' ? 'Edited while published' : null], c);
      });
    } catch (e) {
      for (const o of processed) { await removeFile(o.key); await removeFile(o.thumbKey); }
      throw e;
    }
    for (const img of removable) { await removeFile(img.path); await removeFile(img.thumb_path); }
    await audit(req, 'listing.updated', { type: 'listing', id }, { from: existing.status, to: nextStatus });
    if (resubmitted) {
      await notifyAdmins('listing.pending', existing.status === 'published' ? 'Published listing edited — re-approval needed' : 'Listing resubmitted for review',
        `"${body.title}" by ${req.user!.full_name}`, `/admin/listings?status=pending_approval`);
    }
    res.json({ status: nextStatus, requires_review: nextStatus === 'pending_approval' });
  }),
);

/** POST /api/my/listings/:id/submit — draft / rejected / changes requested → pending review */
r.post(
  '/:id/submit',
  requireSeller,
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const l = await ownListing(id, req.user!.id);
    if (!['draft', 'rejected', 'changes_requested'].includes(l.status)) throw bad('This listing cannot be submitted right now.');
    const imgs = await one<{ n: number }>('SELECT count(*)::int AS n FROM listing_images WHERE listing_id=$1', [id]);
    if (!imgs?.n) throw bad('Add at least one photo before submitting.');
    const sub = await one<any>(`SELECT max_active_listings FROM seller_subscriptions WHERE user_id=$1 AND status='active' AND expires_at>now() ORDER BY expires_at DESC LIMIT 1`, [req.user!.id]);
    if (sub && (await activeCount(req.user!.id)) >= sub.max_active_listings) throw forbidden(`Your plan allows ${sub.max_active_listings} active listings at a time.`, 'active_limit_reached');
    await tx(async (c) => {
      await q(`UPDATE listings SET status='pending_approval', submitted_at=now(), status_note=NULL WHERE id=$1`, [id], c);
      await q(`INSERT INTO listing_approvals (listing_id, actor_id, action) VALUES ($1,$2,'submitted')`, [id, req.user!.id], c);
    });
    await audit(req, 'listing.submitted', { type: 'listing', id });
    await notifyAdmins('listing.pending', 'Listing submitted for review', `"${l.title}" by ${req.user!.full_name}`, `/admin/listings?status=pending_approval`);
    res.json({ status: 'pending_approval' });
  }),
);

/** POST /api/my/listings/:id/renew — expired listing goes back through moderation */
r.post(
  '/:id/renew',
  requireSeller,
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const l = await ownListing(id, req.user!.id);
    if (l.status !== 'expired') throw bad('Only expired listings can be renewed.');
    const sub = await one<any>(`SELECT max_active_listings FROM seller_subscriptions WHERE user_id=$1 AND status='active' AND expires_at>now() ORDER BY expires_at DESC LIMIT 1`, [req.user!.id]);
    if (sub && (await activeCount(req.user!.id)) >= sub.max_active_listings) throw forbidden('You have reached your active listing limit.', 'active_limit_reached');
    await tx(async (c) => {
      await q(`UPDATE listings SET status='pending_approval', submitted_at=now(), expiry_reminded_at=NULL WHERE id=$1`, [id], c);
      await q(`INSERT INTO listing_approvals (listing_id, actor_id, action, note) VALUES ($1,$2,'submitted','Renewal')`, [id, req.user!.id], c);
    });
    await audit(req, 'listing.renewed', { type: 'listing', id });
    await notifyAdmins('listing.pending', 'Expired listing renewed — review needed', `"${l.title}"`, `/admin/listings?status=pending_approval`);
    res.json({ status: 'pending_approval' });
  }),
);

/** POST /api/my/listings/:id/sold */
r.post(
  '/:id/sold',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const l = await ownListing(id, req.user!.id);
    if (l.status !== 'published') throw bad('Only live listings can be marked as sold.');
    await q(`UPDATE listings SET status='sold', sold_at=now(), is_featured=false WHERE id=$1`, [id]);
    await audit(req, 'listing.sold', { type: 'listing', id });
    res.json({ status: 'sold' });
  }),
);

/** POST /api/my/listings/:id/archive — take a listing down */
r.post(
  '/:id/archive',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const l = await ownListing(id, req.user!.id);
    if (l.status === 'suspended') throw forbidden('A suspended listing can only be changed by an administrator.');
    await q(`UPDATE listings SET status='archived', is_featured=false WHERE id=$1`, [id]);
    await audit(req, 'listing.archived', { type: 'listing', id });
    res.json({ status: 'archived' });
  }),
);

/** POST /api/my/listings/:id/feature — use one of the plan's featured slots (7 days) */
r.post(
  '/:id/feature',
  requireSeller,
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const l = await ownListing(id, req.user!.id);
    if (l.status !== 'published') throw bad('Only live listings can be featured.');
    if (l.is_featured && (!l.featured_until || new Date(l.featured_until) > new Date())) throw bad('This listing is already featured.');
    await tx(async (c) => {
      const sub = await one<any>(`SELECT * FROM seller_subscriptions WHERE user_id=$1 AND status='active' AND expires_at>now() ORDER BY expires_at DESC LIMIT 1 FOR UPDATE`, [req.user!.id], c);
      if (!sub?.featured_allowed) throw forbidden('Your plan does not include featured listings.', 'no_featured');
      if (sub.featured_used >= sub.featured_quota) throw forbidden(`You have used all ${sub.featured_quota} featured slots in your plan.`, 'featured_quota_reached');
      const until = new Date(Math.min(Date.now() + 7 * 86400_000, new Date(sub.expires_at).getTime()));
      await q('UPDATE listings SET is_featured=true, featured_until=$2 WHERE id=$1', [id, until], c);
      await q('UPDATE seller_subscriptions SET featured_used = featured_used + 1 WHERE id=$1', [sub.id], c);
    });
    await audit(req, 'listing.featured_by_seller', { type: 'listing', id });
    res.json({ ok: true });
  }),
);

/** DELETE /api/my/listings/:id — soft delete */
r.delete(
  '/:id',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const l = await ownListing(id, req.user!.id);
    if (l.status === 'suspended') throw forbidden('A suspended listing can only be removed by an administrator.');
    await q(`UPDATE listings SET status='archived', deleted_at=now(), is_featured=false WHERE id=$1`, [id]);
    await audit(req, 'listing.deleted', { type: 'listing', id });
    res.json({ ok: true });
  }),
);

export default r;
