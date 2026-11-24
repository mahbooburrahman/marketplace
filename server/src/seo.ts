import fs from 'node:fs';
import type { Request, Response, NextFunction } from 'express';
import { one, q } from './db.js';
import { config } from './config.js';
import { escapeHtml } from './lib/security.js';
import { getSettings } from './lib/settings.js';
import { publicUrl } from './lib/storage.js';
import { GTA_AREAS, GUIDES, cityContent, categoryContent, guideBySlug, gtaBySlug, type PageContent, type Faq } from './seoContent.js';

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

/** Cities from admin settings plus every GTA area, de-duplicated by slug. */
function allAreas(site: any): { name: string; slug: string; loc: string }[] {
  const out = new Map<string, { name: string; slug: string; loc: string }>();
  for (const a of GTA_AREAS) out.set(a.slug, { name: a.name, slug: a.slug, loc: `${a.name}, ON` });
  for (const l of site.locations as string[]) if (!out.has(citySlug(l))) out.set(citySlug(l), { name: cityName(l), slug: citySlug(l), loc: l });
  return [...out.values()];
}

const faqLd = (faq: Faq[]) => ({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });
const itemListLd = (items: { title: string; slug: string }[]) => ({ '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: items.slice(0, 20).map((i, k) => ({ '@type': 'ListItem', position: k + 1, url: `${config.appUrl}/item/${i.slug}`, name: i.title })) });
const e = escapeHtml;
function contentHtml(c: PageContent, cityLinkBase = '/city') {
  return `${c.intro.map((p) => `<p>${e(p)}</p>`).join('')}`
    + c.tips.map((t) => `<h2>${e(t.title)}</h2><ul>${t.items.map((i) => `<li>${e(i)}</li>`).join('')}</ul>`).join('')
    + `<h2>Frequently asked questions</h2>${c.faq.map((f) => `<h3>${e(f.q)}</h3><p>${e(f.a)}</p>`).join('')}`
    + `<h2>Nearby areas</h2><ul>${c.nearby.map((n) => `<li><a href="${cityLinkBase}/${e(n.slug)}">Buy &amp; sell in ${e(n.name)}</a></li>`).join('')}</ul>`;
}

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
    const cc = categoryContent(c);
    return {
      title: `${c.name} for Sale in the GTA | Toronto, Mississauga, Brampton | ${name}`,
      description: strip(`Browse ${c.name.toLowerCase()} for sale across the GTA — Toronto, Mississauga, Brampton, Markham and more. Compare local prices in CAD and message sellers on ${name}.`, 160),
      canonical: `${config.appUrl}/category/${c.slug}`,
      jsonLd: [breadcrumb([[name, '/'], [c.name, `/category/${c.slug}`]]), faqLd(cc.faq), ...(items.length ? [itemListLd(items)] : [])],
      body: `<h1>${e(cc.heading)}</h1><ul>${items.map((i) => `<li><a href="/item/${e(i.slug)}">${e(i.title)} — ${e(money(i.currency, i.price))}</a></li>`).join('')}</ul>${contentHtml(cc, `/city`).replace(/href="\/city\/([a-z0-9-]+)"/g, `href="/city/$1/${c.slug}"`)}`,
    };
  }

  m = path.match(/^\/city\/([a-z0-9-]{2,60})(?:\/([a-z0-9-]{1,80}))?$/);
  if (m) {
    const areaInfo = allAreas(site).find((x) => x.slug === m![1]);
    if (!areaInfo) return { ...base, noindex: true, status: 404 };
    const city = areaInfo.name;
    const loc = areaInfo.loc;
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
    const cats = await q<any>(`SELECT name, slug FROM categories WHERE deleted_at IS NULL AND is_active ORDER BY sort_order LIMIT 12`);
    const g = gtaBySlug.get(areaInfo.slug);
    const cc = cityContent(g ?? { name: city, slug: areaInfo.slug }, cat, cats);
    const what = cat ? `${cat.name} for sale` : 'Buy & sell';
    const path2 = `/city/${m[1]}${cat ? `/${cat.slug}` : ''}`;
    const prov = loc.split(',')[1]?.trim() ?? 'ON';
    return {
      title: cat ? `${cat.name} for Sale in ${city}, ${prov} | ${name}` : `Buy & Sell in ${city}, ${prov} — Local Classifieds | ${name}`,
      description: strip(cat
        ? `Find ${cat.name.toLowerCase()} for sale in ${city}, ${prov}. Browse local ads, compare prices in CAD and message ${city} sellers directly on ${name}.`
        : `Buy and sell locally in ${city}, ${prov}. Browse the latest ads from ${city} sellers — electronics, furniture, household items, fashion and more on ${name}.`, 160),
      canonical: `${config.appUrl}${path2}`,
      // GTA hub pages carry unique copy so they are indexable even before inventory arrives; category pages need listings.
      noindex: cat ? items.length === 0 : !g && items.length === 0,
      jsonLd: [
        breadcrumb([[name, '/'], [`${city}`, `/city/${m[1]}`], ...(cat ? [[cat.name, path2] as [string, string]] : [])]),
        faqLd(cc.faq),
        ...(items.length ? [itemListLd(items)] : []),
        { '@context': 'https://schema.org', '@type': 'CollectionPage', name: cc.heading, url: `${config.appUrl}${path2}`, about: { '@type': 'Place', name: `${city}, ${prov}, Canada` }, inLanguage: 'en-CA' },
      ],
      body: `<h1>${e(what)} in ${e(city)}</h1><ul>${items.map((i) => `<li><a href="/item/${e(i.slug)}">${e(i.title)} — ${e(money(i.currency, i.price))}</a></li>`).join('')}</ul>${!cat ? `<h2>Browse by category in ${e(city)}</h2><ul>${cats.map((c: any) => `<li><a href="/city/${m![1]}/${e(c.slug)}">${e(c.name)} in ${e(city)}</a></li>`).join('')}</ul>` : ''}${contentHtml(cc)}`,
    };
  }

  if (path === '/guides') {
    return {
      ...base,
      title: `Buying & Selling Guides for the GTA | ${name}`,
      description: `Free guides to buying and selling second-hand items in Toronto, Mississauga, Brampton and the GTA: safety, pricing, furniture, electronics and more.`,
      canonical: `${config.appUrl}/guides`,
      jsonLd: [breadcrumb([[name, '/'], ['Guides', '/guides']])],
      body: `<h1>Buying &amp; selling guides for the GTA</h1><ul>${GUIDES.map((gd) => `<li><a href="/guides/${gd.slug}">${e(gd.title)}</a> — ${e(gd.description)}</li>`).join('')}</ul>`,
    };
  }
  m = path.match(/^\/guides\/([a-z0-9-]{3,100})$/);
  if (m) {
    const gd = guideBySlug.get(m[1]!);
    if (!gd) return { ...base, noindex: true, status: 404 };
    const url = `${config.appUrl}/guides/${gd.slug}`;
    return {
      title: `${gd.title} | ${name}`,
      description: strip(gd.description, 160),
      canonical: url,
      type: 'article',
      jsonLd: [
        breadcrumb([[name, '/'], ['Guides', '/guides'], [gd.title, `/guides/${gd.slug}`]]),
        { '@context': 'https://schema.org', '@type': 'Article', headline: gd.title, description: gd.description, datePublished: gd.updated, dateModified: gd.updated, inLanguage: 'en-CA',
          mainEntityOfPage: url, author: { '@type': 'Organization', name }, publisher: { '@type': 'Organization', name, logo: { '@type': 'ImageObject', url: `${config.appUrl}/icon-512.png` } } },
        faqLd(gd.faq),
      ],
      body: `<h1>${e(gd.title)}</h1>${gd.sections.map((sec) => `<h2>${e(sec.h)}</h2>${sec.p.map((x) => `<p>${e(x)}</p>`).join('')}`).join('')}<h2>FAQ</h2>${gd.faq.map((f) => `<h3>${e(f.q)}</h3><p>${e(f.a)}</p>`).join('')}`,
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
    const top = GTA_AREAS.slice(0, 12);
    return {
      ...base,
      title: `${name} — Buy & Sell in the GTA | Toronto, Mississauga, Brampton`,
      description: `Free local classifieds for the Greater Toronto Area: buy and sell electronics, furniture, household items and more in Toronto, Mississauga, Brampton, Markham and Vaughan.`,
      body: `<h1>${e(name)} — buy and sell locally in the Greater Toronto Area</h1><h2>Browse by city</h2><ul>${top.map((a) => `<li><a href="/city/${a.slug}">Buy &amp; sell in ${e(a.name)}</a></li>`).join('')}</ul><h2>Guides</h2><ul>${GUIDES.map((gd) => `<li><a href="/guides/${gd.slug}">${e(gd.title)}</a></li>`).join('')}</ul>`,
      jsonLd: [{
        '@context': 'https://schema.org', '@type': 'Organization', name, url: `${config.appUrl}/`,
        logo: `${config.appUrl}/icon-512.png`, areaServed: [{ '@type': 'AdministrativeArea', name: 'Greater Toronto Area, Ontario' }, { '@type': 'Country', name: 'Canada' }],
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
        .replace('<!--SEO_BODY-->', `<div class="seo-splash" aria-hidden="true"><div class="seo-spin"></div><p>SaudaGo</p></div><div class="seo-snapshot">${meta.body ?? ''}</div>`); // inside #root: React replaces it on mount
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
    const areas = allAreas(site);
    const cityByName = new Map(areas.map((a) => [a.name.toLowerCase(), a.slug]));
    const withListings = new Set(combos.map((c) => String(c.city).trim().toLowerCase()));
    const url = (loc: string, mod?: string, freq = 'daily') =>
      `<url><loc>${escapeHtml(config.appUrl + loc)}</loc>${mod ? `<lastmod>${new Date(mod).toISOString()}</lastmod>` : ''}<changefreq>${freq}</changefreq></url>`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[
      url('/', undefined, 'hourly'),
      ...cats.map((c) => url(`/category/${c.slug}`, c.updated_at)),
      // GTA hubs always (unique content); other cities only once they have listings.
      ...GTA_AREAS.map((a) => url(`/city/${a.slug}`, undefined, 'daily')),
      ...[...withListings].flatMap((n) => (cityByName.has(n) && !GTA_AREAS.some((a) => a.slug === cityByName.get(n)) ? [url(`/city/${cityByName.get(n)}`)] : [])),
      url('/guides', undefined, 'weekly'),
      ...GUIDES.map((gd) => url(`/guides/${gd.slug}`, gd.updated, 'monthly')),
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
