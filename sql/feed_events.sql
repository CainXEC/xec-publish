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

-- Avalanche-finality state (mirrors feed_posts). A like/repost is recorded at
-- 0-conf the moment its payment is SEEN, so the count bumps instantly;
-- finalized_at stays NULL until the tx is Avalanche-final. The reconcile sweep
-- (/api/feed/reconcile) stamps finalized_at once final, or hard-deletes the row
-- if it never finalizes within the grace window (double-spent, so never really
-- paid). Counts are computed live from the rows, so a deletion self-corrects the
-- count on the next read. Safe to re-run.
ALTER TABLE public.feed_events ADD COLUMN IF NOT EXISTS finalized_at timestamptz;

-- Sweep lookup: the provisional (not-yet-final) rows the reconcile job re-checks.
CREATE INDEX IF NOT EXISTS feed_events_provisional_idx
  ON public.feed_events (created_at)
  WHERE finalized_at IS NULL;

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
