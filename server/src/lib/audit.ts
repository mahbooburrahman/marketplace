import type { Request } from 'express';
import { q, Queryable, pool } from '../db.js';

/** Append an entry to the immutable activity log. */
export async function audit(
  req: Request | null,
  action: string,
  target?: { type: string; id: string },
  meta: Record<string, unknown> = {},
  db: Queryable = pool,
  actorId?: string,
) {
  await q(
    'INSERT INTO activity_logs (actor_id, action, target_type, target_id, meta, ip) VALUES ($1,$2,$3,$4,$5,$6)',
    [actorId ?? req?.user?.id ?? null, action, target?.type ?? null, target?.id ?? null, JSON.stringify(meta), req?.ip ?? null],
    db,
  );
}
