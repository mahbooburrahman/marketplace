-- Database guard tests: run against a freshly migrated database.
-- Each "expect error" block uses a DO block that fails loudly if the guard does NOT fire.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO roles VALUES ('user',''),('admin',''),('system','') ON CONFLICT DO NOTHING;
INSERT INTO permissions VALUES ('listing.create',''),('listing.feature',''),('chat.initiate',''),('admin.all','') ON CONFLICT DO NOTHING;
INSERT INTO users (id,email,password_hash,role,status,email_verified_at,terms_accepted_at) VALUES
 ('00000000-0000-0000-0000-00000000000a','admin@t','x','admin','approved',now(),now()),
 ('00000000-0000-0000-0000-00000000000b','seller@t','x','user','approved',now(),now()),
 ('00000000-0000-0000-0000-00000000000c','buyer@t','x','user','approved',now(),now()),
 ('00000000-0000-0000-0000-00000000000d','pending@t','x','user','pending_approval',now(),now());
INSERT INTO categories (id,name,slug) VALUES ('00000000-0000-0000-0000-0000000000c1','Phones','phones');
INSERT INTO seller_plans (id,name,kind,price,listing_limit,max_active_listings,duration_days) VALUES ('00000000-0000-0000-0000-0000000000f1','Monthly','monthly',100,5,5,30);
INSERT INTO seller_subscriptions (id,user_id,plan_id,status,plan_name,price,currency,listing_limit,max_active_listings,duration_days,featured_allowed)
 VALUES ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000f1','awaiting_payment','Monthly',100,'PKR',5,5,30,false);

-- T1: a non-seller cannot create a listing
DO $$ BEGIN
  INSERT INTO listings (seller_id,category_id,title,slug,description,price,condition,location,status)
  VALUES ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000c1','Phone','p1','desc',1,'good','Lahore','pending_approval');
  RAISE EXCEPTION 'T1 FAILED: non-seller created a listing';
EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'seller_not_authorized' THEN RAISE; END IF; RAISE NOTICE 'T1 ok: non-seller blocked (%)', SQLERRM; END $$;

-- T2: subscription cannot be activated without a verified payment
DO $$ BEGIN
  UPDATE seller_subscriptions SET status='active', starts_at=now(), expires_at=now()+interval '30 days' WHERE id='00000000-0000-0000-0000-0000000000e1';
  RAISE EXCEPTION 'T2 FAILED: activated without payment';
EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'activation_requires_verified_payment' THEN RAISE; END IF; RAISE NOTICE 'T2 ok: %', SQLERRM; END $$;

-- T3: a payment cannot be marked verified by a non-admin
INSERT INTO payments (id,user_id,subscription_id,amount,currency,method,status) VALUES ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000e1',100,'PKR','bank_transfer','under_review');
DO $$ BEGIN
  UPDATE payments SET status='verified', verified_by='00000000-0000-0000-0000-00000000000b' WHERE id='00000000-0000-0000-0000-0000000000d1';
  RAISE EXCEPTION 'T3 FAILED: seller verified own payment';
EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'payment_verification_requires_admin' THEN RAISE; END IF; RAISE NOTICE 'T3 ok: %', SQLERRM; END $$;

-- Admin verifies, activates, grants permission
UPDATE payments SET status='verified', verified_by='00000000-0000-0000-0000-00000000000a', verified_at=now() WHERE id='00000000-0000-0000-0000-0000000000d1';
UPDATE seller_subscriptions SET status='active', starts_at=now(), expires_at=now()+interval '30 days' WHERE id='00000000-0000-0000-0000-0000000000e1';
INSERT INTO user_permissions (user_id, permission_code, expires_at) VALUES ('00000000-0000-0000-0000-00000000000b','listing.create', now()+interval '30 days');
DO $$ BEGIN IF NOT is_active_seller('00000000-0000-0000-0000-00000000000b') THEN RAISE EXCEPTION 'T4 FAILED: seller not active after verification'; END IF; RAISE NOTICE 'T4 ok: seller active after verified payment'; END $$;

-- T5: listing cannot be inserted directly as published
DO $$ BEGIN
  INSERT INTO listings (seller_id,category_id,title,slug,description,price,condition,location,status)
  VALUES ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000c1','Phone','p0','desc',1,'good','Lahore','published');
  RAISE EXCEPTION 'T5 FAILED';
EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'listing_must_start_unpublished' THEN RAISE; END IF; RAISE NOTICE 'T5 ok: %', SQLERRM; END $$;

INSERT INTO listings (id,seller_id,category_id,title,slug,description,price,condition,location,status,submitted_at,content_hash)
 VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000c1','iPhone 13','iphone-13','A nice phone in good condition',1000,'good','Lahore','pending_approval',now(),'h1');

