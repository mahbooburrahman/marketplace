import { publicUrl } from './storage.js';
import { sha256 } from './security.js';

/** Columns used for listing cards everywhere. `$U` placeholder is replaced by the viewer param index. */
export const CARD_SELECT = (viewerParam: string | null) => `
  l.id, l.slug, l.title, l.price, l.currency, l.negotiable, l.location, l.condition, l.status,
  l.is_featured, l.published_at, l.created_at, l.availability,
  c.name AS category_name, c.slug AS category_slug,
  p.full_name AS seller_name, l.seller_id, is_active_seller(l.seller_id) AS seller_verified,
  (SELECT thumb_path FROM listing_images i WHERE i.listing_id = l.id ORDER BY sort_order, created_at LIMIT 1) AS thumb_path,
  ${viewerParam ? `EXISTS (SELECT 1 FROM favorites f WHERE f.listing_id = l.id AND f.user_id = ${viewerParam})` : 'false'} AS is_favorite
`;

export const CARD_FROM = `
  FROM listings l
  JOIN categories c ON c.id = l.category_id
  JOIN users su ON su.id = l.seller_id
  LEFT JOIN user_profiles p ON p.user_id = l.seller_id
`;

/** Public visibility: published, not deleted, seller in good standing. */
export const PUBLIC_WHERE = `l.status = 'published' AND l.deleted_at IS NULL AND su.status = 'approved' AND su.deleted_at IS NULL`;

export function toCard(r: any) {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    price: r.price,
    currency: r.currency,
    negotiable: r.negotiable,
    location: r.location,
    condition: r.condition,
    status: r.status,
    availability: r.availability,
    is_featured: r.is_featured,
    published_at: r.published_at,
    created_at: r.created_at,
    category: { name: r.category_name, slug: r.category_slug },
    seller: { id: r.seller_id, name: r.seller_name, verified: !!r.seller_verified },
    image: publicUrl(r.thumb_path),
    is_favorite: !!r.is_favorite,
  };
}

export function contentHash(l: { title: string; description: string; price: number; category_id: string }) {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return sha256(`${norm(l.title)}|${norm(l.description)}|${Number(l.price).toFixed(2)}|${l.category_id}`);
}

/** Escape LIKE wildcards in user input. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);

/** Fields whose change on a published listing sends it back to moderation. */
export const MODERATED_FIELDS = ['title', 'description', 'price', 'category_id', 'subcategory_id', 'video_url'] as const;

export const CONDITIONS = ['new', 'like_new', 'good', 'fair', 'for_parts'] as const;
