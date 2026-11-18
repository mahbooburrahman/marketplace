-- 003_canada.sql — the platform targets Canada: Canadian dollars by default.
ALTER TABLE seller_plans ALTER COLUMN currency SET DEFAULT 'CAD';
ALTER TABLE listings ALTER COLUMN currency SET DEFAULT 'CAD';
