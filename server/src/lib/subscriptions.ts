import type { PoolClient } from 'pg';
import { one, q } from '../db.js';

export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Activate a subscription whose payment has just been verified (in the same transaction).
 * If the seller already has active time, the new period starts when the current one ends.
 */
export async function activateSubscription(c: PoolClient, subId: string, actorId: string) {
  const sub = await one<any>('SELECT * FROM seller_subscriptions WHERE id=$1 FOR UPDATE', [subId], c);
  if (!sub) throw new Error('subscription not found');
  if (sub.status === 'active') return sub;
  const current = await one<{ until: string | null }>(
    `SELECT max(expires_at) AS until FROM seller_subscriptions WHERE user_id=$1 AND status='active' AND expires_at > now() AND id <> $2`,
    [sub.user_id, subId], c,
  );
  const start = current?.until && new Date(current.until) > new Date() ? new Date(current.until) : new Date();
  const plan = await one<any>('SELECT fixed_expiry_date FROM seller_plans WHERE id=$1', [sub.plan_id], c);
  let expires = new Date(start.getTime() + sub.duration_days * 86400_000);
  if (plan?.fixed_expiry_date) expires = new Date(`${plan.fixed_expiry_date}T23:59:59Z`);

  const updated = await one<any>(
    `UPDATE seller_subscriptions SET status='active', starts_at=$2, expires_at=$3 WHERE id=$1 RETURNING *`,
    [subId, start, expires], c,
  );
  await grantSellerPermissions(c, sub.user_id, actorId, expires, sub.featured_allowed);
  return updated;
}

export async function grantSellerPermissions(c: PoolClient, userId: string, actorId: string, expires: Date, featured: boolean) {
  const codes = featured ? ['listing.create', 'listing.feature'] : ['listing.create'];
  for (const code of codes) {
    await q(
      `INSERT INTO user_permissions (user_id, permission_code, granted_by, expires_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, permission_code) DO UPDATE
         SET granted_by = EXCLUDED.granted_by, granted_at = now(),
             expires_at = GREATEST(user_permissions.expires_at, EXCLUDED.expires_at)`,
      [userId, code, actorId, expires], c,
    );
  }
}

/** Remove seller privileges and take the seller's live listings offline. */
export async function revokeSellerPrivileges(c: PoolClient, userId: string, listingStatus: 'expired' | 'suspended') {
  await q(`DELETE FROM user_permissions WHERE user_id=$1 AND permission_code IN ('listing.create','listing.feature')`, [userId], c);
  await q(
    `UPDATE listings SET status=$2::listing_status, is_featured=false,
            status_note = CASE WHEN $2 = 'suspended' THEN 'Seller privileges revoked' ELSE 'Seller plan expired' END
      WHERE seller_id=$1 AND status IN ('published','pending_approval','approved') AND deleted_at IS NULL`,
    [userId, listingStatus], c,
  );
}

export async function currentSubscription(userId: string) {
  return one<any>(
    `SELECT * FROM seller_subscriptions WHERE user_id=$1
      ORDER BY (status='active' AND expires_at > now()) DESC,
               (status IN ('awaiting_payment','payment_review')) DESC, created_at DESC LIMIT 1`,
    [userId],
  );
}
