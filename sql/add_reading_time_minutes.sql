-- Run in Supabase SQL Editor (once per project).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS reading_time_minutes INTEGER;
