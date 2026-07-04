-- Content-free engagement on the paid feed: likes and reposts. Each row is one
-- on-chain, paid-for reaction to a feed post. Unlike feed_posts, a reaction
-- carries no content of its own (no content hash) — just a pointer to the target
-- post and the 100 XEC payment (94% to the target's author, 6% platform).
--
-- Apply in the Supabase SQL editor (schema is managed in the dashboard; this
-- file is the source of record). FK depends on public.accounts(id).
--
-- Identity is STAMPED at write time (actor_identity), matching feed_posts: the
-- reactor's byline is frozen to who they were when they paid. payout_address is
-- a snapshot of where the 94% author share went.

CREATE TABLE IF NOT EXISTS public.feed_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txid             text NOT NULL UNIQUE,            -- the on-chain reaction tx
  action           smallint NOT NULL,               -- 4 = repost, 5 = like
  target_txid      text NOT NULL,                   -- the feed post reacted to
  actor_account_id uuid REFERENCES public.accounts(id),
  actor_identity   text NOT NULL,                   -- snapshot: "@handle" or raw ecash address
  payer_address    text NOT NULL,                   -- proven payer (tx.inputs[0])
  payout_address   text NOT NULL,                   -- snapshot: target author's payout (got 94%)
  amount_sats      bigint NOT NULL,                 -- total paid (author + platform)
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- One like and one repost per wallet per post (no undo in v1). A wallet can
  -- both like AND repost the same post, hence action is part of the key.
  UNIQUE (action, target_txid, payer_address)
);

-- Deny-by-default: app only touches this via the service-role key (bypasses
-- RLS). Enabling RLS with NO policies locks out direct anon/authenticated
-- access without affecting server writes. Safe to re-run.
ALTER TABLE public.feed_events ENABLE ROW LEVEL SECURITY;

-- Engagement lookups for a batch of target posts.
CREATE INDEX IF NOT EXISTS feed_events_target_idx
  ON public.feed_events (target_txid);

-- "Did this wallet already react?" and profile activity.
CREATE INDEX IF NOT EXISTS feed_events_payer_idx
  ON public.feed_events (payer_address);

CREATE INDEX IF NOT EXISTS feed_events_actor_idx
  ON public.feed_events (actor_account_id);

-- Like/repost counts for a batch of post txids (mirrors get_feed_reply_counts).
-- Returns one row per (target_txid, action) with its count.
CREATE OR REPLACE FUNCTION public.get_feed_event_counts(post_txids text[])
RETURNS TABLE (target_txid text, action smallint, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    e.target_txid,
    e.action,
    COUNT(*)::bigint AS count
  FROM public.feed_events e
  WHERE e.target_txid = ANY (post_txids)
  GROUP BY e.target_txid, e.action;
$$;
