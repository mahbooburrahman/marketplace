# SaudaGo — Moderated Classified Marketplace

A Facebook Marketplace–style classifieds platform where **the administrator controls everything that goes public**:

- Buyers register → verify email → **admin approves** them before they can message sellers.
- Sellers **request authorization** → admin assigns a paid plan → seller pays → **payment is verified** → listing tools unlock.
- Every listing is **reviewed before it goes live**, and important edits send it back for review.
- Buyers and sellers chat privately in real time.

The brand name ("SaudaGo"), colours, logo, contact details and legal pages are all editable from **Admin → Settings**.

---

## 1. Architecture

```
marketplace/
├── client/                 React 18 + TypeScript + Tailwind CSS 4 (Vite SPA)
│   └── src/
│       ├── pages/          Home, Search, Listing, Seller profile, Auth, Messages
│       ├── pages/dashboard User dashboard (profile, favorites, seller plan, listings, payments…)
│       ├── pages/admin     Admin dashboard (users, sellers, listings, payments, categories…)
│       ├── components/     Layout, cards, gallery, dialogs, design-system primitives
│       └── context/        Auth, site settings, Socket.IO, toasts
├── server/                 Node.js + Express + TypeScript REST API
│   ├── migrations/         SQL migrations (schema + database-level guard triggers)
│   ├── src/routes/         auth, listings, my listings, seller & payments, chat, account, admin
│   ├── src/lib/            security, storage, mail, notifications, payments, subscriptions
│   ├── src/socket.ts       Real-time chat, typing indicators, presence
│   ├── src/jobs.ts         Expiry of plans & listings, reminders, cleanup
│   ├── src/seo.ts          Server-rendered meta tags, JSON-LD, sitemap, robots.txt
│   └── tests/              Workflow tests (API) + database guard tests (SQL)
├── docker-compose.yml      Local PostgreSQL (and optional full stack)
└── Dockerfile              Production image (API + built SPA in one container)
```

**How the pieces fit:** in development, Vite serves the React app on port 5173 and proxies `/api`, `/uploads` and `/socket.io` to the API on port 4000. In production, the API serves the built React app itself, so you deploy **one Node service + one PostgreSQL database**.

### Security model (defence in depth)

| Layer | What it enforces |
|---|---|
| UI | Hides controls a user can't use (convenience only — never relied on). |
| API middleware | `requireAuth`, `requireChatAccess`, `requireSeller`, `requireAdmin` on every route; ownership checks return 404 so IDs can't be probed. |
| **Database triggers** (`002_enforcement.sql`) | Even a direct SQL write cannot: publish a listing without an admin approval, create a listing without an active paid seller plan, activate a plan without a verified payment, verify a payment as a non-admin, open a chat as an unapproved buyer, message across a block, or edit/delete the audit log. |

Other measures: Argon2id password hashing, httpOnly SameSite session cookies with server-side session store, double-submit CSRF tokens, Helmet security headers + Content-Security-Policy, rate limiting (auth, registration, uploads, chat, reports), login lockout, parameterised SQL everywhere, zod input validation, image re-encoding (strips EXIF/GPS and rejects disguised files), private storage for receipts and chat attachments, single-use expiring email tokens (24 h verify, 60 min reset), all sessions revoked on password reset, append-only activity log.

---

## 2. One-click local setup on Windows (already done on this PC)

The `scripts\` folder has double-click helpers. They need only Node.js 20+; the database is a private PostgreSQL that runs from `server\.pgdata` on port **5433** and does not touch any other PostgreSQL on the machine.

| Script | What it does |
|---|---|
| `scripts\install.bat` | `npm install` for everything |
| `scripts\setup-db.bat` | creates `server\.env` from `server\env.local.txt` and installs the private database |
| `scripts\start.bat` | starts database + API + website; output goes to `scripts\dev.log`. Open **http://localhost:5173**. Close the window to stop. |
| `scripts\test.bat` | runs the 37 workflow tests against the running app → `scripts\test.log` |
| `scripts\share.bat` | builds the website and opens a temporary public https link (Cloudflare quick tunnel, no account) — the address appears in the window. Works while this PC and `start.bat` are running. Set `DEV_OUTBOX=false` and `RATE_LIMIT_RELAXED=false` in `server\.env` first. |
| `scripts\tunnel-run.bat` | restarts only the public link (it gets a **new address** each time) |
| `scripts\demo.bat` | switches settings to Canada and creates a demo seller, demo buyer and 5 approved listings → `scripts\demo.log` (safe to re-run) |

Demo accounts (local only): `demo.seller@marketplace.local` and `demo.buyer@marketplace.local`, password `DemoPass2026`.

Local admin login: the `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `server\.env`. Verification and reset emails are printed in `scripts\dev.log` until SMTP is configured.

`server\.env` for local use turns on `DEV_OUTBOX` and `RATE_LIMIT_RELAXED` (needed by the tests). **Never use these settings in production.**

## 2b. Quick start (Windows, macOS or Linux)

