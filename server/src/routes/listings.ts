import { Router } from 'express';
import { z } from 'zod';
import { one, q } from '../db.js';
import { ah, notFound, pageParams, parse } from '../lib/http.js';
import { CARD_FROM, CARD_SELECT, PUBLIC_WHERE, toCard, likeEscape, CONDITIONS } from '../lib/listings.js';
import { publicUrl } from '../lib/storage.js';

const r = Router();

const searchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().max(80).optional(),
  subcategory: z.string().max(80).optional(),
  min_price: z.coerce.number().min(0).optional(),
  max_price: z.coerce.number().min(0).optional(),
  location: z.string().trim().max(80).optional(),
  condition: z.union([z.enum(CONDITIONS), z.array(z.enum(CONDITIONS))]).optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'relevance']).optional(),
  featured: z.enum(['1', 'true']).optional(),
  seller: z.string().uuid().optional(),
  /** City the visitor is in (e.g. "Mississauga, ON"). Listings from that city are listed first. */
  near: z.string().trim().max(80).optional(),
});

/** "Mississauga, ON" -> LIKE pattern "Mississauga%" (city part only). */
const cityPattern = (near?: string) => {
  const city = (near ?? '').split(',')[0]!.trim();
  return city.length >= 2 ? `${likeEscape(city)}%` : null;
};

