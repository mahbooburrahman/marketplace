import { q, Queryable, pool } from '../db.js';

export const CANADIAN_LOCATIONS = [
  'Toronto, ON', 'Montréal, QC', 'Vancouver, BC', 'Calgary, AB', 'Edmonton, AB', 'Ottawa, ON', 'Winnipeg, MB', 'Québec City, QC',
  'Hamilton, ON', 'Kitchener-Waterloo, ON', 'London, ON', 'Halifax, NS', 'Victoria, BC', 'Saskatoon, SK', 'Regina, SK',
  'Mississauga, ON', 'Brampton, ON', 'Surrey, BC', 'St. John\'s, NL', 'Fredericton, NB', 'Charlottetown, PE', 'Whitehorse, YT',
];

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  site: {
    name: 'SaudaGo',
    tagline: 'Buy and sell locally, safely.',
    logo_url: '',
    favicon_url: '',
    primary_color: '#0E5C4B',
    accent_color: '#F5A623',
    default_currency: 'CAD',
    default_location: 'Toronto, ON',
    locations: CANADIAN_LOCATIONS,
  },
  contact: { email: 'support@example.com', phone: '', address: '', whatsapp: '' },
  legal: {
    terms: 'Replace this with your Terms and Conditions before launch.',
    privacy: 'Replace this with your Privacy Policy before launch.',
  },
  email: { enabled: true, send_message_emails: true },
  payments: {
    bank_transfer_enabled: true,
    bank_details: 'Interac e-Transfer to: payments@your-domain.ca\nUse your account email as the message.\n(Configure in Admin → Settings → Payments)',
    gateway_enabled: false,
    payment_window_days: 7,
    // When false, approved sellers are activated for free and no plans or fees are shown to sellers.
    seller_plans_enabled: false,
  },
  listings: { lifetime_days: 30, expiry_reminder_days: 3, max_images: 10, auto_expire: true },
  chat: { messages_per_minute: 20 },
};

export type Settings = typeof DEFAULT_SETTINGS & Record<string, any>;

let cache: { at: number; value: Record<string, any> } | null = null;

/** Settings are read on most requests, so keep a short in-memory cache. */
export async function getSettings(db: Queryable = pool): Promise<Record<string, any>> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const rows = await q<{ key: string; value: any }>('SELECT key, value FROM website_settings', [], db);
  const value: Record<string, any> = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) value[r.key] = { ...(value[r.key] as object), ...r.value };
  cache = { at: Date.now(), value };
  return value;
}

export function invalidateSettings() {
  cache = null;
}

/** The subset of settings safe to send to any visitor. */
export function publicSettings(s: Record<string, any>) {
  return {
    site: s.site,
    contact: s.contact,
    payments: {
      bank_transfer_enabled: s.payments.bank_transfer_enabled,
      gateway_enabled: s.payments.gateway_enabled,
      seller_plans_enabled: !!s.payments.seller_plans_enabled,
    },
    listings: { max_images: s.listings.max_images },
  };
}
