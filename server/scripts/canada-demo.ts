/**
 * Canada setup + demo data for a local/staging install. Run with the app running:
 *   scripts\demo.bat     (or: cd server && npx tsx scripts/canada-demo.ts)
 *
 * 1. Switches existing settings and seller plans to Canada (CAD, Canadian cities, Interac e-Transfer).
 * 2. Hides the throwaway accounts created by the automated tests (…@example.test).
 * 3. Creates a demo seller + demo buyer and 5 listings through the real API
 *    (email verification → admin approval → seller plan → listing review → approval).
 *
 * Safe to re-run: existing demo accounts and listings are reused. Never run against production.
 */
import 'dotenv/config';
import sharp from 'sharp';
import { pool } from '../src/db.js';
import { CANADIAN_LOCATIONS } from '../src/lib/settings.js';

const API = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
const PASSWORD = 'DemoPass2026';
const SELLER = { full_name: 'Northern Goods', email: 'demo.seller@marketplace.local', phone: '+1 416 555 0142' };
const BUYER = { full_name: 'Alex Tremblay', email: 'demo.buyer@marketplace.local', phone: '+1 514 555 0187' };

class Client {
  cookies = new Map<string, string>();
  cookieHeader = () => [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  async req(method: string, path: string, body?: unknown) {
    if (method !== 'GET' && !this.cookies.has('mk_csrf')) await this.req('GET', '/api/settings');
    const headers: Record<string, string> = { cookie: this.cookieHeader(), accept: 'application/json' };
    if (method !== 'GET') headers['x-csrf-token'] = this.cookies.get('mk_csrf') ?? '';
    let payload: any;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(API + path, { method, headers, body: payload });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, ...v] = kv!.split('=');
      this.cookies.set(k!, v.join('='));
    }
    const data: any = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
    if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
    return data;
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {});
}

