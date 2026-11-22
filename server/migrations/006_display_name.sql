-- 006_display_name.sql — optional trade/business name shown to buyers instead of the real name.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS display_name text;
