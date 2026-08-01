-- Pinned post: one feed post an account has pinned to the top of its profile
-- timeline (Twitter/X-style). NULL = no pin. Singular — pinning a new post
-- replaces the old one (the app just overwrites this column).
--
-- The pinned post is one of the account's OWN top-level feed_posts; the txid is
-- validated as such by /api/feed/pin before it's written here. Rendering
-- (lib/getFeed.js) fetches this txid, dedupes it out of the chronological window,
-- and prepends it — so a stale/deleted txid is harmless (the fetch just misses).
--
-- Repo convention: schema managed in the Supabase dashboard, this sql/ file is
-- the source of record. accounts is service-role only (no RLS policy change).
-- Safe to re-run.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS pinned_post_txid text;
