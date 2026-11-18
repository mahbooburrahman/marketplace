import { one, q, Queryable, pool } from '../db.js';
import { config } from '../config.js';
import { sendMail } from './mailer.js';
import { emitToAdmins, emitToUser } from './realtime.js';

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  email?: { subject?: string; lines?: string[]; cta?: string };
}

/** Create an in-app notification, push it in real time, and optionally email it. */
export async function notify(n: NotifyInput, db: Queryable = pool) {
  const row = await one<any>(
    `INSERT INTO notifications (user_id, type, title, body, link) VALUES ($1,$2,$3,$4,$5)
     RETURNING id, type, title, body, link, read_at, created_at`,
    [n.userId, n.type, n.title, n.body ?? '', n.link ?? null],
    db,
  );
  emitToUser(n.userId, 'notification', row);
  if (n.email) {
    const u = await one<{ email: string }>('SELECT email FROM users WHERE id=$1', [n.userId], db);
    if (u) {
      sendMail({
        to: u.email,
        subject: n.email.subject ?? n.title,
        heading: n.title,
        lines: n.email.lines ?? (n.body ? [n.body] : []),
        cta: n.link ? { label: n.email.cta ?? 'Open', url: `${config.appUrl}${n.link}` } : undefined,
      }).catch(() => {});
    }
  }
  return row;
}

/** Notify every administrator (in-app + realtime badge). */
export async function notifyAdmins(type: string, title: string, body: string, link: string, db: Queryable = pool) {
  const admins = await q<{ id: string }>(`SELECT id FROM users WHERE role='admin' AND status='approved' AND deleted_at IS NULL`, [], db);
  for (const a of admins) await notify({ userId: a.id, type, title, body, link }, db);
  emitToAdmins('admin:queue', { type });
}
