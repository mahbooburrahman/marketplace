-- 001_init.sql — core schema for the classified marketplace
-- Requires PostgreSQL 13+ (gen_random_uuid is built in).

-- ---------- Enumerations ----------
CREATE TYPE user_status AS ENUM ('email_unverified','pending_approval','approved','rejected','suspended','banned');
CREATE TYPE seller_request_status AS ENUM ('pending','info_requested','approved','rejected','cancelled');
CREATE TYPE subscription_status AS ENUM ('awaiting_payment','payment_review','active','expired','cancelled','revoked');
CREATE TYPE payment_status AS ENUM ('pending','under_review','verified','rejected','failed','expired');
CREATE TYPE refund_status AS ENUM ('none','requested','processing','refunded','declined');
CREATE TYPE listing_status AS ENUM ('draft','pending_approval','approved','rejected','changes_requested','published','sold','expired','suspended','archived');
CREATE TYPE listing_condition AS ENUM ('new','like_new','good','fair','for_parts');
CREATE TYPE report_status AS ENUM ('open','investigating','resolved','dismissed');

-- ---------- Roles & permissions ----------
CREATE TABLE roles (
  name        TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE permissions (
  code        TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE role_permissions (
  role_name       TEXT NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_name, permission_code)
);

-- ---------- Users ----------
CREATE TABLE users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT NOT NULL,
  password_hash      TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'user' REFERENCES roles(name),
  status             user_status NOT NULL DEFAULT 'email_unverified',
  status_reason      TEXT,
  email_verified_at  TIMESTAMPTZ,
  approved_at        TIMESTAMPTZ,
  approved_by        UUID REFERENCES users(id),
  terms_accepted_at  TIMESTAMPTZ NOT NULL,
  failed_logins      INT NOT NULL DEFAULT 0,
  locked_until       TIMESTAMPTZ,
  last_seen_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE INDEX users_status_idx ON users (status) WHERE deleted_at IS NULL;

CREATE TABLE user_profiles (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL,
  phone       TEXT NOT NULL,
  avatar_path TEXT,
  location    TEXT,
  bio         TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_permissions (
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  granted_by      UUID REFERENCES users(id),
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,
  PRIMARY KEY (user_id, permission_code)
);

CREATE TABLE sessions (
  id_hash     TEXT PRIMARY KEY,               -- sha256 of the cookie token; raw token never stored
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE email_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_tokens_user_idx ON email_tokens (user_id, purpose);

-- ---------- Seller authorization & payments ----------
CREATE TABLE seller_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_name  TEXT,
  business_type  TEXT,
  message        TEXT NOT NULL,
  status         seller_request_status NOT NULL DEFAULT 'pending',
  admin_note     TEXT,
  info_requested TEXT,
  info_response  TEXT,
  reviewed_by    UUID REFERENCES users(id),
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Only one open request per user at a time
CREATE UNIQUE INDEX seller_requests_open_uq ON seller_requests (user_id) WHERE status IN ('pending','info_requested');

CREATE TABLE seller_plans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('single','monthly','quarterly','annual','custom')),
  description         TEXT NOT NULL DEFAULT '',
  price               NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  currency            CHAR(3) NOT NULL DEFAULT 'PKR',
  listing_limit       INT NOT NULL CHECK (listing_limit > 0),   -- total listings that can be created during the plan
  max_active_listings INT NOT NULL CHECK (max_active_listings > 0),
  duration_days       INT NOT NULL CHECK (duration_days > 0),
  featured_allowed    BOOLEAN NOT NULL DEFAULT false,
  featured_quota      INT NOT NULL DEFAULT 0,
  fixed_expiry_date   DATE,                                     -- optional hard end date for custom plans
  is_active           BOOLEAN NOT NULL DEFAULT true,
  sort_order          INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);

CREATE TABLE seller_subscriptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id             UUID NOT NULL REFERENCES seller_plans(id),
  request_id          UUID REFERENCES seller_requests(id),
  status              subscription_status NOT NULL DEFAULT 'awaiting_payment',
  -- snapshot of plan terms at assignment time, so later plan edits don't change paid subscriptions
  plan_name           TEXT NOT NULL,
  price               NUMERIC(12,2) NOT NULL,
  currency            CHAR(3) NOT NULL,
  listing_limit       INT NOT NULL,
  max_active_listings INT NOT NULL,
  duration_days       INT NOT NULL,
  featured_allowed    BOOLEAN NOT NULL,
  featured_quota      INT NOT NULL DEFAULT 0,
  listings_used       INT NOT NULL DEFAULT 0,
  featured_used       INT NOT NULL DEFAULT 0,
  starts_at           TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  payment_due_at      TIMESTAMPTZ,
  expiry_reminded_at  TIMESTAMPTZ,
  assigned_by         UUID REFERENCES users(id),
  revoked_reason      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX seller_subs_user_idx ON seller_subscriptions (user_id, status);
CREATE INDEX seller_subs_expiry_idx ON seller_subscriptions (expires_at) WHERE status = 'active';

CREATE TABLE payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id),
  subscription_id  UUID NOT NULL REFERENCES seller_subscriptions(id),
  amount           NUMERIC(12,2) NOT NULL,
  currency         CHAR(3) NOT NULL,
  method           TEXT NOT NULL CHECK (method IN ('bank_transfer','gateway','admin_waiver')),
  provider         TEXT NOT NULL DEFAULT 'manual',
  provider_ref     TEXT,                 -- gateway session / transaction id
  reference_number TEXT,                 -- user-supplied bank transfer reference
  status           payment_status NOT NULL DEFAULT 'pending',
  refund_status    refund_status NOT NULL DEFAULT 'none',
  refund_note      TEXT,
  rejection_reason TEXT,
  verified_by      UUID REFERENCES users(id),
  verified_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payments_provider_ref_uq ON payments (provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX payments_status_idx ON payments (status, created_at DESC);
CREATE INDEX payments_user_idx ON payments (user_id, created_at DESC);

CREATE TABLE payment_receipts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id    UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  file_path     TEXT NOT NULL,         -- stored in private storage, never publicly served
  original_name TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size_bytes    INT NOT NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Categories ----------
CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT 'tag',
  image_path  TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX categories_slug_uq ON categories (slug) WHERE deleted_at IS NULL;

CREATE TABLE subcategories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX subcategories_slug_uq ON subcategories (category_id, slug) WHERE deleted_at IS NULL;

-- ---------- Listings ----------
CREATE TABLE listings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id       UUID NOT NULL REFERENCES users(id),
  subscription_id UUID REFERENCES seller_subscriptions(id),
  category_id     UUID NOT NULL REFERENCES categories(id),
  subcategory_id  UUID REFERENCES subcategories(id),
  title           TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  slug            TEXT NOT NULL,
  description     TEXT NOT NULL CHECK (char_length(description) <= 5000),
  price           NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  currency        CHAR(3) NOT NULL DEFAULT 'PKR',
  negotiable      BOOLEAN NOT NULL DEFAULT false,
  condition       listing_condition NOT NULL,
  location        TEXT NOT NULL,
  contact_phone   TEXT,
  show_phone      BOOLEAN NOT NULL DEFAULT false,
  availability    TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available','reserved','out_of_stock')),
  video_url       TEXT,
  status          listing_status NOT NULL DEFAULT 'draft',
  status_note     TEXT,                 -- latest admin note (rejection reason / requested changes)
  is_featured     BOOLEAN NOT NULL DEFAULT false,
  featured_until  TIMESTAMPTZ,
  view_count      INT NOT NULL DEFAULT 0,
  content_hash    TEXT,                 -- duplicate detection
  submitted_at    TIMESTAMPTZ,
  approved_at     TIMESTAMPTZ,
  approved_by     UUID REFERENCES users(id),
  published_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  expiry_reminded_at TIMESTAMPTZ,
  sold_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  search_vector   tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(location,'')), 'C') ||
    setweight(to_tsvector('simple', coalesce(description,'')), 'B')
  ) STORED
);
CREATE INDEX listings_public_idx ON listings (status, published_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX listings_seller_idx ON listings (seller_id, status);
CREATE INDEX listings_category_idx ON listings (category_id, subcategory_id) WHERE status = 'published';
CREATE INDEX listings_price_idx ON listings (price) WHERE status = 'published';
CREATE INDEX listings_search_idx ON listings USING GIN (search_vector);
CREATE INDEX listings_hash_idx ON listings (seller_id, content_hash);
CREATE UNIQUE INDEX listings_slug_uq ON listings (slug);

CREATE TABLE listing_images (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  thumb_path  TEXT NOT NULL,
  width       INT,
  height      INT,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX listing_images_listing_idx ON listing_images (listing_id, sort_order);

CREATE TABLE listing_approvals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  actor_id    UUID REFERENCES users(id),
  action      TEXT NOT NULL CHECK (action IN ('submitted','approved','rejected','changes_requested','suspended','unpublished','restored','edited_by_admin')),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX listing_approvals_listing_idx ON listing_approvals (listing_id, created_at DESC);

-- ---------- Chat ----------
CREATE TABLE conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      UUID NOT NULL REFERENCES listings(id),
  buyer_id        UUID NOT NULL REFERENCES users(id),
  seller_id       UUID NOT NULL REFERENCES users(id),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (buyer_id <> seller_id),
  UNIQUE (listing_id, buyer_id)
);

CREATE TABLE conversation_participants (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at    TIMESTAMPTZ NOT NULL DEFAULT 'epoch',
  archived        BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conv_participants_user_idx ON conversation_participants (user_id);

CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES users(id),
  body            TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 4000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX messages_conv_idx ON messages (conversation_id, created_at DESC);

CREATE TABLE message_attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,   -- private storage; served only to participants
  mime        TEXT NOT NULL,
  size_bytes  INT NOT NULL,
  width       INT,
  height      INT
);

-- ---------- Engagement ----------
CREATE TABLE favorites (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  link        TEXT,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     UUID NOT NULL REFERENCES users(id),
  target_type     TEXT NOT NULL CHECK (target_type IN ('listing','user','conversation')),
  target_id       UUID NOT NULL,
  reason          TEXT NOT NULL CHECK (reason IN ('fake_product','fraudulent_seller','inappropriate','spam','misleading_price','suspicious','harassment','other')),
  details         TEXT,
  status          report_status NOT NULL DEFAULT 'open',
  resolution_note TEXT,
  resolved_by     UUID REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reports_status_idx ON reports (status, created_at DESC);
CREATE INDEX reports_target_idx ON reports (target_type, target_id);
-- one open report per reporter per target (prevents report spam)
CREATE UNIQUE INDEX reports_open_uq ON reports (reporter_id, target_type, target_id) WHERE status IN ('open','investigating');

CREATE TABLE blocked_users (
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE activity_logs (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID REFERENCES users(id),
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  meta        JSONB NOT NULL DEFAULT '{}',
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX activity_logs_created_idx ON activity_logs (created_at DESC);
CREATE INDEX activity_logs_actor_idx ON activity_logs (actor_id, created_at DESC);
CREATE INDEX activity_logs_target_idx ON activity_logs (target_type, target_id);

CREATE TABLE website_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
