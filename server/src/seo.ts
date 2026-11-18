import fs from 'node:fs';
import type { Request, Response, NextFunction } from 'express';
import { one, q } from './db.js';
import { config } from './config.js';
import { escapeHtml } from './lib/security.js';
import { getSettings } from './lib/settings.js';
import { publicUrl } from './lib/storage.js';

/**
 * Server-side SEO for the SPA. The built index.html is served for every client route,
 * with the <head> (title, description, canonical, Open Graph, JSON-LD) and a crawlable
 * text snapshot of the page filled in on the server. Browsers then boot the React app.
 */

const abs = (u: string | null | undefined) => (!u ? undefined : /^https?:/.test(u) ? u : `${config.appUrl}${u}`);
const strip = (s: string, n = 160) => s.replace(/\s+/g, ' ').trim().slice(0, n);

interface Meta {
  title: string;
  description: string;
  canonical: string;
  image?: string;
  type?: string;
  jsonLd?: object[];
  body?: string; // crawlable HTML snapshot (escaped)
  noindex?: boolean;
  status?: number;
}

async function metaFor(path: string, site: any): Promise<Meta> {
  const name = site.name as string;
  const base: Meta = { title: `${name} — ${site.tagline}`, description: site.tagline, canonical: `${config.appUrl}${path === '/' ? '/' : path}` };

  let m = path.match(/^\/item\/([a-z0-9-]{3,120})$/);
  if (m) {
    const l = await one<any>(
      `SELECT l.id, l.title, l.description, l.price, l.currency, l.condition, l.location, l.status, l.slug, l.published_at,
              c.name AS category, c.slug AS category_slug, p.full_name AS seller,
              (SELECT path FROM listing_images i WHERE i.listing_id=l.id ORDER BY sort_order LIMIT 1) AS image
         FROM listings l JOIN categories c ON c.id=l.category_id JOIN users u ON u.id=l.seller_id LEFT JOIN user_profiles p ON p.user_id=l.seller_id
        WHERE l.slug=$1 AND l.deleted_at IS NULL AND l.status IN ('published','sold') AND u.status='approved'`,
      [m[1]],
    );
    if (!l) return { ...base, title: `Listing not found — ${name}`, noindex: true, status: 404 };
    const price = `${l.currency} ${Number(l.price).toLocaleString('en-US')}`;
    const url = `${config.appUrl}/item/${l.slug}`;
    const image = abs(publicUrl(l.image));
    const conditionMap: Record<string, string> = { new: 'NewCondition', like_new: 'UsedCondition', good: 'UsedCondition', fair: 'UsedCondition', for_parts: 'DamagedCondition' };
    return {
      title: `${l.title} — ${price} | ${name}`,
      description: strip(`${price} · ${l.location} · ${l.description}`),
      canonical: url,
      image,
      type: 'product',
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: l.title,
          description: strip(l.description, 500),
          image: image ? [image] : undefined,
          category: l.category,
          offers: {
            '@type': 'Offer',
            price: Number(l.price),
            priceCurrency: l.currency,
            availability: l.status === 'sold' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
            itemCondition: `https://schema.org/${conditionMap[l.condition] ?? 'UsedCondition'}`,
            url,
            seller: { '@type': 'Person', name: l.seller },
          },
        },
        breadcrumb([[name, '/'], [l.category, `/category/${l.category_slug}`], [l.title, `/item/${l.slug}`]]),
      ],
      body: `<h1>${escapeHtml(l.title)}</h1><p>${escapeHtml(price)} — ${escapeHtml(l.location)}</p><p>${escapeHtml(strip(l.description, 2000))}</p>`,
    };
  }

  m = path.match(/^\/category\/([a-z0-9-]{1,80})$/);
  if (m) {
    const c = await one<any>(`SELECT id, name, slug FROM categories WHERE slug=$1 AND deleted_at IS NULL AND is_active`, [m[1]]);
    if (!c) return { ...base, noindex: true, status: 404 };
    const items = await q<any>(`SELECT title, slug, price, currency FROM listings WHERE category_id=$1 AND status='published' AND deleted_at IS NULL ORDER BY published_at DESC LIMIT 30`, [c.id]);
    return {
      title: `${c.name} for sale | ${name}`,
      description: `Browse ${c.name.toLowerCase()} for sale on ${name}. ${site.tagline}`,
      canonical: `${config.appUrl}/category/${c.slug}`,
      jsonLd: [breadcrumb([[name, '/'], [c.name, `/category/${c.slug}`]])],
      body: `<h1>${escapeHtml(c.name)}</h1><ul>${items.map((i) => `<li><a href="/item/${escapeHtml(i.slug)}">${escapeHtml(i.title)} — ${escapeHtml(i.currency)} ${Number(i.price).toLocaleString('en-US')}</a></li>`).join('')}</ul>`,
    };
  }

  m = path.match(/^\/seller\/([0-9a-f-]{36})$/i);
  if (m) {
    const s = await one<any>(`SELECT p.full_name, p.location FROM users u JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1 AND u.status='approved' AND u.role='user'`, [m[1]]);
    if (!s) return { ...base, noindex: true, status: 404 };
    return { title: `${s.full_name} — seller on ${name}`, description: `See listings from ${s.full_name}${s.location ? ` in ${s.location}` : ''} on ${name}.`, canonical: `${config.appUrl}/seller/${m[1]}` };
  }

  if (path === '/search') return { ...base, title: `Search listings | ${name}`, canonical: `${config.appUrl}/search` };
  if (path === '/terms') return { ...base, title: `Terms and Conditions | ${name}` };
  if (path === '/privacy') return { ...base, title: `Privacy Policy | ${name}` };
  if (path === '/') {
    return {
      ...base,
      jsonLd: [{
        '@context': 'https://schema.org', '@type': 'WebSite', name, url: `${config.appUrl}/`,
        potentialAction: { '@type': 'SearchAction', target: `${config.appUrl}/search?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
      }],
    };
  }
  // Private app areas are never indexed.
  return { ...base, noindex: /^\/(dashboard|admin|messages|login|register|verify-email|reset-password|forgot-password)/.test(path) };
}

function breadcrumb(items: [string, string][]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([n, u], i) => ({ '@type': 'ListItem', position: i + 1, name: n, item: `${config.appUrl}${u}` })),
  };
}

export function seoHtmlHandler(indexPath: string) {
  let template = fs.readFileSync(indexPath, 'utf8');
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!config.isProd) template = fs.readFileSync(indexPath, 'utf8');
      const site = (await getSettings()).site;
      const meta = await metaFor(req.path, site);
      const tags = [
        `<title>${escapeHtml(meta.title)}</title>`,
        `<meta name="description" content="${escapeHtml(meta.description)}">`,
        `<link rel="canonical" href="${escapeHtml(meta.canonical)}">`,
        meta.noindex ? `<meta name="robots" content="noindex">` : '',
        `<meta property="og:site_name" content="${escapeHtml(site.name)}">`,
        `<meta property="og:title" content="${escapeHtml(meta.title)}">`,
        `<meta property="og:description" content="${escapeHtml(meta.description)}">`,
        `<meta property="og:url" content="${escapeHtml(meta.canonical)}">`,
        `<meta property="og:type" content="${meta.type ?? 'website'}">`,
        meta.image ? `<meta property="og:image" content="${escapeHtml(meta.image)}">` : '',
        `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}">`,
        site.favicon_url ? `<link rel="icon" href="${escapeHtml(site.favicon_url)}">` : '',
        `<meta name="theme-color" content="${escapeHtml(site.primary_color)}">`,
        ...(meta.jsonLd ?? []).map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`),
      ].filter(Boolean).join('\n    ');
      const html = template
        .replace(/<title>.*?<\/title>/s, '')
        .replace('<!--SEO_HEAD-->', tags)
        .replace('<!--SEO_BODY-->', meta.body ?? ''); // inside #root: React replaces it on mount
      res.status(meta.status ?? 200).set('Content-Type', 'text/html; charset=utf-8').set('Cache-Control', 'no-cache').send(html);
    } catch (e) {
      next(e);
    }
  };
}

export async function sitemap(_req: Request, res: Response, next: NextFunction) {
  try {
    const [listings, cats, sellers] = await Promise.all([
      q<any>(`SELECT l.slug, l.updated_at FROM listings l JOIN users u ON u.id=l.seller_id WHERE l.status='published' AND l.deleted_at IS NULL AND u.status='approved' ORDER BY l.published_at DESC LIMIT 45000`),
      q<any>(`SELECT slug, updated_at FROM categories WHERE deleted_at IS NULL AND is_active`),
      q<any>(`SELECT DISTINCT l.seller_id AS id FROM listings l WHERE l.status='published' AND l.deleted_at IS NULL LIMIT 4000`),
    ]);
    const url = (loc: string, mod?: string, freq = 'daily') =>
      `<url><loc>${escapeHtml(config.appUrl + loc)}</loc>${mod ? `<lastmod>${new Date(mod).toISOString()}</lastmod>` : ''}<changefreq>${freq}</changefreq></url>`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[
      url('/', undefined, 'hourly'),
      ...cats.map((c) => url(`/category/${c.slug}`, c.updated_at)),
      ...listings.map((l) => url(`/item/${l.slug}`, l.updated_at, 'weekly')),
      ...sellers.map((s) => url(`/seller/${s.id}`, undefined, 'weekly')),
    ].join('')}</urlset>`;
    res.set('Content-Type', 'application/xml').set('Cache-Control', 'public, max-age=3600').send(xml);
  } catch (e) {
    next(e);
  }
}

export function robots(_req: Request, res: Response) {
  res.type('text/plain').send(
    ['User-agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /dashboard', 'Disallow: /admin', 'Disallow: /messages', '', `Sitemap: ${config.appUrl}/sitemap.xml`].join('\n'),
  );
}
