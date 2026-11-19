-- 005_buyers_auto_approved.sql — buyers only need a verified email; only sellers need admin approval.
-- Accounts that verified their email but were still waiting for admin approval become active.
UPDATE users
SET status = 'approved', approved_at = COALESCE(approved_at, now())
WHERE status = 'pending_approval' AND email_verified_at IS NOT NULL AND role = 'user' AND deleted_at IS NULL;
