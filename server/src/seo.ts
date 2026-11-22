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

/** "Kitchener-Waterloo, ON" -> "kitchener-waterloo", "St. John's, NL" -> "st-johns". Same rule as the client. */
export const citySlug = (loc: string) =>
  loc.split(',')[0]!.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const cityName = (loc: string) => loc.split(',')[0]!.trim();
const money = (cur: string, n: unknown) => `${cur === 'CAD' ? 'CA$' : cur + ' '}${Number(n).toLocaleString('en-CA')}`;

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
              c.name AS category, c.slug AS category_slug, COALESCE(NULLIF(p.display_name,''), p.full_name) AS seller,
              (SELECT path FROM listing_images i WHERE i.listing_id=l.id ORDER BY sort_order LIMIT 1) AS image
         FROM listings l JOIN categories c ON c.id=l.category_id JOIN users u ON u.id=l.seller_id LEFT JOIN user_profiles p ON p.user_id=l.seller_id
        WHERE l.slug=$1 AND l.deleted_at IS NULL AND l.status IN ('published','sold') AND u.status='approved'`,
      [m[1]],
    );
    if (!l) return { ...base, title: `Listing not found — ${name}`, noindex: true, status: 404 };
    const price = money(l.currency, l.price);
    const url = `${config.appUrl}/item/${l.slug}`;
    const image = abs(publicUrl(l.image));
    const conditionMap: Record<string, string> = { new: 'NewCondition', like_new: 'UsedCondition', good: 'UsedCondition', fair: 'UsedCondition', for_parts: 'DamagedCondition' };
    return {
      title: `${l.title} — ${price} | ${name}`,
      description: strip(`${l.title} for sale in ${l.location}, Canada — ${price}. ${l.description}`),
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
            availableAtOrFrom: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: cityName(l.location ?? ''), addressCountry: 'CA' } },
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
      body: `<h1>${escapeHtml(c.name)}</h1><ul>${items.map((i) => `<li><a href="/item/${escapeHtml(i.slug)}">${escapeHtml(i.title)} — ${escapeHtml(money(i.currency, i.price))}</a></li>`).join('')}</ul>`,
    };
  }

  m = path.match(/^\/city\/([a-z0-9-]{2,60})(?:\/([a-z0-9-]{1,80}))?$/);
  if (m) {
    const loc = (site.locations as string[]).find((x) => citySlug(x) === m![1]);
    if (!loc) return { ...base, noindex: true, status: 404 };
    const city = cityName(loc);
    const cat = m[2] ? await one<any>(`SELECT id, name, slug FROM categories WHERE slug=$1 AND deleted_at IS NULL AND is_active`, [m[2]]) : null;
    if (m[2] && !cat) return { ...base, noindex: true, status: 404 };
    const params: unknown[] = [`${city.replace(/[\\%_]/g, '\\$&')}%`];
    if (cat) params.push(cat.id);
    const items = await q<any>(
      `SELECT l.title, l.slug, l.price, l.currency FROM listings l JOIN users u ON u.id=l.seller_id
        WHERE l.status='published' AND l.deleted_at IS NULL AND u.status='approved' AND l.location ILIKE $1 ${cat ? 'AND l.category_id=$2' : ''}
        ORDER BY l.published_at DESC LIMIT 30`,
      params,
    );
    const what = cat ? `${cat.name} for sale` : 'Buy & sell';
    const path2 = `/city/${m[1]}${cat ? `/${cat.slug}` : ''}`;
    return {
      title: `${what} in ${loc}, Canada | ${name}`,
      description: cat
        ? `Find ${cat.name.toLowerCase()} for sale in ${city}, ${loc.split(',')[1]?.trim() ?? 'Canada'}. Browse local ads, compare prices and message sellers on ${name}.`
        : `Buy and sell locally in ${city}, ${loc.split(',')[1]?.trim() ?? 'Canada'}. Browse the latest ads from ${city} sellers — electronics, vehicles, furniture and more on ${name}.`,
      canonical: `${config.appUrl}${path2}`,
      noindex: items.length === 0, // no thin pages in Google
      jsonLd: [breadcrumb([[name, '/'], [`${city}`, `/city/${m[1]}`], ...(cat ? [[cat.name, path2] as [string, string]] : [])])],
      body: `<h1>${escapeHtml(what)} in ${escapeHtml(city)}</h1><ul>${items.map((i) => `<li><a href="/item/${escapeHtml(i.slug)}">${escapeHtml(i.title)} — ${escapeHtml(money(i.currency, i.price))}</a></li>`).join('')}</ul>`,
    };
  }

  m = path.match(/^\/seller\/([0-9a-f-]{36})$/i);
  if (m) {
    const s = await one<any>(`SELECT COALESCE(NULLIF(p.display_name,''), p.full_name) AS full_name, p.location FROM users u JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1 AND u.status='approved' AND u.role='user'`, [m[1]]);
    if (!s) return { ...base, noindex: true, status: 404 };
    return { title: `${s.full_name} — seller on ${name}`, description: `See listings from ${s.full_name}${s.location ? ` in ${s.location}` : ''} on ${name}.`, canonical: `${config.appUrl}/seller/${m[1]}` };
  }

  if (path === '/search') return { ...base, title: `Search listings | ${name}`, canonical: `${config.appUrl}/search` };
  if (path === '/terms') return { ...base, title: `Terms and Conditions | ${name}` };
  if (path === '/privacy') return { ...base, title: `Privacy Policy | ${name}` };
  if (path === '/') {
    const cities = (site.locations as string[]).slice(0, 8);
    return {
      ...base,
      title: `${name} — Buy & Sell Locally in Canada`,
      description: `Free classifieds in Canada: buy and sell phones, cars, furniture, electronics and more in ${cities.slice(0, 4).map(cityName).join(', ')} and across the GTA. Message sellers directly on ${name}.`,
      body: `<h1>${escapeHtml(name)} — buy and sell locally in Canada</h1><ul>${cities.map((c) => `<li><a href="/city/${citySlug(c)}">Buy &amp; sell in ${escapeHtml(cityName(c))}</a></li>`).join('')}</ul>`,
      jsonLd: [{
        '@context': 'https://schema.org', '@type': 'Organization', name, url: `${config.appUrl}/`,
        logo: `${config.appUrl}/icon-512.png`, areaServed: { '@type': 'Country', name: 'Canada' },
      }, {
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
        `<meta property="og:locale" content="en_CA">`,
        `<link rel="alternate" hreflang="en-CA" href="${escapeHtml(meta.canonical)}">`,
        `<link rel="alternate" hreflang="x-default" href="${escapeHtml(meta.canonical)}">`,
        `<meta name="geo.region" content="CA">`,
        `<meta name="twitter:title" content="${escapeHtml(meta.title)}">`,
        `<meta name="twitter:description" content="${escapeHtml(meta.description)}">`,
        `<meta property="og:image" content="${escapeHtml(meta.image ?? `${config.appUrl}/icon-512.png`)}">`,
        `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}">`,
        site.favicon_url ? `<link rel="icon" href="${escapeHtml(site.favicon_url)}">` : '',
        `<meta name="theme-color" content="${escapeHtml(site.primary_color)}">`,
        ...(meta.jsonLd ?? []).map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`),
      ].filter(Boolean).join('\n    ');
      const html = template
        .replace('<html lang="en">', '<html lang="en-CA">')
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
    const site = (await getSettings()).site;
    const [listings, cats, sellers, combos] = await Promise.all([
      q<any>(`SELECT l.slug, l.updated_at FROM listings l JOIN users u ON u.id=l.seller_id WHERE l.status='published' AND l.deleted_at IS NULL AND u.status='approved' ORDER BY l.published_at DESC LIMIT 45000`),
      q<any>(`SELECT slug, updated_at FROM categories WHERE deleted_at IS NULL AND is_active`),
      q<any>(`SELECT DISTINCT l.seller_id AS id FROM listings l WHERE l.status='published' AND l.deleted_at IS NULL LIMIT 4000`),
      q<any>(`SELECT DISTINCT split_part(l.location, ',', 1) AS city, c.slug FROM listings l JOIN categories c ON c.id=l.category_id JOIN users u ON u.id=l.seller_id WHERE l.status='published' AND l.deleted_at IS NULL AND u.status='approved'`),
    ]);
    const cityByName = new Map((site.locations as string[]).map((l) => [cityName(l).toLowerCase(), citySlug(l)]));
    const withListings = new Set(combos.map((c) => String(c.city).trim().toLowerCase()));
    const url = (loc: string, mod?: string, freq = 'daily') =>
      `<url><loc>${escapeHtml(config.appUrl + loc)}</loc>${mod ? `<lastmod>${new Date(mod).toISOString()}</lastmod>` : ''}<changefreq>${freq}</changefreq></url>`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[
      url('/', undefined, 'hourly'),
      ...cats.map((c) => url(`/category/${c.slug}`, c.updated_at)),
      ...[...withListings].flatMap((n) => (cityByName.has(n) ? [url(`/city/${cityByName.get(n)}`)] : [])),
      ...combos.flatMap((c) => { const cs = cityByName.get(String(c.city).trim().toLowerCase()); return cs ? [url(`/city/${cs}/${c.slug}`, undefined, 'weekly')] : []; }),
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
    ['User-agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /dashboard', 'Disallow: /admin', 'Disallow: /messages', 'Disallow: /login', 'Disallow: /register', '', `Sitemap: ${config.appUrl}/sitemap.xml`].join('\n'),
  );
}
