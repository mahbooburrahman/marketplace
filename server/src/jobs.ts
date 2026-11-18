import { pool, q, tx } from './db.js';
import { notify } from './lib/notify.js';
import { getSettings } from './lib/settings.js';
import { revokeSellerPrivileges, SYSTEM_USER_ID } from './lib/subscriptions.js';

const LOCK_KEY = 72_310_001; // advisory lock so only one server instance runs jobs at a time

async function log(action: string, targetType: string, targetId: string, meta: object = {}) {
  await q(`INSERT INTO activity_logs (actor_id, action, target_type, target_id, meta) VALUES ($1,$2,$3,$4,$5)`, [SYSTEM_USER_ID, action, targetType, targetId, JSON.stringify(meta)]);
}

export async function runJobs() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    if (!rows[0].ok) return;
    try {
      await expireSubscriptions();
      await remindSubscriptions();
      await closeUnpaidPlans();
      await expireListings();
      await remindListings();
      await q(`UPDATE listings SET is_featured=false WHERE is_featured AND featured_until IS NOT NULL AND featured_until < now()`);
      await q(`DELETE FROM sessions WHERE expires_at < now()`);
      await q(`DELETE FROM email_tokens WHERE (used_at IS NOT NULL OR expires_at < now()) AND created_at < now() - interval '7 days'`);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } catch (e) {
    console.error('[jobs]', e);
  } finally {
    client.release();
  }
}

async function expireSubscriptions() {
  const subs = await q<any>(`SELECT id, user_id, plan_name FROM seller_subscriptions WHERE status='active' AND expires_at <= now()`);
  for (const s of subs) {
    await tx(async (c) => {
      await c.query(`UPDATE seller_subscriptions SET status='expired' WHERE id=$1 AND status='active'`, [s.id]);
      const other = await c.query(`SELECT 1 FROM seller_subscriptions WHERE user_id=$1 AND status='active' AND expires_at > now()`, [s.user_id]);
      if (other.rowCount === 0) await revokeSellerPrivileges(c, s.user_id, 'expired');
    });
    await log('seller.subscription_expired', 'subscription', s.id);
    await notify({ userId: s.user_id, type: 'seller.expired', title: 'Your seller plan has expired',
      body: `Your ${s.plan_name} plan has ended. Listing creation is disabled and live listings have been taken down until you renew.`,
      link: '/dashboard/seller', email: { cta: 'Renew' } });
  }
}

async function remindSubscriptions() {
  const subs = await q<any>(
    `UPDATE seller_subscriptions SET expiry_reminded_at=now()
      WHERE status='active' AND expiry_reminded_at IS NULL AND expires_at > now() AND expires_at < now() + interval '3 days'
      RETURNING id, user_id, plan_name, expires_at`,
  );
  for (const s of subs) {
    await notify({ userId: s.user_id, type: 'seller.expiring', title: 'Your seller plan expires soon',
      body: `Your ${s.plan_name} plan expires on ${new Date(s.expires_at).toDateString()}. Request a renewal to keep your listings live.`,
      link: '/dashboard/seller', email: { cta: 'Renew now' } });
  }
}

async function closeUnpaidPlans() {
  const subs = await q<any>(
    `UPDATE seller_subscriptions SET status='cancelled' WHERE status='awaiting_payment' AND payment_due_at < now() RETURNING id, user_id, plan_name`,
  );
  for (const s of subs) {
    await q(`UPDATE payments SET status='expired' WHERE subscription_id=$1 AND status='pending'`, [s.id]);
    await log('seller.payment_window_closed', 'subscription', s.id);
    await notify({ userId: s.user_id, type: 'payment.expired', title: 'Payment window closed',
      body: `The payment window for your ${s.plan_name} plan has closed. Submit a new seller request to try again.`, link: '/dashboard/seller', email: {} });
  }
}

async function expireListings() {
  const settings = await getSettings();
  if (settings.listings.auto_expire === false) return;
  const rows = await q<any>(
    `UPDATE listings SET status='expired', is_featured=false WHERE status='published' AND expires_at IS NOT NULL AND expires_at <= now() AND deleted_at IS NULL
     RETURNING id, seller_id, title`,
  );
  for (const l of rows) {
    await log('listing.expired', 'listing', l.id);
    await notify({ userId: l.seller_id, type: 'listing.expired', title: 'Your listing has expired', body: `"${l.title}" is no longer visible. You can renew it from your dashboard.`, link: '/dashboard/listings?status=expired', email: { cta: 'Renew listing' } });
  }
}

async function remindListings() {
  const settings = await getSettings();
  const days = Number(settings.listings.expiry_reminder_days ?? 3);
  if (!days) return;
  const rows = await q<any>(
    `UPDATE listings SET expiry_reminded_at=now()
      WHERE status='published' AND expiry_reminded_at IS NULL AND expires_at > now() AND expires_at < now() + make_interval(days => $1)
      RETURNING id, seller_id, title, expires_at`,
    [days],
  );
  for (const l of rows) {
    await notify({ userId: l.seller_id, type: 'listing.expiring', title: 'Your listing expires soon',
      body: `"${l.title}" expires on ${new Date(l.expires_at).toDateString()}.`, link: '/dashboard/listings', email: { cta: 'View listings' } });
  }
}

export function startJobs(intervalMs = 5 * 60_000) {
  setTimeout(runJobs, 10_000);
  return setInterval(runJobs, intervalMs);
}
