-- Feed-native follow graph: one row per (follower -> followee), both keyed by
-- public.accounts(id). This is what powers the feed's "Following" tab.
--
-- Distinct from the legacy public.follows table (keyed by reader wallet address
-- -> authors.id): most feed posters are reader-only accounts with no author_id,
-- so they can't be represented there. feed_posts.author_account_id is already an
-- accounts(id), so following by account id is the natural join key here.
--
-- Apply in the Supabase SQL editor (schema is managed in the dashboard; this
-- file is the source of record). Safe to re-run.

CREATE TABLE IF NOT EXISTS public.feed_follows (
  follower_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  followee_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_account_id, followee_account_id),
  -- No self-follows (also enforced in the API).
  CONSTRAINT feed_follows_no_self CHECK (follower_account_id <> followee_account_id)
);

-- Deny-by-default: the app only touches this via the service-role key (bypasses
-- RLS). Enabling RLS with NO policies locks out direct anon/authenticated access
-- without affecting server writes.
ALTER TABLE public.feed_follows ENABLE ROW LEVEL SECURITY;

-- "Who follows this account?" (follower counts, follower lists).
CREATE INDEX IF NOT EXISTS feed_follows_followee_idx
  ON public.feed_follows (followee_account_id);
