-- Paid likes on article comments. Each row is one on-chain, paid-for like of a
-- comment — the comment analogue of feed_events (which likes feed POSTS). A like
-- carries no content, just a pointer to the target COMMENT's txid and the 100 XEC
-- payment (94% to the comment's author, 6% platform). Deliberately a SEPARATE
-- table from feed_events: the target lives in `comments`, not `feed_posts`, and
-- the feed's counts/activity must never fold in comment likes.
--
-- Apply in the Supabase SQL editor (schema is managed in the dashboard; this
-- file is the source of record). FK depends on public.accounts(id).
--
-- Identity is STAMPED at write time (actor_identity), matching feed_events: the
-- liker's byline is frozen to who they were when they paid. payout_address is a
-- snapshot of where the 94% comment-author share went.

CREATE TABLE IF NOT EXISTS public.comment_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txid             text NOT NULL UNIQUE,            -- the on-chain like tx
  action           smallint NOT NULL,               -- 5 = like (repost/quote N/A for comments)
  target_txid      text NOT NULL,                   -- the COMMENT reacted to (comments.txid)
  actor_account_id uuid REFERENCES public.accounts(id),
  actor_identity   text NOT NULL,                   -- snapshot: "@handle" or raw ecash address
  payer_address    text NOT NULL,                   -- proven payer (tx.inputs[0])
  payout_address   text NOT NULL,                   -- snapshot: comment author's payout (got 94%)
  amount_sats      bigint NOT NULL,                 -- total paid (author + platform); a like can tip above the floor
  created_at       timestamptz NOT NULL DEFAULT now(),
  finalized_at     timestamptz,                     -- Avalanche-final stamp (NULL = provisional)
  -- One like per wallet per comment (no undo in v1), mirroring feed_events.
  UNIQUE (action, target_txid, payer_address)
);

-- Sweep lookup: provisional (not-yet-final) rows the reconcile job re-checks.
-- Comment likes are recorded at 0-conf the moment payment is SEEN, so the count
-- bumps instantly; finalized_at stays NULL until the tx is Avalanche-final. The
-- reconcile sweep (/api/feed/reconcile) stamps finalized_at once final, or
-- hard-deletes the row if it never finalizes within the grace window (a
-- double-spend that lost, so it was never really paid). Counts are computed live
-- from the rows, so a deletion self-corrects the count on the next read.
CREATE INDEX IF NOT EXISTS comment_events_provisional_idx
  ON public.comment_events (created_at)
  WHERE finalized_at IS NULL;

-- Like counts for a batch of comment txids.
CREATE INDEX IF NOT EXISTS comment_events_target_idx
  ON public.comment_events (target_txid);

-- "Did this account already like?" (viewer state) and profile activity.
CREATE INDEX IF NOT EXISTS comment_events_actor_idx
  ON public.comment_events (actor_account_id);

CREATE INDEX IF NOT EXISTS comment_events_payer_idx
  ON public.comment_events (payer_address);

-- Deny-by-default: the app only touches this via the service-role key (bypasses
-- RLS). Enabling RLS with NO policies locks out direct anon/authenticated access
-- without affecting server writes. Safe to re-run.
ALTER TABLE public.comment_events ENABLE ROW LEVEL SECURITY;
