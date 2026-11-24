-- 008_banners.sql — paid / promotional banners shown in the home page slider.
CREATE TABLE IF NOT EXISTS banners (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL DEFAULT '',
  link_url    text NOT NULL DEFAULT '',
  cta         text NOT NULL DEFAULT '',
  image_path  text,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  starts_on   date,
  ends_on     date,
  views       int NOT NULL DEFAULT 0,
  clicks      int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
