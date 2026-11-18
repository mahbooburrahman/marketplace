-- 004_brand_saudago.sql — rename the default brand to SaudaGo and use its colours.
-- Only values still at the old defaults are changed, so edits made in Admin → Settings are kept.
UPDATE website_settings
SET value = jsonb_set(value, '{name}', '"SaudaGo"')
WHERE key = 'site' AND value->>'name' = 'Mandi';

UPDATE website_settings
SET value = jsonb_set(value, '{primary_color}', '"#0E5C4B"')
WHERE key = 'site' AND lower(value->>'primary_color') = '#0f766e';

UPDATE website_settings
SET value = jsonb_set(value, '{accent_color}', '"#F5A623"')
WHERE key = 'site' AND lower(value->>'accent_color') = '#f59e0b';
