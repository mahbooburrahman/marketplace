const LOCALE = 'en-CA';

/** Prices in Canadian style: $1,250 or $19.99 (other currencies show their code, e.g. US$25). */
export function money(amount: number | string | null | undefined, currency = 'CAD') {
  const n = Number(amount ?? 0);
  try {
    return new Intl.NumberFormat(LOCALE, { style: 'currency', currency, minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString(LOCALE)}`;
  }
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)} min ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)} h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.floor(d)} day${Math.floor(d) === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined });
}

export const dateShort = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const dateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const clock = (iso: string) => new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });

export const CONDITIONS: Record<string, string> = {
  new: 'New',
  like_new: 'Like new',
  good: 'Good',
  fair: 'Fair',
  for_parts: 'For parts',
};

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'violet';

export const STATUS: Record<string, [string, Tone]> = {
  // users
  email_unverified: ['Email unverified', 'amber'],
  pending_approval: ['Pending approval', 'amber'],
  approved: ['Approved', 'green'],
  rejected: ['Rejected', 'red'],
  suspended: ['Suspended', 'red'],
  banned: ['Banned', 'red'],
  // listings
  draft: ['Draft', 'gray'],
  changes_requested: ['Changes requested', 'violet'],
  published: ['Live', 'green'],
  sold: ['Sold', 'blue'],
  expired: ['Expired', 'gray'],
  archived: ['Archived', 'gray'],
  // seller requests / subs / payments
  pending: ['Pending', 'amber'],
  info_requested: ['Info requested', 'violet'],
  cancelled: ['Cancelled', 'gray'],
  awaiting_payment: ['Awaiting payment', 'amber'],
  payment_review: ['Payment in review', 'blue'],
  active: ['Active', 'green'],
  revoked: ['Revoked', 'red'],
  under_review: ['Under review', 'blue'],
  verified: ['Verified', 'green'],
  failed: ['Failed', 'red'],
  // refunds / reports
  none: ['—', 'gray'],
  requested: ['Refund requested', 'amber'],
  processing: ['Refund processing', 'blue'],
  refunded: ['Refunded', 'violet'],
  declined: ['Refund declined', 'gray'],
  open: ['Open', 'amber'],
  investigating: ['Investigating', 'blue'],
  resolved: ['Resolved', 'green'],
  dismissed: ['Dismissed', 'gray'],
};

// Listing "approved" means approved but currently offline (unpublished by an admin)
export const LISTING_STATUS_OVERRIDE: Record<string, [string, Tone]> = { approved: ['Unpublished', 'gray'], pending_approval: ['In review', 'amber'] };

export const REPORT_REASONS: Record<string, string> = {
  fake_product: 'Fake product',
  fraudulent_seller: 'Fraudulent seller',
  inappropriate: 'Inappropriate content',
  spam: 'Spam',
  misleading_price: 'Misleading price',
  suspicious: 'Suspicious activity',
  harassment: 'Harassment or abuse',
  other: 'Other',
};

export const initials = (name?: string | null) =>
  (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

/** Recently viewed listing ids, kept on the device only. */
export const recentlyViewed = {
  get(): string[] {
    try {
      return JSON.parse(localStorage.getItem('mk_recent') ?? '[]');
    } catch {
      return [];
    }
  },
  push(id: string) {
    try {
      const next = [id, ...this.get().filter((x) => x !== id)].slice(0, 12);
      localStorage.setItem('mk_recent', JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  },
};
