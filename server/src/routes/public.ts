import { Router } from 'express';
import { one, q } from '../db.js';
import { ah, notFound, parse, uuid } from '../lib/http.js';
import { getSettings, publicSettings } from '../lib/settings.js';
import { publicUrl } from '../lib/storage.js';
import { GUIDES, cityContent, categoryContent, guideBySlug, gtaBySlug } from '../seoContent.js';
import { citySlug } from '../seo.js';
import { CARD_FROM, CARD_SELECT, PUBLIC_WHERE, toCard } from '../lib/listings.js';

const r = Router();

r.get(
  '/settings',
  ah(async (_req, res) => {
    const s = await getSettings();
    res.set('Cache-Control', 'public, max-age=60');
    res.json(publicSettings(s));
  }),
);

r.get(
  '/pages/:key',
  ah(async (req, res) => {
    const s = await getSettings();
    const key = req.params.key;
    if (key !== 'terms' && key !== 'privacy') throw notFound();
    res.json({ title: key === 'terms' ? 'Terms and Conditions' : 'Privacy Policy', body: s.legal[key] });
  }),
);

r.get(
  '/categories',
  ah(async (_req, res) => {
    const cats = await q<any>(
      `SELECT c.id, c.name, c.slug, c.icon, c.image_path, c.sort_order,
              (SELECT count(*)::int FROM listings l WHERE l.category_id=c.id AND l.status='published' AND l.deleted_at IS NULL) AS listing_count
         FROM categories c WHERE c.deleted_at IS NULL AND c.is_active ORDER BY c.sort_order, c.name`,
    );
    const subs = await q<any>(`SELECT id, category_id, name, slug FROM subcategories WHERE deleted_at IS NULL ORDER BY sort_order, name`);
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      items: cats.map((c) => ({
        ...c,
        image_url: publicUrl(c.image_path),
        image_path: undefined,
        subcategories: subs.filter((s) => s.category_id === c.id).map(({ category_id: _c, ...s }) => s),
      })),
    });
  }),
);

/** Public seller profile */
r.get(
  '/sellers/:id',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const s = await one<any>(
      `SELECT u.id, u.created_at, u.status, p.full_name, p.display_name, p.avatar_path, p.location, p.bio, is_active_seller(u.id) AS verified,
              (SELECT count(*)::int FROM listings l WHERE l.seller_id=u.id AND l.status='published' AND l.deleted_at IS NULL) AS active_listings,
              (SELECT count(*)::int FROM listings l WHERE l.seller_id=u.id AND l.status='sold' AND l.deleted_at IS NULL) AS sold_listings
         FROM users u JOIN user_profiles p ON p.user_id=u.id
        WHERE u.id=$1 AND u.deleted_at IS NULL AND u.role='user'`,
      [id],
    );
    // Only expose people who are (or were) sellers in good standing.
    if (!s || s.status !== 'approved' || (s.active_listings === 0 && s.sold_listings === 0 && !s.verified)) throw notFound('Seller not found.');
    const params: unknown[] = [id];
    const vp = req.user ? (params.push(req.user.id), '$2') : null;
    const listings = await q(`SELECT ${CARD_SELECT(vp)} ${CARD_FROM} WHERE ${PUBLIC_WHERE} AND l.seller_id=$1 ORDER BY l.published_at DESC LIMIT 60`, params);
    const sold = await q(`SELECT ${CARD_SELECT(vp)} ${CARD_FROM} WHERE l.status='sold' AND l.deleted_at IS NULL AND l.seller_id=$1 ORDER BY l.sold_at DESC LIMIT 12`, params);
    res.json({
      seller: {
        id: s.id,
        name: s.display_name || s.full_name,
        avatar_url: publicUrl(s.avatar_path),
        location: s.location,
        bio: s.bio,
        member_since: s.created_at,
        verified: s.verified,
        status: s.verified ? 'Verified seller' : 'Seller',
        active_listings: s.active_listings,
        sold_listings: s.sold_listings,
      },
      listings: listings.map(toCard),
      sold: sold.map(toCard),
    });
  }),
);

/** Local-SEO copy for city / category pages and guides (the same text is rendered into the page HTML for Google). */
r.get(
  '/content/city/:slug',
  ah(async (req, res) => {
    const slug = String(req.params.slug).slice(0, 60);
    const site = (await getSettings()).site;
    const extra = (site.locations as string[]).find((l) => citySlug(l) === slug);
    const g = gtaBySlug.get(slug);
    if (!g && !extra) throw notFound();
    const cat = typeof req.query.category === 'string' && req.query.category
      ? await one<any>(`SELECT name, slug FROM categories WHERE slug=$1 AND deleted_at IS NULL AND is_active`, [req.query.category.slice(0, 80)])
      : null;
    const cats = await q<any>(`SELECT name, slug FROM categories WHERE deleted_at IS NULL AND is_active ORDER BY sort_order LIMIT 12`);
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ ...cityContent(g ?? { name: extra!.split(',')[0]!.trim(), slug }, cat, cats), categories: cats });
  }),
);

r.get(
  '/content/category/:slug',
  ah(async (req, res) => {
    const cat = await one<any>(`SELECT name, slug FROM categories WHERE slug=$1 AND deleted_at IS NULL AND is_active`, [String(req.params.slug).slice(0, 80)]);
    if (!cat) throw notFound();
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ ...categoryContent(cat), categories: [] });
  }),
);

r.get('/content/guides', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ items: GUIDES.map((g) => ({ slug: g.slug, title: g.title, description: g.description, updated: g.updated })) });
});

r.get(
  '/content/guides/:slug',
  ah(async (req, res) => {
    const g = guideBySlug.get(String(req.params.slug));
    if (!g) throw notFound();
    res.set('Cache-Control', 'public, max-age=300');
    res.json(g);
  }),
);

export default r;
