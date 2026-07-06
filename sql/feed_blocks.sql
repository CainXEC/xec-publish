-- Feed-native block graph: one row per (blocker -> blocked), both keyed by
-- public.accounts(id). Mirrors feed_follows (sql/feed_follows.sql) but with the
-- opposite intent.
--
-- A block is directional as an ACTION (blocker chose to block blocked), but its
-- visibility effect is MUTUAL: once the row exists, neither account sees the
-- other's posts/replies, and the blocked account can't reply to the blocker.
-- The read path enforces this by hiding posts from anyone in a block
-- relationship with the viewer in EITHER direction (see lib/feedBlocks.js).
--
-- Apply in the Supabase SQL editor (schema is managed in the dashboard; this
-- file is the source of record). Safe to re-run.

CREATE TABLE IF NOT EXISTS public.feed_blocks (
  blocker_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  blocked_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_account_id, blocked_account_id),
  -- No self-blocks (also enforced in the API).
  CONSTRAINT feed_blocks_no_self CHECK (blocker_account_id <> blocked_account_id)
);

-- Deny-by-default: the app only touches this via the service-role key (bypasses
-- RLS). Enabling RLS with NO policies locks out direct anon/authenticated access
-- without affecting server writes.
ALTER TABLE public.feed_blocks ENABLE ROW LEVEL SECURITY;

-- "Who has blocked this account?" — the other half of the mutual-visibility
-- lookup (the PK already covers "who has this account blocked?").
CREATE INDEX IF NOT EXISTS feed_blocks_blocked_idx
  ON public.feed_blocks (blocked_account_id);
