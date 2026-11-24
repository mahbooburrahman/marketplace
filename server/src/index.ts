import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { pool } from './db.js';
import { errorHandler, notFound } from './lib/http.js';
import { attachUser, csrf, requireAdmin } from './middleware/auth.js';
import { apiLimiter } from './middleware/limits.js';
import { attachSocket } from './socket.js';
import { startJobs } from './jobs.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';
import { devOutbox } from './lib/mailer.js';
import { robots, seoHtmlHandler, sitemap } from './seo.js';
import authRoutes from './routes/auth.js';
import listingRoutes from './routes/listings.js';
import myListingRoutes from './routes/myListings.js';
import sellerRoutes, { webhookRouter } from './routes/seller.js';
import chatRoutes from './routes/chat.js';
import accountRoutes from './routes/account.js';
import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin.js';
import { adminBanners, publicBanners } from './routes/banners.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, '../../client/dist');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'", 'https://challenges.cloudflare.com'],
          'frame-src': ["'self'", 'https://challenges.cloudflare.com', 'https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
          'img-src': ["'self'", 'data:', 'blob:'],
          'connect-src': ["'self'", 'ws:', 'wss:'],
          'style-src': ["'self'", "'unsafe-inline'"],
          'upgrade-insecure-requests': config.isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Webhooks need the raw body to check signatures.
  app.use('/api/webhooks', express.json({ limit: '1mb', verify: (req: any, _res, buf) => (req.rawBody = buf) }));
  app.use(express.json({ limit: '200kb' }));
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(cookieParser());
  app.use(csrf);
  app.use(attachUser);

  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });

  app.use('/api', apiLimiter);
  app.use('/api/webhooks', webhookRouter);
  app.use('/api/auth', authRoutes);
  app.use('/api/listings', listingRoutes);
  app.use('/api/my/listings', myListingRoutes);
  app.use('/api/seller', sellerRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/account', accountRoutes);
  app.use('/api/admin/banners', requireAdmin, adminBanners);
  app.use('/api/banners', publicBanners);
  app.use('/api/admin', adminRoutes);
  app.use('/api', publicRoutes);

  if (!config.isProd && process.env.DEV_OUTBOX === 'true') {
    // Development-only: lets the automated workflow tests read verification emails.
    app.get('/api/dev/outbox', (_req, res) => res.json({ items: devOutbox.slice(-50) }));
  }
  app.use('/api', (_req, _res, next) => next(notFound('Unknown API endpoint.')));

  // Public uploads (listing photos, avatars). Private files are never served from here.
  app.use('/uploads', express.static(config.storage.publicDir, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }));

  app.get('/robots.txt', robots);
  app.get('/sitemap.xml', sitemap);

  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist, { index: false, maxAge: '1y', immutable: true, setHeaders: (res, p) => p.endsWith('.html') && res.setHeader('Cache-Control', 'no-cache') }));
    app.get('*', seoHtmlHandler(path.join(clientDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}

async function waitForDatabase() {
  for (let i = 1; ; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (e) {
      if (i >= 30) throw e;
      if (i === 1) console.log('Waiting for the database…');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function main() {
  await waitForDatabase();
  if (process.env.AUTO_MIGRATE === 'true') {
    await migrate();
    await seed();
  }
  fs.mkdirSync(config.storage.publicDir, { recursive: true });
  fs.mkdirSync(config.storage.privateDir, { recursive: true });
  const app = createApp();
  const server = http.createServer(app);
  attachSocket(server);
  if (process.env.DISABLE_JOBS !== 'true') startJobs();
  server.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));
  const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

