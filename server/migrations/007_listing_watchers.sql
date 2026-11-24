-- 007_listing_watchers.sql — buyers ask to be told when a sold listing becomes available again.
CREATE TABLE IF NOT EXISTS listing_watchers (
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (listing_id, user_id)
);
