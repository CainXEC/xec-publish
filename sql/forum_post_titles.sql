-- =============================================================================
--  forum post titles — Reddit-style title + body for forum posts.
--
--  A forum top-level post now carries a TITLE. On chain the post's content is
--  stored as `title \n\n body` (one blob), so the existing sha256(content)
--  "proof of writing" hash already covers BOTH the title and the body — no
--  protocol change. This column denormalizes the title for display/search and,
--  crucially, distinguishes a NEW titled forum post (title set) from the handful
--  of pre-existing untitled ones (title NULL → rendered exactly as before).
--
--  Only forum top-level posts set it; feed posts, replies, and quotes leave it
--  NULL. Apply in the Supabase SQL editor. Idempotent — safe to re-run.
-- =============================================================================

ALTER TABLE public.feed_posts
  ADD COLUMN IF NOT EXISTS title text;