**You need:** [Node.js 20 or newer](https://nodejs.org) and a PostgreSQL database.

**Database — pick one:**
- **Easiest (cloud, free tier):** create a project on [Supabase](https://supabase.com) or [Neon](https://neon.tech), copy its connection string, and set `DATABASE_SSL=true`.
- **Local with Docker Desktop:** run `docker compose up -d db` in the project folder.
- **Local install:** install PostgreSQL 16 and create a database called `marketplace`.

**Then, in a terminal in the project folder:**

```bash
npm install                                   # installs everything (client + server)
copy server\.env.example server\.env          # Windows   (macOS/Linux: cp server/.env.example server/.env)
# → open server/.env and set DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD
npm run setup                                 # creates the tables and the first admin account
npm run dev                                   # starts the API and the website
```

Open **http://localhost:5173** and log in with your `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Admin panel: **http://localhost:5173/admin**.

Without SMTP configured, emails (verification links, password resets) are **printed in the terminal** running the API — copy the link from there.

---

## 3. Environment variables

All server settings live in `server/.env` (template: `server/.env.example`). Never commit `.env` files.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `DATABASE_SSL` | | `true` for hosted databases (Supabase, Neon, RDS) |
| `APP_URL` | ✅ | Public URL of the site, no trailing slash (used in emails, canonical URLs, sitemap) |
| `PORT` | | API port (default 4000) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | ✅ first run | First administrator, created by `npm run seed` |
| `AUTO_MIGRATE` | | `true` runs migrations + seed on every start |
| `SESSION_DAYS` | | Login session lifetime (default 14) |
| `TRUST_PROXY` | prod | `true` behind Render/Railway/Nginx so IPs and rate limits are correct |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | prod | Outgoing email |
| `UPLOAD_PUBLIC_DIR`, `UPLOAD_PRIVATE_DIR`, `MAX_IMAGE_MB` | | File storage locations and limits |
| `PAYMENT_GATEWAY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | optional | Online payments |
| `TURNSTILE_SECRET_KEY` (+ `VITE_TURNSTILE_SITE_KEY` in `client/.env`) | optional | CAPTCHA on registration |
| `DEV_OUTBOX`, `RATE_LIMIT_RELAXED`, `DISABLE_JOBS` | dev only | Testing helpers — ignored in production |

---

## 4. Database setup & migrations

- Migrations are plain SQL files in `server/migrations/`, applied in order and recorded in `schema_migrations`.
- `npm run migrate` applies new migrations; `npm run seed` adds roles, permissions, default categories, default seller plans, default settings and the first admin (all idempotent — safe to re-run).
- To change the schema, add `003_your_change.sql` — never edit an applied migration.

**Tables:** users, user_profiles, roles, permissions, role_permissions, user_permissions, sessions, email_tokens, seller_requests, seller_plans, seller_subscriptions, payments, payment_receipts, categories, subcategories, listings, listing_images, listing_approvals, conversations, conversation_participants, messages, message_attachments, favorites, notifications, reports, blocked_users, activity_logs, website_settings.

Soft deletion is used for users, listings, categories, subcategories and plans. Seller plans are **snapshotted** onto each subscription, so editing a plan never changes what an existing seller paid for.

---

## 5. Email configuration

Set the `SMTP_*` variables. Any SMTP provider works — e.g. **Brevo**, **Mailgun**, **Amazon SES**, **Zoho Mail**, or Gmail with an app password (low volume only). Use **Admin → Settings → Email & chat → Send test email** to confirm.

Emails sent: verification, account approved/rejected/suspended/banned/restored, seller request received/approved/rejected/info needed, payment confirmed/rejected/refund updates, listing approved/rejected/changes requested/removed/expiring/expired, new message (only while offline, at most every 30 min per chat), plan expiring/expired, payment window closed.

Admins can switch off all email or just chat emails under **Admin → Settings**.

---

## 6. Payment configuration

**Manual bank transfer (works out of the box):** enter your bank details in **Admin → Settings → Payments**. Sellers transfer the fee, enter the transaction reference and upload a receipt. Privileges activate **only after an admin clicks Verify** in **Admin → Payments** — an uploaded screenshot never activates anything by itself.

**Online gateway (optional):** Stripe Checkout is included.
1. Set `PAYMENT_GATEWAY=stripe`, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `server/.env`.
2. In the Stripe dashboard add a webhook to `https://YOUR-DOMAIN/api/webhooks/payments/stripe` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and `checkout.session.expired`.
3. Tick **Offer online payment** in Admin → Settings → Payments.

Gateway payments activate automatically only from a **signature-verified webhook whose amount and currency match**; mismatches are sent to manual review.

**Canada:** Stripe works well for Canadian businesses and charges in CAD. For manual payments, put **Interac e-Transfer** instructions in the bank details (the default text already does). To use Moneris, Helcim, Square or PayPal instead, add a provider in `server/src/lib/payments/` implementing the `PaymentProvider` interface (`createCheckout` + `parseWebhook`) and select it in `getGateway()`.

**Admin waivers:** when approving a seller, an admin can tick *Waive payment*; this is recorded as a verified zero-amount `admin_waiver` payment in the audit trail.

---

## 7. Storage configuration

By default files are stored on disk:

- `server/storage/public/` — listing photos, avatars, category images, logo (served at `/uploads/…`)
- `server/storage/private/` — payment receipts and chat images (served only through permission-checked API routes)

Every image is decoded and re-encoded to WebP (max 1600 px, thumbnails 480 px), which strips EXIF/GPS data and rejects files that aren't really images. Receipts may also be PDFs (checked by file signature).

**In production the storage folder must be on a persistent disk** (e.g. a Render/Railway volume, or the `uploads` volume in docker-compose). To use S3, Cloudflare R2 or Supabase Storage instead, replace `saveBuffer`, `privatePath` and `removeFile` in `server/src/lib/storage.ts` — the rest of the app only works with relative keys.

---

## 8. Development commands

| Command | What it does |
|---|---|
| `npm run dev` | API (port 4000, auto-restart) + website (port 5173, hot reload) |
| `npm run migrate` / `npm run seed` / `npm run setup` | Database setup |
| `npm run db:up` | Start local PostgreSQL in Docker |
| `npm run build` | Production build of the client and server |
| `npm start` | Run the production build |
| `npm run typecheck` | Type-check both apps |
| `npm run test:workflows` | End-to-end API workflow tests (see below) |

---

## 9. Testing

**Database guard tests** — prove the critical rules hold at the database level:

```bash
psql "<your DATABASE_URL>" -f server/tests/db_guards.sql      # runs in a transaction and rolls back
```

**Workflow tests** — 30+ checks covering all 20 scenarios in the brief (registration, verification, approval, seller request, payment, verification, listing moderation, public visibility, chat, real-time delivery, favorites, reports, suspension, plan expiry) plus permission-bypass attempts (IDOR on listings/receipts/conversations, CSRF, non-admin access to admin APIs, self-publishing, disguised uploads):

```bash
# terminal 1 — development database only!
npm run dev:test -w server
# terminal 2
npm run test:workflows
```

**Mobile responsiveness (scenario 20)** — open the site in Chrome DevTools device mode (iPhone SE/14, Pixel 7, iPad) and check: bottom navigation, search filters sheet, listing gallery swipe, listing form, full-screen chat, admin tables (scroll horizontally inside their card, never the page).

---

## 10. Production deployment

**Option A — Render / Railway (recommended for this project):**
1. Create a PostgreSQL database (Render Postgres, Railway Postgres, Supabase or Neon).
2. Create a **Web Service** from this repository.
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
   - Add a **persistent disk** mounted at `/opt/render/project/src/server/storage` (Render) or a volume at `server/storage` (Railway).
3. Environment: `NODE_ENV=production`, `APP_URL=https://your-domain`, `DATABASE_URL`, `DATABASE_SSL=true`, `TRUST_PROXY=true`, `AUTO_MIGRATE=true` (or run `npm run migrate:prod -w server` once), `ADMIN_*`, `SMTP_*`.
4. Point your domain at the service and enable HTTPS (automatic on both platforms).

**Option B — Docker / VPS:** `docker build -t marketplace .` then run with your environment and a volume on `/app/server/storage`; put Nginx or Caddy in front for HTTPS (pass WebSocket upgrades for `/socket.io`). `docker compose --profile full up --build` runs the whole stack locally.

**Scaling:** the API is stateless except for Socket.IO presence. For more than one instance, add the Socket.IO Redis adapter and sticky sessions; background jobs already use a database lock so only one instance runs them.

### Backup & recovery recommendations
- Enable **daily automated database backups with point-in-time recovery** (built into Supabase/Neon/Render paid tiers), and keep at least 7–30 days.
- Back up the `storage/` volume daily (or use S3/R2 with versioning).
- Test a restore into a staging database at least once before launch, then quarterly.
- Keep `.env` secrets in the host's secret manager, not in backups or the repository.

---

## 11. Admin quick guide

- **Users** — approve new accounts for messaging; suspend, ban, restore; grant seller plans; promote admins.
- **Sellers** — review authorization requests (approve + assign plan / request info / reject); extend or revoke subscriptions.
- **Listings** — the review queue; approve, reject, request changes, unpublish, suspend, restore, feature, edit, delete. Flags show reports and possible duplicates.
- **Payments** — verify or reject bank transfers (view receipts), manage refunds.
- **Seller plans** — single-listing fee, monthly/quarterly/annual and custom plans: price, currency, listing limit, active limit, duration or fixed expiry date, featured boosts.
- **Categories** — add, edit, hide, delete, reorder; subcategories; images and icons.
- **Reports** — investigate; reported conversations can be read (each view is logged); suspend/ban from the report.
- **Announcements** — in-app message to all members, sellers or buyers.
- **Settings** — name, logo, favicon, colours, locations, contact details, payment options, listing lifetime, email switches, chat rate limit, terms and privacy policy.
- **Activity log** — who approved, verified, suspended or changed what, and when. It cannot be edited.