/* ---------- Illustrated product images (no stock photos needed) ---------- */
const svg = (bg1: string, bg2: string, art: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient>
  <filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-opacity=".22"/></filter></defs>
  <rect width="1200" height="900" fill="url(#g)"/><ellipse cx="600" cy="760" rx="420" ry="40" fill="#000" opacity=".08"/>
  <g filter="url(#s)">${art}</g></svg>`;

const ART: Record<string, (alt: boolean) => string> = {
  bike: (alt) => `<g stroke="${alt ? '#1f2937' : '#111827'}" stroke-width="22" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="360" cy="560" r="170"/><circle cx="840" cy="560" r="170"/>
      <path d="M360 560 L520 330 L760 330 L840 560 M520 330 L600 560 L760 330 M600 560 L360 560" stroke="${alt ? '#dc2626' : '#0f766e'}" stroke-width="26"/>
      <path d="M500 290 L560 290 M760 330 L740 250 L800 240"/><circle cx="600" cy="560" r="26" fill="#111827"/></g>`,
  sofa: (alt) => `<g><rect x="230" y="330" width="740" height="260" rx="60" fill="${alt ? '#6b7280' : '#9ca3af'}"/>
      <rect x="170" y="420" width="150" height="260" rx="50" fill="${alt ? '#4b5563' : '#6b7280'}"/><rect x="880" y="420" width="150" height="260" rx="50" fill="${alt ? '#4b5563' : '#6b7280'}"/>
      <rect x="300" y="500" width="290" height="160" rx="30" fill="${alt ? '#9ca3af' : '#d1d5db'}"/><rect x="610" y="500" width="290" height="160" rx="30" fill="${alt ? '#9ca3af' : '#d1d5db'}"/>
      <rect x="230" y="680" width="24" height="60" fill="#1f2937"/><rect x="946" y="680" width="24" height="60" fill="#1f2937"/></g>`,
  laptop: (alt) => `<g><rect x="330" y="200" width="540" height="360" rx="26" fill="#1e293b"/>
      <rect x="360" y="230" width="480" height="300" rx="10" fill="${alt ? '#0ea5e9' : '#6366f1'}"/><circle cx="600" cy="215" r="6" fill="#64748b"/>
      <path d="M260 580 L940 580 L900 640 L300 640 Z" fill="#334155"/><rect x="540" y="580" width="120" height="14" rx="7" fill="#1e293b"/></g>`,
  parka: (alt) => `<g><path d="M470 210 Q600 160 730 210 L860 290 L930 640 L840 660 L800 420 L800 720 L400 720 L400 420 L360 660 L270 640 L340 290 Z" fill="${alt ? '#7f1d1d' : '#14532d'}"/>
      <path d="M470 210 Q600 300 730 210 Q700 150 600 140 Q500 150 470 210Z" fill="#d6c7a1"/>
      <rect x="590" y="260" width="20" height="460" fill="#0f172a" opacity=".5"/>
      <rect x="430" y="470" width="110" height="80" rx="12" fill="#000" opacity=".18"/><rect x="660" y="470" width="110" height="80" rx="12" fill="#000" opacity=".18"/>
</g>`,
  tv: (alt) => `<g><rect x="230" y="170" width="740" height="440" rx="16" fill="#0f172a"/>
      <rect x="252" y="192" width="696" height="396" rx="6" fill="${alt ? '#f59e0b' : '#0f766e'}"/>
      <path d="M252 480 Q450 380 600 450 T948 400 L948 588 L252 588Z" fill="#000" opacity=".25"/>
      <circle cx="800" cy="290" r="50" fill="#fff" opacity=".85"/>
      <path d="M520 610 L480 700 M680 610 L720 700" stroke="#334155" stroke-width="18" stroke-linecap="round"/><rect x="430" y="696" width="340" height="14" rx="7" fill="#334155"/></g>`,
};

async function images(kind: string, bgs: [string, string][]) {
  return Promise.all(bgs.map(async ([a, b], i) => new Blob([await sharp(Buffer.from(svg(a, b, ART[kind]!(i === 1)))).png().toBuffer()], { type: 'image/png' })));
}

const LISTINGS = [
  {
    kind: 'bike', cat: 'sports', sub: 'cycling', featured: true,
    title: 'Trek FX 2 Hybrid Bike – Medium Frame', price: 650, negotiable: true, condition: 'good', location: 'Toronto, ON',
    description: 'Trek FX 2 Disc hybrid in great shape, medium frame (fits roughly 5\'6" to 5\'11"). Hydraulic disc brakes, 2x9 drivetrain, recently tuned at a local shop with new chain and brake pads.\n\nCommuted on it for two seasons in the Annex — a few cosmetic scuffs on the top tube, nothing mechanical. Comes with fenders, rear rack and a U-lock.\n\nPickup near Bathurst & Bloor. Happy to let you test ride.',
    bgs: [['#e0f2fe', '#bae6fd'], ['#fef3c7', '#fde68a']],
  },
  {
    kind: 'sofa', cat: 'furniture', sub: 'living-room', featured: false,
    title: 'IKEA KIVIK 3-Seat Sofa – Grey, Washable Covers', price: 425, negotiable: true, condition: 'like_new', location: 'Vancouver, BC',
    description: 'KIVIK three-seat sofa in Hillared dark grey, bought in 2024. Covers are removable and were just professionally cleaned. Smoke-free, pet-free home.\n\nDimensions: 228 cm wide × 95 cm deep. Very comfortable deep seats — only selling because we\'re moving to a smaller condo.\n\nPickup in Mount Pleasant. You\'ll need a van or SUV with the seats down; legs unscrew for transport.',
    bgs: [['#f5f5f4', '#e7e5e4'], ['#ecfccb', '#d9f99d']],
  },
  {
    kind: 'laptop', cat: 'computers', sub: 'laptops', featured: true,
    title: 'MacBook Air M2 13" – 8GB / 256GB, Midnight', price: 1150, negotiable: false, condition: 'like_new', location: 'Montréal, QC',
    description: 'MacBook Air M2 (2023), 13.6", 8 GB RAM, 256 GB SSD, Midnight colour. Battery health 96%, 112 cycles. No scratches or dents — always used with a sleeve.\n\nIncludes original box and 30W USB-C charger. AppleCare+ valid until June 2027 and transferable.\n\nMeet at a café near Métro Mont-Royal so you can check it out before buying. Fully reset and ready for a new owner.',
    bgs: [['#ede9fe', '#ddd6fe'], ['#e0f2fe', '#bae6fd']],
  },
  {
    kind: 'parka', cat: 'fashion', sub: 'men-s', featured: false,
    title: 'Men\'s Expedition Winter Parka – Size L, Rated −30 °C', price: 780, negotiable: true, condition: 'good', location: 'Calgary, AB',
    description: 'Heavy-duty down expedition parka, men\'s size Large, forest green. Rated to about −30 °C — kept me warm through two Calgary winters.\n\nRemovable fur ruff, adjustable hood, two-way zipper, plenty of interior pockets. Small repaired seam on the left cuff (barely visible). Freshly cleaned by a down specialist.\n\nPickup in Kensington, or I can meet downtown on a weekday.',
    bgs: [['#f1f5f9', '#e2e8f0'], ['#fee2e2', '#fecaca']],
  },
  {
    kind: 'tv', cat: 'electronics', sub: 'tvs-audio', featured: false,
    title: 'Samsung 55" 4K Smart TV (2023) with Wall Mount', price: 520, negotiable: true, condition: 'good', location: 'Ottawa, ON',
    description: 'Samsung Crystal UHD 55" 4K smart TV, 2023 model. Picture is excellent, no dead pixels. Built-in Netflix, Prime Video, Crave and Disney+ apps.\n\nComes with the remote, original stand and a tilting wall mount (VESA 200×200). Upgraded to a bigger screen, so this one needs a new home.\n\nPickup in Westboro. Bring a friend — it\'s easier to carry with two people.',
    bgs: [['#fffbeb', '#fef3c7'], ['#ecfdf5', '#d1fae5']],
  },
];

async function verifyAndLogin(c: Client, u: typeof SELLER) {
  const exists = await pool.query(`SELECT id, email_verified_at FROM users WHERE lower(email)=lower($1)`, [u.email]);
  if (!exists.rowCount) {
    await c.post('/api/auth/register', { ...u, password: PASSWORD, confirm_password: PASSWORD, accept_terms: true });
  }
  if (!exists.rows[0]?.email_verified_at) {
    const out = await fetch(`${API}/api/dev/outbox`).then((r) => r.json());
    const mail = [...out.items].reverse().find((m: any) => m.to === u.email && m.text.includes('verify-email?token='));
    if (!mail) throw new Error(`No verification email for ${u.email}. Is DEV_OUTBOX=true in server/.env?`);
    await c.post('/api/auth/verify-email', { token: mail.text.match(/token=([A-Za-z0-9_-]+)/)[1] });
  }
  await c.post('/api/auth/login', { email: u.email, password: PASSWORD });
  return (await c.get('/api/auth/me')).user;
}

async function main() {
  console.log('1) Switching settings and seller plans to Canada…');
  const site = (await pool.query(`SELECT value FROM website_settings WHERE key='site'`)).rows[0]?.value ?? {};
  await pool.query(`INSERT INTO website_settings (key, value) VALUES ('site', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [
    JSON.stringify({ ...site, default_currency: 'CAD', default_location: 'Toronto, ON', locations: CANADIAN_LOCATIONS }),
  ]);
  const pay = (await pool.query(`SELECT value FROM website_settings WHERE key='payments'`)).rows[0]?.value;
  if (!pay || /IBAN/.test(pay.bank_details ?? '')) {
    await pool.query(`INSERT INTO website_settings (key, value) VALUES ('payments', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [
      JSON.stringify({ ...(pay ?? {}), bank_transfer_enabled: true, gateway_enabled: false, payment_window_days: pay?.payment_window_days ?? 7,
        bank_details: 'Interac e-Transfer to: payments@your-domain.ca\nUse your account email as the message.\n(Configure in Admin → Settings → Payments)' }),
    ]);
  }
  const prices: Record<string, number> = { single: 4.99, monthly: 19.99, quarterly: 49.99, annual: 179 };
  for (const [kind, price] of Object.entries(prices)) {
    await pool.query(`UPDATE seller_plans SET currency='CAD', price=$2, updated_at=now() WHERE kind=$1 AND currency <> 'CAD'`, [kind, price]);
  }
  await pool.query(`UPDATE seller_plans SET currency='CAD' WHERE currency <> 'CAD'`);

  console.log('2) Hiding automated-test accounts…');
  const hidden = await pool.query(`UPDATE users SET deleted_at = now() WHERE email LIKE '%@example.test' AND deleted_at IS NULL RETURNING id`);
  await pool.query(`UPDATE listings SET deleted_at = now(), is_featured = false WHERE seller_id = ANY($1::uuid[]) AND deleted_at IS NULL`, [hidden.rows.map((r) => r.id)]);
  await pool.query(`DELETE FROM sessions WHERE user_id = ANY($1::uuid[])`, [hidden.rows.map((r) => r.id)]);
  await pool.query(`UPDATE notifications SET read_at = now() WHERE read_at IS NULL`);

  console.log('3) Creating demo accounts…');
  const admin = new Client();
  await admin.post('/api/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  const seller = new Client();
  const buyer = new Client();
  const s = await verifyAndLogin(seller, SELLER);
  const b = await verifyAndLogin(buyer, BUYER);
  for (const u of [s, b]) if (u.status === 'pending_approval') await admin.post(`/api/admin/users/${u.id}/status`, { action: 'approve' });
  await pool.query(`UPDATE user_profiles SET location = $2, bio = $3 WHERE user_id = $1`, [s.id, 'Toronto, ON',
    'Demo seller account — quality second-hand goods across Canada. Pickup or meet-up only.']);
  await pool.query(`UPDATE user_profiles SET location = $2 WHERE user_id = $1`, [b.id, 'Montréal, QC']);

  if (!(await seller.get('/api/auth/me')).user.is_seller) {
    const plan = (await admin.get('/api/admin/plans')).items.find((p: any) => p.kind === 'monthly');
    await admin.post(`/api/admin/users/${s.id}/grant-seller`, { plan_id: plan.id, waive_payment: true, note: 'Demo account' });
  }

  console.log('4) Posting and approving listings…');
  const cats = (await seller.get('/api/categories')).items;
  const mine = (await seller.get('/api/my/listings?limit=50')).items;
  for (const l of LISTINGS) {
    let existing = mine.find((m: any) => m.title === l.title);
    if (!existing) {
      const cat = cats.find((c: any) => c.slug === l.cat);
      const sub = cat?.subcategories.find((x: any) => x.slug === l.sub);
      const fd = new FormData();
      Object.entries({ title: l.title, category_id: cat.id, subcategory_id: sub?.id ?? '', description: l.description, price: String(l.price),
        negotiable: String(l.negotiable), condition: l.condition, location: l.location, availability: 'available', show_phone: 'false', action: 'submit' })
        .forEach(([k, v]) => fd.append(k, v));
      for (const [i, img] of (await images(l.kind, l.bgs as [string, string][])).entries()) fd.append('images', img, `${l.kind}-${i + 1}.png`);
      existing = (await seller.req('POST', '/api/my/listings', fd)).listing;
      console.log(`   submitted: ${l.title}`);
    }
    const status = existing.status;
    if (status === 'pending_approval') {
      await admin.post(`/api/admin/listings/${existing.id}/moderate`, { action: 'approve' });
      console.log(`   approved:  ${l.title}`);
    }
    if (l.featured) await admin.post(`/api/admin/listings/${existing.id}/feature`, { featured: true, days: 30 }).catch(() => {});
  }

  const live = await pool.query(`SELECT count(*)::int n FROM listings WHERE seller_id=$1 AND status='published' AND deleted_at IS NULL`, [s.id]);
  console.log(`\nDone. ${live.rows[0].n} live demo listings.`);
  console.log(`Demo seller: ${SELLER.email} / ${PASSWORD}`);
  console.log(`Demo buyer:  ${BUYER.email} / ${PASSWORD}`);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