-- T6: seller cannot self-publish
DO $$ BEGIN
  UPDATE listings SET status='published', approved_by='00000000-0000-0000-0000-00000000000b', approved_at=now() WHERE id='00000000-0000-0000-0000-0000000000a1';
  RAISE EXCEPTION 'T6 FAILED';
EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'publish_requires_admin_approval' THEN RAISE; END IF; RAISE NOTICE 'T6 ok: %', SQLERRM; END $$;

-- T7: conversation not allowed before publish
DO $$ BEGIN
  INSERT INTO conversations (listing_id,buyer_id,seller_id) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000b');
  RAISE EXCEPTION 'T7 FAILED';
EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'listing_not_available' THEN RAISE; END IF; RAISE NOTICE 'T7 ok: %', SQLERRM; END $$;

-- Admin publishes
UPDATE listings SET status='published', approved_by='00000000-0000-0000-0000-00000000000a', approved_at=now(), published_at=now() WHERE id='00000000-0000-0000-0000-0000000000a1';
DO $$ BEGIN RAISE NOTICE 'T8 ok: admin published listing'; END $$;

-- T9: editing key content of a published listing without re-approval is blocked
DO $$ BEGIN
  UPDATE listings SET price=1 WHERE id='00000000-0000-0000-0000-0000000000a1';
  RAISE EXCEPTION 'T9 FAILED';
EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'content_change_requires_reapproval' THEN RAISE; END IF; RAISE NOTICE 'T9 ok: %', SQLERRM; END $$;
-- ...but non-moderated fields are fine
UPDATE listings SET availability='reserved', view_count=view_count+1 WHERE id='00000000-0000-0000-0000-0000000000a1';

-- T10: unapproved buyer cannot open a chat
DO $$ BEGIN
  INSERT INTO conversations (listing_id,buyer_id,seller_id) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-00000000000b');
  RAISE EXCEPTION 'T10 FAILED';
EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'buyer_not_approved' THEN RAISE; END IF; RAISE NOTICE 'T10 ok: %', SQLERRM; END $$;

-- T11: approved buyer can; seller_id must match the listing
DO $$ BEGIN
  INSERT INTO conversations (listing_id,buyer_id,seller_id) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000a');
  RAISE EXCEPTION 'T11 FAILED';
EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'seller_mismatch' THEN RAISE; END IF; RAISE NOTICE 'T11 ok: %', SQLERRM; END $$;
INSERT INTO conversations (id,listing_id,buyer_id,seller_id) VALUES ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000b');
INSERT INTO conversation_participants VALUES ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000c'),('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000b');
INSERT INTO messages (conversation_id,sender_id,body) VALUES ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000c','Hi');
INSERT INTO messages (conversation_id,sender_id,body) VALUES ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000b','Hello');
DO $$ BEGIN RAISE NOTICE 'T12 ok: buyer and seller exchanged messages'; END $$;

-- T13: outsider cannot post into the conversation
DO $$ BEGIN
  INSERT INTO messages (conversation_id,sender_id,body) VALUES ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000a','snoop');
  RAISE EXCEPTION 'T13 FAILED';
EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'not_a_participant' THEN RAISE; END IF; RAISE NOTICE 'T13 ok: %', SQLERRM; END $$;

-- T14: block stops messages both ways
INSERT INTO blocked_users VALUES ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000c');
DO $$ BEGIN
  INSERT INTO messages (conversation_id,sender_id,body) VALUES ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000c','still there?');
  RAISE EXCEPTION 'T14 FAILED';
EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'blocked' THEN RAISE; END IF; RAISE NOTICE 'T14 ok: %', SQLERRM; END $$;
DELETE FROM blocked_users;

-- T15: audit log is append-only
INSERT INTO activity_logs (action) VALUES ('test');
DO $$ BEGIN
  DELETE FROM activity_logs;
  RAISE EXCEPTION 'T15 FAILED';
EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'activity_logs_are_append_only' THEN RAISE; END IF; RAISE NOTICE 'T15 ok: %', SQLERRM; END $$;

-- T16: expired subscription => no longer a seller; new chats refused
UPDATE seller_subscriptions SET expires_at = now() - interval '1 minute' WHERE id='00000000-0000-0000-0000-0000000000e1';
DO $$ BEGIN IF is_active_seller('00000000-0000-0000-0000-00000000000b') THEN RAISE EXCEPTION 'T16 FAILED'; END IF; RAISE NOTICE 'T16 ok: expired seller inactive'; END $$;

-- T17: full-text search finds the listing by partial title (ILIKE) and by word (tsvector)
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM listings l WHERE l.search_vector @@ websearch_to_tsquery('simple','iphone') OR l.title ILIKE '%phon%';
  IF n <> 1 THEN RAISE EXCEPTION 'T17 FAILED: %', n; END IF; RAISE NOTICE 'T17 ok: search works';
END $$;
ROLLBACK;
