import 'dotenv/config';
import path from 'node:path';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required environment variable ${name}`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';
const root = path.resolve(process.cwd());

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  appUrl: req('APP_URL', 'http://localhost:5173').replace(/\/$/, ''),
  databaseUrl: req('DATABASE_URL'),
  databaseSsl: process.env.DATABASE_SSL === 'true',
  sessionDays: Number(process.env.SESSION_DAYS ?? 14),
  trustProxy: process.env.TRUST_PROXY === 'true',
  storage: {
    driver: (process.env.STORAGE_DRIVER ?? 'local') as 'local',
    publicDir: path.resolve(root, process.env.UPLOAD_PUBLIC_DIR ?? 'storage/public'),
    privateDir: path.resolve(root, process.env.UPLOAD_PRIVATE_DIR ?? 'storage/private'),
    maxImageMb: Number(process.env.MAX_IMAGE_MB ?? 8),
    maxImagesPerListing: Number(process.env.MAX_IMAGES_PER_LISTING ?? 10),
  },
  mail: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.MAIL_FROM ?? 'Marketplace <no-reply@localhost>',
  },
  payments: {
    gateway: (process.env.PAYMENT_GATEWAY ?? 'none') as 'none' | 'stripe',
    stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  },
  captcha: {
    // Cloudflare Turnstile. When unset, CAPTCHA is skipped (development only).
    secret: process.env.TURNSTILE_SECRET_KEY ?? '',
  },
  admin: {
    email: process.env.ADMIN_EMAIL ?? '',
    password: process.env.ADMIN_PASSWORD ?? '',
    name: process.env.ADMIN_NAME ?? 'Site Administrator',
  },
  listingLifetimeDaysDefault: 30,
};
