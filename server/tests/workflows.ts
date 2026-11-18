/**
 * End-to-end workflow tests against a running API server.
 *
 *   1. Start the server with:  DEV_OUTBOX=true RATE_LIMIT_RELAXED=true npm run dev
 *   2. In another terminal:    npm run test:workflows
 *
 * Requires ADMIN_EMAIL / ADMIN_PASSWORD (same as the seeded admin) and DATABASE_URL in .env.
 * Creates throwaway users with random emails; safe to run repeatedly on a dev database.
 * NEVER run against production.
 */
import 'dotenv/config';
import { io } from 'socket.io-client';
import { runJobs } from '../src/jobs.js';
import { pool } from '../src/db.js';

const API = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL!;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const RUN = Math.random().toString(36).slice(2, 8);

// A real 8x8 PNG so the server's image decoder accepts it.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWPgL8vDihiGlgQApWE8welJnBIAAAAASUVORK5CYII=',
  'base64',
);

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failures.push(`${name}: ${(e as Error).message}`);
    console.log(`  \x1b[31m✗ ${name}\x1b[0m\n      ${(e as Error).message}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** Minimal browser-like client: keeps cookies and sends the CSRF header. */
class Client {
  cookies = new Map<string, string>();
  constructor(public label: string) {}
  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async req(method: string, path: string, body?: unknown, opts: { csrf?: boolean } = {}) {
    if (method !== 'GET' && !this.cookies.has('mk_csrf')) await this.req('GET', '/api/settings');
    const headers: Record<string, string> = { cookie: this.cookieHeader(), accept: 'application/json' };
    if (method !== 'GET' && opts.csrf !== false) headers['x-csrf-token'] = this.cookies.get('mk_csrf') ?? '';
    let payload: any;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(API + path, { method, headers, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, ...v] = kv!.split('=');
      const val = v.join('=');
      if (!val || /expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(k!);
      else this.cookies.set(k!, val);
    }
    const data: any = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {});
  patch = (p: string, b?: unknown) => this.req('PATCH', p, b);
  del = (p: string) => this.req('DELETE', p);
}

async function latestToken(email: string, kind: 'verify-email' | 'reset-password') {
  const r = await fetch(`${API}/api/dev/outbox`).then((x) => x.json());
  const mail = [...r.items].reverse().find((m: any) => m.to === email && m.text.includes(`/${kind}?token=`));
  assert(mail, `no ${kind} email found for ${email} (is DEV_OUTBOX=true?)`);
  return mail.text.match(/token=([A-Za-z0-9_-]+)/)[1] as string;
}

async function register(c: Client, name: string) {
  const email = `${name}-${RUN}@example.test`;
  const r = await c.post('/api/auth/register', {
    full_name: `${name} ${RUN}`, email, phone: '+92 300 1234567', password: 'Passw0rd!x', confirm_password: 'Passw0rd!x', accept_terms: true,
  });
  assert(r.status === 201, `register ${name}: ${r.status} ${JSON.stringify(r.data)}`);
  return email;
}

function listingForm(title: string, categoryId: string, action = 'submit', withImage = true) {
  const fd = new FormData();
  fd.append('title', title);
  fd.append('category_id', categoryId);
  fd.append('description', 'A well kept item in good condition, with original box and charger.');
  fd.append('price', '45000');
  fd.append('condition', 'good');
  fd.append('location', 'Lahore');
  fd.append('negotiable', 'true');
  fd.append('action', action);
  if (withImage) fd.append('images', new Blob([PNG], { type: 'image/png' }), 'photo.png');
  return fd;
}

async function main() {
  assert(ADMIN_EMAIL && ADMIN_PASSWORD, 'Set ADMIN_EMAIL and ADMIN_PASSWORD in .env');
  const health = await fetch(`${API}/api/health`).catch(() => null);
  assert(health?.ok, `API not reachable at ${API} — start it first`);
  console.log(`\nRunning workflow tests against ${API} (run id ${RUN})\n`);

  const admin = new Client('admin');
  const buyer = new Client('buyer');
  const seller = new Client('seller');
  const stranger = new Client('stranger');
  const anon = new Client('anon');
  let buyerEmail = '', sellerEmail = '', strangerEmail = '';
  let buyerId = '', sellerId = '';
  let categoryId = '', planId = '', subId = '', paymentId = '', receiptId = '';
  let listingId = '', listingSlug = '', convId = '';

  console.log('Registration & approval');
  await test('1. users can register', async () => {
    buyerEmail = await register(buyer, 'buyer');
    sellerEmail = await register(seller, 'seller');
    strangerEmail = await register(stranger, 'stranger');
  });
  await test('   weak passwords and missing terms are rejected', async () => {
    const r = await anon.post('/api/auth/register', { full_name: 'X Y', email: `w-${RUN}@example.test`, phone: '+923001234567', password: 'short', confirm_password: 'short', accept_terms: false });
    assert(r.status === 400 && r.data.error.details.password && r.data.error.details.accept_terms, `expected field errors, got ${JSON.stringify(r.data)}`);
  });
  await test('   unverified users can log in but cannot message', async () => {
    const r = await buyer.post('/api/auth/login', { email: buyerEmail, password: 'Passw0rd!x' });
    assert(r.status === 200, `login ${r.status}`);
    const me = await buyer.get('/api/auth/me');
    assert(me.data.user.status === 'email_unverified' && !me.data.user.can_chat, 'should be unverified');
  });
  await test('2. email verification moves the account to pending approval', async () => {
    for (const [c, e] of [[buyer, buyerEmail], [seller, sellerEmail], [stranger, strangerEmail]] as const) {
      const token = await latestToken(e, 'verify-email');
      const r = await c.post('/api/auth/verify-email', { token });
      assert(r.status === 200, `verify ${e}: ${r.status}`);
      const again = await c.post('/api/auth/verify-email', { token });
      assert(again.status === 400, 'token must be single-use');
    }
  });
  await test('4. login works and wrong passwords are refused', async () => {
    assert((await admin.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).status === 200, 'admin login');
    assert((await seller.post('/api/auth/login', { email: sellerEmail, password: 'Passw0rd!x' })).status === 200, 'seller login');
    assert((await stranger.post('/api/auth/login', { email: strangerEmail, password: 'Passw0rd!x' })).status === 200, 'stranger login');
    assert((await anon.post('/api/auth/login', { email: buyerEmail, password: 'wrong-pass1' })).status === 401, 'bad password should be 401');
    buyerId = (await buyer.get('/api/auth/me')).data.user.id;
    sellerId = (await seller.get('/api/auth/me')).data.user.id;
    assert((await buyer.get('/api/auth/me')).data.user.status === 'pending_approval', 'buyer should be pending approval');
  });
  await test('3. admin approves the buyer and the stranger', async () => {
    for (const id of [buyerId, (await stranger.get('/api/auth/me')).data.user.id]) {
      const r = await admin.post(`/api/admin/users/${id}/status`, { action: 'approve' });
      assert(r.status === 200, `approve ${r.status} ${JSON.stringify(r.data)}`);
    }
    const me = await buyer.get('/api/auth/me');
    assert(me.data.user.can_chat === true, 'buyer should be able to chat');
  });

  console.log('\nSeller authorization & payment');
  await test('6. a user requests seller authorization', async () => {
    const cats = await anon.get('/api/categories');
    categoryId = cats.data.items[0].id;
    const plans = await seller.get('/api/seller/status');
    planId = plans.data.plans[0].id;
    const r = await seller.post('/api/seller/requests', { message: 'I sell used phones and laptops in Lahore.', preferred_plan_id: planId });
    assert(r.status === 201, `request ${r.status} ${JSON.stringify(r.data)}`);
    const dup = await seller.post('/api/seller/requests', { message: 'Second request while one is open.' });
    assert(dup.status === 400, 'duplicate open request should be refused');
  });
  await test('   non-sellers cannot create listings (API + DB guard)', async () => {
    const r = await seller.req('POST', '/api/my/listings', listingForm('Too early', categoryId));
    assert(r.status === 403, `expected 403, got ${r.status}`);
  });
  await test('   a user cannot approve their own seller request', async () => {
    const reqs = await seller.get('/api/admin/seller-requests');
    assert(reqs.status === 403, `expected 403, got ${reqs.status}`);
  });
  await test('7. admin approves and assigns a plan; payment is required', async () => {
    const reqs = await admin.get('/api/admin/seller-requests');
    const mine = reqs.data.items.find((x: any) => x.user_id === sellerId);
    assert(mine, 'request not visible to admin');
    const r = await admin.post(`/api/admin/seller-requests/${mine.id}/approve`, { plan_id: planId });
    assert(r.status === 200 && r.data.activated === false, `approve ${r.status} ${JSON.stringify(r.data)}`);
    subId = r.data.subscription.id;
    const me = await seller.get('/api/auth/me');
    assert(me.data.user.is_seller === false, 'seller must not be active before payment');
  });
  await test('8. seller submits a bank transfer with receipt — still no listing access', async () => {
    const fd = new FormData();
    fd.append('reference_number', `TX-${RUN}`);
    fd.append('receipt', new Blob([PNG], { type: 'image/png' }), 'receipt.png');
    const r = await seller.req('POST', `/api/seller/subscriptions/${subId}/manual-payment`, fd);
    assert(r.status === 201, `payment ${r.status} ${JSON.stringify(r.data)}`);
    paymentId = r.data.payment_id;
    const l = await seller.req('POST', '/api/my/listings', listingForm('Still too early', categoryId));
    assert(l.status === 403, 'unverified payment must not activate privileges');
    const pays = await seller.get('/api/seller/payments');
    receiptId = pays.data.payments[0].receipt_id;
    assert(receiptId, 'receipt id missing');
  });
  await test('   other users cannot download the receipt (IDOR)', async () => {
    const r = await buyer.get(`/api/seller/receipts/${receiptId}`);
    assert(r.status === 404, `expected 404, got ${r.status}`);
  });
  await test('9. admin verifies the payment → seller privileges active', async () => {
    const r = await admin.post(`/api/admin/payments/${paymentId}/verify`, {});
    assert(r.status === 200, `verify ${r.status} ${JSON.stringify(r.data)}`);
    const me = await seller.get('/api/auth/me');
    assert(me.data.user.is_seller === true, 'seller should be active');
  });

  console.log('\nListings & moderation');
  await test('10. seller creates a listing with a photo', async () => {
    const r = await seller.req('POST', '/api/my/listings', listingForm(`iPhone 13 ${RUN}`, categoryId));
    assert(r.status === 201, `create ${r.status} ${JSON.stringify(r.data)}`);
    listingId = r.data.listing.id;
    listingSlug = r.data.listing.slug;
    assert(r.data.listing.status === 'pending_approval', 'should await approval');
  });
  await test('    duplicate listing is rejected', async () => {
    const r = await seller.req('POST', '/api/my/listings', listingForm(`iPhone 13 ${RUN}`, categoryId));
    assert(r.status === 409, `expected 409, got ${r.status}`);
  });
  await test('    renamed script uploaded as an image is rejected', async () => {
    const fd = listingForm(`Bad upload ${RUN}`, categoryId, 'submit', false);
    fd.append('images', new Blob(['<?php echo 1; ?>'], { type: 'image/png' }), 'evil.png');
    const r = await seller.req('POST', '/api/my/listings', fd);
    assert(r.status === 400, `expected 400, got ${r.status}`);
  });
  await test('11. pending listing is not publicly visible', async () => {
    assert((await anon.get(`/api/listings/${listingSlug}`)).status === 404, 'pending listing visible by URL');
    const s = await anon.get(`/api/listings?q=${RUN}`);
    assert(!s.data.items.some((x: any) => x.id === listingId), 'pending listing in search');
  });
  await test('    seller cannot publish their own listing via admin API', async () => {
    const r = await seller.post(`/api/admin/listings/${listingId}/moderate`, { action: 'approve' });
    assert(r.status === 403, `expected 403, got ${r.status}`);
  });
  await test('12. admin approves the listing', async () => {
    const r = await admin.post(`/api/admin/listings/${listingId}/moderate`, { action: 'approve' });
    assert(r.status === 200 && r.data.status === 'published', `approve ${r.status} ${JSON.stringify(r.data)}`);
  });
  await test('13. approved listing is public and searchable', async () => {
    const d = await anon.get(`/api/listings/${listingSlug}`);
    assert(d.status === 200 && d.data.listing.images.length === 1, `detail ${d.status}`);
    const s = await anon.get(`/api/listings?q=${RUN}`);
    assert(s.data.items.some((x: any) => x.id === listingId), 'not found in search');
    const filtered = await anon.get(`/api/listings?q=${RUN}&min_price=50000`);
    assert(!filtered.data.items.some((x: any) => x.id === listingId), 'price filter not applied');
  });
  await test('    editing the price of a live listing sends it back to review', async () => {
    const fd = listingForm(`iPhone 13 ${RUN}`, categoryId, 'submit', false);
    fd.set('price', '43000');
    const r = await seller.req('PATCH', `/api/my/listings/${listingId}`, fd);
    assert(r.status === 200 && r.data.status === 'pending_approval', `edit ${r.status} ${JSON.stringify(r.data)}`);
    assert((await anon.get(`/api/listings/${listingSlug}`)).status === 404, 'edited listing still public');
    const a = await admin.post(`/api/admin/listings/${listingId}/moderate`, { action: 'approve' });
    assert(a.status === 200, 're-approve failed');
  });
  await test('    other users cannot edit or delete the listing (IDOR)', async () => {
    assert((await buyer.del(`/api/my/listings/${listingId}`)).status === 404, 'buyer deleted seller listing');
    assert((await stranger.post(`/api/my/listings/${listingId}/sold`)).status === 404, 'stranger marked listing sold');
  });

  console.log('\nChat');
  let sellerSocket: ReturnType<typeof io> | null = null;
  await test('5. an unapproved user cannot start a conversation', async () => {
    const pending = new Client('pending');
    const email = await register(pending, 'pending');
    await pending.post('/api/auth/verify-email', { token: await latestToken(email, 'verify-email') });
    await pending.post('/api/auth/login', { email, password: 'Passw0rd!x' });
    const r = await pending.post('/api/chat/conversations', { listing_id: listingId, message: 'hi' });
    assert(r.status === 403, `expected 403, got ${r.status}`);
    const anonR = await anon.post('/api/chat/conversations', { listing_id: listingId });
    assert(anonR.status === 401, `anonymous expected 401, got ${anonR.status}`);
  });
  await test('14. approved buyer contacts the seller', async () => {
    const r = await buyer.post('/api/chat/conversations', { listing_id: listingId, message: 'Is this still available?' });
    assert(r.status === 201, `start ${r.status} ${JSON.stringify(r.data)}`);
    convId = r.data.conversation_id;
  });
  await test('15. messages arrive in real time with read receipts', async () => {
    sellerSocket = io(API, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie: seller.cookieHeader() } });
    await new Promise<void>((res, rej) => {
      sellerSocket!.on('connect', () => res());
      sellerSocket!.on('connect_error', (e) => rej(e));
      setTimeout(() => rej(new Error('socket connect timeout')), 5000);
    });
    const got = new Promise<any>((res, rej) => {
      sellerSocket!.on('message:new', (m: any) => m.conversation_id === convId && m.body === 'Real-time ping' && res(m));
      setTimeout(() => rej(new Error('no real-time message within 5s')), 5000);
    });
    const send = await buyer.post(`/api/chat/conversations/${convId}/messages`, { body: 'Real-time ping' });
    assert(send.status === 201, `send ${send.status}`);
    await got;
    const reply = await seller.post(`/api/chat/conversations/${convId}/messages`, { body: 'Yes, available!' });
    assert(reply.status === 201, `seller reply ${reply.status}`);
    assert((await buyer.post(`/api/chat/conversations/${convId}/read`)).status === 200, 'mark read');
    const thread = await seller.get(`/api/chat/conversations/${convId}`);
    assert(new Date(thread.data.conversation.other_last_read_at) > new Date(0), 'read receipt not recorded');
  });
  await test('    others cannot read or post into the conversation (IDOR)', async () => {
    assert((await stranger.get(`/api/chat/conversations/${convId}`)).status === 404, 'stranger read conversation');
    assert((await stranger.post(`/api/chat/conversations/${convId}/messages`, { body: 'snoop' })).status === 404, 'stranger posted');
    assert((await admin.get(`/api/chat/conversations/${convId}`)).status === 404, 'admin read unreported conversation');
  });
  await test('    blocking stops messages', async () => {
    assert((await seller.post('/api/chat/blocks', { user_id: buyerId })).status === 200, 'block');
    assert((await buyer.post(`/api/chat/conversations/${convId}/messages`, { body: 'hello?' })).status === 403, 'blocked user could send');
    assert((await seller.del(`/api/chat/blocks/${buyerId}`)).status === 200, 'unblock');
  });

  console.log('\nFavorites, reports, moderation');
  await test('16. favorites can be added, listed and removed', async () => {
    assert((await buyer.post(`/api/account/favorites/${listingId}`)).status === 200, 'add');
    const f = await buyer.get('/api/account/favorites');
    assert(f.data.items.some((x: any) => x.id === listingId), 'not listed');
    assert((await buyer.del(`/api/account/favorites/${listingId}`)).status === 200, 'remove');
  });
  await test('17. reporting a listing reaches the admin', async () => {
    const r = await buyer.post('/api/account/reports', { target_type: 'listing', target_id: listingId, reason: 'misleading_price', details: 'Test report' });
    assert(r.status === 201, `report ${r.status}`);
    const list = await admin.get('/api/admin/reports');
    assert(list.data.items.some((x: any) => x.target_id === listingId), 'report not visible to admin');
  });
  await test('    reported conversations become readable by admins (and the view is logged)', async () => {
    await buyer.post('/api/account/reports', { target_type: 'conversation', target_id: convId, reason: 'harassment' });
    const rep = (await admin.get('/api/admin/reports?type=conversation')).data.items.find((x: any) => x.target_id === convId);
    const v = await admin.get(`/api/admin/reports/${rep.id}/conversation`);
    assert(v.status === 200 && v.data.messages.length >= 2, 'admin could not open reported conversation');
    const log = await admin.get('/api/admin/activity?action=conversation.viewed_for_report');
    assert(log.data.items.length > 0, 'view not audited');
  });
  await test('18. a suspended account cannot send messages', async () => {
    const r = await admin.post(`/api/admin/users/${buyerId}/status`, { action: 'suspend', reason: 'Test suspension' });
    assert(r.status === 200, `suspend ${r.status}`);
    const s = await buyer.post(`/api/chat/conversations/${convId}/messages`, { body: 'still here' });
    assert(s.status === 403, `expected 403, got ${s.status}`);
    assert((await admin.post(`/api/admin/users/${buyerId}/status`, { action: 'restore' })).status === 200, 'restore');
  });
  await test('    admin actions are recorded in the activity log', async () => {
    const log = await admin.get('/api/admin/activity?admin=1');
    const actions = log.data.items.map((x: any) => x.action);
    for (const a of ['user.approve', 'seller.request_approved', 'payment.verified', 'listing.approved', 'user.suspend']) {
      assert(actions.includes(a), `missing audit entry ${a}`);
    }
  });

  console.log('\nExpiry & security');
  await test('19. an expired subscription disables listing creation and takes listings down', async () => {
    await pool.query(`UPDATE seller_subscriptions SET expires_at = now() - interval '1 minute' WHERE id = $1`, [subId]);
    // The server may be running its own job cycle (advisory lock) — retry briefly.
    for (let i = 0; i < 5; i++) {
      await runJobs();
      if (!(await seller.get('/api/auth/me')).data.user.is_seller) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const me = await seller.get('/api/auth/me');
    assert(me.data.user.is_seller === false, 'seller still active after expiry');
    const r = await seller.req('POST', '/api/my/listings', listingForm(`After expiry ${RUN}`, categoryId));
    assert(r.status === 403, `expected 403, got ${r.status}`);
    assert((await anon.get(`/api/listings/${listingSlug}`)).status === 404, 'listing still public after plan expiry');
  });
  await test('    requests without the CSRF token are refused', async () => {
    const r = await buyer.req('POST', `/api/account/favorites/${listingId}`, {}, { csrf: false });
    assert(r.status === 403, `expected 403, got ${r.status}`);
  });
  await test('    non-admins get 403 on every admin endpoint', async () => {
    for (const p of ['/api/admin/overview', '/api/admin/users', '/api/admin/payments', '/api/admin/settings', '/api/admin/activity']) {
      assert((await buyer.get(p)).status === 403, `${p} accessible to non-admin`);
      assert((await anon.get(p)).status === 401, `${p} accessible anonymously`);
    }
  });
  await test('    password reset invalidates sessions', async () => {
    await anon.post('/api/auth/forgot-password', { email: strangerEmail });
    const token = await latestToken(strangerEmail, 'reset-password');
    const r = await anon.post('/api/auth/reset-password', { token, password: 'N3wPassw0rd', confirm_password: 'N3wPassw0rd' });
    assert(r.status === 200, `reset ${r.status}`);
    const me = await stranger.get('/api/auth/me');
    assert(me.data.user === null, 'old session still valid after reset');
  });
  await test('    SEO: sitemap and robots are served', async () => {
    const s = await fetch(`${API}/sitemap.xml`);
    assert(s.ok && (await s.text()).includes('<urlset'), 'sitemap missing');
    const rb = await fetch(`${API}/robots.txt`);
    assert(rb.ok && (await rb.text()).includes('Disallow: /admin'), 'robots missing');
  });

  sellerSocket?.disconnect();
  await pool.end();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  console.log('Note: scenario 20 (mobile responsiveness) is a visual check — see README › Testing.\n');
  if (failures.length) {
    console.log(failures.map((f) => ` - ${f}`).join('\n'));
    process.exit(1);
  }
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