/** GET /api/listings — public search with filters, sorting and pagination. */
r.get(
  '/',
  ah(async (req, res) => {
    const f = parse(searchSchema, req.query);
    const { page, limit, offset } = pageParams(req.query);
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const where: string[] = [PUBLIC_WHERE];
    let rank = '0';

    if (f.q) {
      const qp = p(f.q);
      const lp = p(`%${likeEscape(f.q)}%`);
      where.push(`(l.search_vector @@ websearch_to_tsquery('simple', ${qp}) OR l.title ILIKE ${lp} OR c.name ILIKE ${lp})`);
      rank = `ts_rank(l.search_vector, websearch_to_tsquery('simple', ${qp})) + CASE WHEN l.title ILIKE ${lp} THEN 0.5 ELSE 0 END`;
    }
    if (f.category) where.push(`c.slug = ${p(f.category)}`);
    if (f.subcategory) where.push(`l.subcategory_id = (SELECT s.id FROM subcategories s WHERE s.category_id = l.category_id AND s.slug = ${p(f.subcategory)} AND s.deleted_at IS NULL)`);
    if (f.min_price !== undefined) where.push(`l.price >= ${p(f.min_price)}`);
    if (f.max_price !== undefined) where.push(`l.price <= ${p(f.max_price)}`);
    if (f.location) where.push(`l.location ILIKE ${p(`%${likeEscape(f.location)}%`)}`);
    if (f.condition) where.push(`l.condition = ANY(${p(Array.isArray(f.condition) ? f.condition : [f.condition])}::listing_condition[])`);
    if (f.featured) where.push(`l.is_featured AND (l.featured_until IS NULL OR l.featured_until > now())`);
    if (f.seller) where.push(`l.seller_id = ${p(f.seller)}`);

    const sort = f.sort ?? (f.q ? 'relevance' : 'newest');
    // Visitor's city first (not for price sorts, and not when a location filter is already chosen).
    const nearPat = !f.location && (sort === 'newest' || sort === 'relevance') ? cityPattern(f.near) : null;

    const whereSql = where.join(' AND ');
    const [{ total }] = await q<{ total: number }>(`SELECT count(*)::int AS total ${CARD_FROM} WHERE ${whereSql}`, params);
    // These params are only used by the page query, so they are added after the count query.
    const nearSql = nearPat ? `(l.location ILIKE ${p(nearPat)}) DESC, ` : '';
    const order = {
      newest: `${nearSql}l.published_at DESC`,
      price_asc: 'l.price ASC, l.published_at DESC',
      price_desc: 'l.price DESC, l.published_at DESC',
      relevance: `${nearSql}${rank} DESC, l.is_featured DESC, l.published_at DESC`,
    }[sort];
    const viewer = req.user ? p(req.user.id) : null;
    const rows = await q(
      `SELECT ${CARD_SELECT(viewer)} ${CARD_FROM} WHERE ${whereSql} ORDER BY ${order} LIMIT ${p(limit)} OFFSET ${p(offset)}`,
      params,
    );
    res.set('Cache-Control', 'no-store');
    res.json({ items: rows.map(toCard), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  }),
);

/** GET /api/listings/home — everything the homepage needs in one round trip. */
r.get(
  '/home',
  ah(async (req, res) => {
    const viewer = req.user?.id ?? null;
    const vp = viewer ? '$1' : null;
    const base: unknown[] = viewer ? [viewer] : [];
    const card = CARD_SELECT(vp);
    // Visitor's city first on every strip.
    const nearPat = cityPattern(typeof req.query.near === 'string' ? req.query.near.slice(0, 80) : undefined);
    if (nearPat) base.push(nearPat);
    const nearFirst = nearPat ? `(l.location ILIKE $${base.length}) DESC, ` : '';

    const [featured, recent, popularCats, sellers] = await Promise.all([
      q(`SELECT ${card} ${CARD_FROM} WHERE ${PUBLIC_WHERE} AND l.is_featured AND (l.featured_until IS NULL OR l.featured_until > now())
         ORDER BY ${nearFirst}l.published_at DESC LIMIT 8`, base),
      q(`SELECT ${card} ${CARD_FROM} WHERE ${PUBLIC_WHERE} ORDER BY ${nearFirst}l.published_at DESC LIMIT 12`, base),
      q(`SELECT c.id, c.name, c.slug, c.icon, c.image_path, count(l.id)::int AS listing_count
           FROM categories c
           LEFT JOIN listings l ON l.category_id = c.id AND l.status='published' AND l.deleted_at IS NULL
          WHERE c.deleted_at IS NULL AND c.is_active
          GROUP BY c.id ORDER BY listing_count DESC, c.sort_order LIMIT 8`),
      q(`SELECT u.id, p.full_name AS name, p.avatar_path, p.location, u.created_at,
                count(l.id)::int AS active_listings
           FROM users u JOIN user_profiles p ON p.user_id = u.id
           JOIN listings l ON l.seller_id = u.id AND l.status = 'published' AND l.deleted_at IS NULL
          WHERE u.status = 'approved' AND is_active_seller(u.id)
          GROUP BY u.id, p.full_name, p.avatar_path, p.location
          ORDER BY active_listings DESC LIMIT 6`),
    ]);

    // Recommended: categories the viewer favourited, otherwise the most-viewed recent listings.
    let recommended: any[] = [];
    if (viewer) {
      recommended = await q(
        `SELECT ${card} ${CARD_FROM} WHERE ${PUBLIC_WHERE}
           AND l.category_id IN (SELECT l2.category_id FROM favorites f JOIN listings l2 ON l2.id=f.listing_id WHERE f.user_id=$1)
           AND NOT EXISTS (SELECT 1 FROM favorites f WHERE f.user_id=$1 AND f.listing_id=l.id)
           AND l.seller_id <> $1
         ORDER BY ${nearFirst}l.view_count DESC, l.published_at DESC LIMIT 8`,
        base,
      );
    }
    if (recommended.length < 4) {
      recommended = await q(
        `SELECT ${card} ${CARD_FROM} WHERE ${PUBLIC_WHERE} AND l.published_at > now() - interval '60 days'
         ORDER BY ${nearFirst}l.view_count DESC, l.published_at DESC LIMIT 8`,
        base,
      );
    }

    res.json({
      featured: featured.map(toCard),
      recent: recent.map(toCard),
      recommended: recommended.map(toCard),
      popular_categories: popularCats.map((c: any) => ({ ...c, image_url: publicUrl(c.image_path) })),
      seller_highlights: sellers.map((s: any) => ({ ...s, avatar_url: publicUrl(s.avatar_path), avatar_path: undefined })),
    });
  }),
);

/** GET /api/listings/suggest?q=cur&near=Toronto — live matches for the search box (published listings only). */
r.get(
  '/suggest',
  ah(async (req, res) => {
    const term = String(req.query.q ?? '').trim().slice(0, 60);
    if (term.length < 2) return res.json({ items: [] });
    const nearPat = cityPattern(typeof req.query.near === 'string' ? req.query.near.slice(0, 80) : undefined);
    const params: unknown[] = [`%${likeEscape(term)}%`, `${likeEscape(term)}%`];
    if (nearPat) params.push(nearPat);
    const nearSql = nearPat ? '(l.location ILIKE $3) DESC, ' : '';
    const rows = await q(
      `SELECT l.slug, l.title, l.price, l.currency, l.location, c.name AS category_name,
              (SELECT thumb_path FROM listing_images i WHERE i.listing_id = l.id ORDER BY sort_order, created_at LIMIT 1) AS thumb_path
         ${CARD_FROM}
        WHERE ${PUBLIC_WHERE} AND (l.title ILIKE $1 OR c.name ILIKE $1)
        ORDER BY ${nearSql}(l.title ILIKE $2) DESC, l.is_featured DESC, l.published_at DESC
        LIMIT 6`,
      params,
    );
    res.set('Cache-Control', 'no-store');
    res.json({
      items: rows.map((r: any) => ({
        slug: r.slug, title: r.title, price: r.price, currency: r.currency, location: r.location,
        category: r.category_name, image: publicUrl(r.thumb_path),
      })),
    });
  }),
);

/** GET /api/listings/by-ids?ids=a,b — for the "recently viewed" strip (ids kept client-side). */
r.get(
  '/by-ids',
  ah(async (req, res) => {
    const ids = String(req.query.ids ?? '')
      .split(',')
      .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
      .slice(0, 20);
    if (!ids.length) return res.json({ items: [] });
    const params: unknown[] = [ids];
    const vp = req.user ? (params.push(req.user.id), '$2') : null;
    const rows = await q(`SELECT ${CARD_SELECT(vp)} ${CARD_FROM} WHERE ${PUBLIC_WHERE} AND l.id = ANY($1::uuid[])`, params);
    const byId = new Map(rows.map((x: any) => [x.id, toCard(x)]));
    res.json({ items: ids.map((id) => byId.get(id)).filter(Boolean) });
  }),
);

/** Load full listing detail. Owners and admins may preview non-public listings. */
export async function loadListingDetail(idOrSlug: string, viewer?: Express.Request['user']) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const params: unknown[] = [idOrSlug];
  const vp = viewer ? (params.push(viewer.id), '$2') : null;
  const row = await one<any>(
    `SELECT ${CARD_SELECT(vp)}, l.description, l.subcategory_id, l.category_id, l.contact_phone, l.show_phone, l.video_url,
            l.view_count, l.status_note, l.expires_at, l.sold_at, l.updated_at, l.deleted_at,
            su.status AS seller_status, su.created_at AS seller_since, p.avatar_path AS seller_avatar, p.location AS seller_location,
            s.name AS subcategory_name, s.slug AS subcategory_slug
       ${CARD_FROM}
       LEFT JOIN subcategories s ON s.id = l.subcategory_id
      WHERE ${isUuid ? 'l.id = $1' : 'l.slug = $1'}`,
    params,
  );
  if (!row || row.deleted_at) return null;
  const isPublic = row.status === 'published' && row.seller_status === 'approved';
  const isOwner = viewer?.id === row.seller_id;
  const isAdmin = viewer?.role === 'admin';
  // Sold listings stay viewable (marked sold) so shared links don't break.
  if (!isPublic && !isOwner && !isAdmin && row.status !== 'sold') return null;

  const images = await q<any>('SELECT id, path, thumb_path, width, height FROM listing_images WHERE listing_id=$1 ORDER BY sort_order, created_at', [row.id]);
  const sellerStats = await one<any>(
    `SELECT count(*) FILTER (WHERE status='published')::int AS active, count(*) FILTER (WHERE status='sold')::int AS sold
       FROM listings WHERE seller_id=$1 AND deleted_at IS NULL`,
    [row.seller_id],
  );
  return {
    ...toCard(row),
    description: row.description,
    category_id: row.category_id,
    subcategory_id: row.subcategory_id,
    subcategory: row.subcategory_id ? { name: row.subcategory_name, slug: row.subcategory_slug } : null,
    contact_phone: row.show_phone ? row.contact_phone : null,
    video_url: row.video_url,
    view_count: row.view_count,
    expires_at: row.expires_at,
    sold_at: row.sold_at,
    updated_at: row.updated_at,
    status_note: isOwner || isAdmin ? row.status_note : undefined,
    images: images.map((i) => ({ id: i.id, url: publicUrl(i.path), thumb: publicUrl(i.thumb_path), width: i.width, height: i.height })),
    seller: {
      id: row.seller_id,
      name: row.seller_name,
      verified: !!row.seller_verified,
      avatar_url: publicUrl(row.seller_avatar),
      location: row.seller_location,
      member_since: row.seller_since,
      active_listings: sellerStats?.active ?? 0,
      sold_listings: sellerStats?.sold ?? 0,
    },
    is_owner: isOwner,
  };
}

r.get(
  '/:idOrSlug',
  ah(async (req, res) => {
    const listing = await loadListingDetail(String(req.params.idOrSlug).slice(0, 120), req.user);
    if (!listing) throw notFound('This listing is not available.');
    if (!listing.is_owner && listing.status === 'published') {
      q('UPDATE listings SET view_count = view_count + 1 WHERE id=$1 AND status = $2', [listing.id, 'published']).catch(() => {});
    }
    const params: unknown[] = [listing.category_id, listing.id, listing.subcategory_id];
    const vp = req.user ? (params.push(req.user.id), '$4') : null;
    const similar = await q(
      `SELECT ${CARD_SELECT(vp)} ${CARD_FROM} WHERE ${PUBLIC_WHERE} AND l.category_id = $1 AND l.id <> $2
       ORDER BY (l.subcategory_id IS NOT DISTINCT FROM $3::uuid) DESC, l.published_at DESC LIMIT 8`,
      params,
    );
    res.json({ listing, similar: similar.map(toCard) });
  }),
);

export default r;
