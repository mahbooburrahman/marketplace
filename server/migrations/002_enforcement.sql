-- 002_enforcement.sql — database-level guards for the platform's critical rules.
-- These run in addition to the API's permission checks, so a bug or a direct SQL
-- write cannot bypass moderation, seller authorization or chat access rules.

-- Helper: does a user hold an active, paid seller authorization right now?
CREATE OR REPLACE FUNCTION is_active_seller(p_user UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users u
    JOIN user_permissions up ON up.user_id = u.id AND up.permission_code = 'listing.create'
    JOIN seller_subscriptions s ON s.user_id = u.id AND s.status = 'active'
    WHERE u.id = p_user
      AND u.status = 'approved'
      AND u.deleted_at IS NULL
      AND (up.expires_at IS NULL OR up.expires_at > now())
      AND s.expires_at > now()
  );
$$;

CREATE OR REPLACE FUNCTION is_admin(p_user UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = p_user AND role = 'admin' AND status = 'approved' AND deleted_at IS NULL);
$$;

-- 1) Listings: no listing becomes public without explicit admin approval,
--    and only active sellers can create listings.
CREATE OR REPLACE FUNCTION guard_listings() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT is_active_seller(NEW.seller_id) AND NOT is_admin(NEW.seller_id) THEN
      RAISE EXCEPTION 'seller_not_authorized' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.status NOT IN ('draft','pending_approval') THEN
      RAISE EXCEPTION 'listing_must_start_unpublished' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published' THEN
    IF NEW.approved_by IS NULL OR NOT is_admin(NEW.approved_by)
       OR NEW.approved_at IS NULL
       OR (NEW.submitted_at IS NOT NULL AND NEW.approved_at < NEW.submitted_at) THEN
      RAISE EXCEPTION 'publish_requires_admin_approval' USING ERRCODE = 'P0001';
    END IF;
    -- Re-publishing (e.g. after suspension) also requires the seller to still be active
    IF NOT is_active_seller(NEW.seller_id) AND NOT is_admin(NEW.seller_id) THEN
      RAISE EXCEPTION 'seller_not_authorized' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- A published listing whose key content changes must either go back to review,
  -- or be re-approved by an admin in the same write.
  IF OLD.status = 'published' AND NEW.status = 'published' AND (
       NEW.title IS DISTINCT FROM OLD.title OR
       NEW.description IS DISTINCT FROM OLD.description OR
       NEW.price IS DISTINCT FROM OLD.price OR
       NEW.category_id IS DISTINCT FROM OLD.category_id OR
       NEW.subcategory_id IS DISTINCT FROM OLD.subcategory_id OR
       NEW.content_hash IS DISTINCT FROM OLD.content_hash) THEN
    IF NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at OR NOT is_admin(NEW.approved_by) THEN
      RAISE EXCEPTION 'content_change_requires_reapproval' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER listings_guard
BEFORE INSERT OR UPDATE ON listings
FOR EACH ROW EXECUTE FUNCTION guard_listings();

-- 2) Conversations: only an approved buyer may open a chat on a published listing
--    of an active seller, and never across a block.
CREATE OR REPLACE FUNCTION guard_conversations() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_listing listings%ROWTYPE;
BEGIN
  SELECT * INTO v_listing FROM listings WHERE id = NEW.listing_id;
  IF NOT FOUND OR v_listing.status <> 'published' OR v_listing.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'listing_not_available' USING ERRCODE = 'P0001';
  END IF;
  IF v_listing.seller_id <> NEW.seller_id THEN
    RAISE EXCEPTION 'seller_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.buyer_id AND status = 'approved'
                 AND email_verified_at IS NOT NULL AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'buyer_not_approved' USING ERRCODE = 'P0001';
  END IF;
  IF NOT is_active_seller(NEW.seller_id) AND NOT is_admin(NEW.seller_id) THEN
    RAISE EXCEPTION 'seller_not_active' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM blocked_users
             WHERE (blocker_id = NEW.buyer_id AND blocked_id = NEW.seller_id)
                OR (blocker_id = NEW.seller_id AND blocked_id = NEW.buyer_id)) THEN
    RAISE EXCEPTION 'blocked' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER conversations_guard
BEFORE INSERT ON conversations
FOR EACH ROW EXECUTE FUNCTION guard_conversations();

-- 3) Messages: sender must be a participant, approved, and not blocked.
CREATE OR REPLACE FUNCTION guard_messages() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_conv conversations%ROWTYPE;
  v_other UUID;
BEGIN
  SELECT * INTO v_conv FROM conversations WHERE id = NEW.conversation_id;
  IF NOT FOUND OR NEW.sender_id NOT IN (v_conv.buyer_id, v_conv.seller_id) THEN
    RAISE EXCEPTION 'not_a_participant' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.sender_id AND status = 'approved' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'sender_not_allowed' USING ERRCODE = 'P0001';
  END IF;
  v_other := CASE WHEN NEW.sender_id = v_conv.buyer_id THEN v_conv.seller_id ELSE v_conv.buyer_id END;
  IF EXISTS (SELECT 1 FROM blocked_users
             WHERE (blocker_id = NEW.sender_id AND blocked_id = v_other)
                OR (blocker_id = v_other AND blocked_id = NEW.sender_id)) THEN
    RAISE EXCEPTION 'blocked' USING ERRCODE = 'P0001';
  END IF;
  UPDATE conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_guard
BEFORE INSERT ON messages
FOR EACH ROW EXECUTE FUNCTION guard_messages();

-- 4) Seller privileges: an active subscription requires a verified payment
--    or an explicit admin waiver recorded as a verified payment.
CREATE OR REPLACE FUNCTION guard_subscriptions() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
    IF NOT EXISTS (SELECT 1 FROM payments p
                   WHERE p.subscription_id = NEW.id AND p.status = 'verified'
                     AND p.verified_by IS NOT NULL) THEN
      RAISE EXCEPTION 'activation_requires_verified_payment' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER subscriptions_guard
BEFORE INSERT OR UPDATE ON seller_subscriptions
FOR EACH ROW EXECUTE FUNCTION guard_subscriptions();

-- 5) Payments can only be marked verified by an admin (or by the gateway system actor).
CREATE OR REPLACE FUNCTION guard_payments() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'verified' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'verified') THEN
    IF NEW.verified_by IS NULL OR NOT EXISTS (
         SELECT 1 FROM users WHERE id = NEW.verified_by AND (role IN ('admin','system'))) THEN
      RAISE EXCEPTION 'payment_verification_requires_admin' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER payments_guard
BEFORE INSERT OR UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION guard_payments();

-- 6) Audit log is append-only.
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'activity_logs_are_append_only' USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER activity_logs_immutable
BEFORE UPDATE OR DELETE ON activity_logs
FOR EACH ROW EXECUTE FUNCTION forbid_change();
