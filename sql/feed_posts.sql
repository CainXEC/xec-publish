-- Paid "tweets" feed. Each row is one on-chain, paid-for post or reply.
-- Apply in the Supabase SQL editor (schema is managed in the dashboard; this
-- file is the source of record — mirror the /sql convention used for RPCs).
--
-- Identity is STAMPED at write time (author_identity), matching the comments
-- model: the byline is frozen to what the poster's identity was when they paid,
-- so selling/rebinding a handle never rewrites old bylines. payout_address is
-- likewise a snapshot so replies always pay the wallet that made the parent post.

CREATE TABLE IF NOT EXISTS public.feed_posts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txid              text NOT NULL UNIQUE,           -- the on-chain post/reply/quote tx
  action            smallint NOT NULL,              -- 1 = post, 2 = reply, 3 = quote
  parent_txid       text,                           -- reply → immediate parent's txid
  quoted_txid       text,                           -- quote → the post being quoted
  content           text NOT NULL,
  content_hash      text NOT NULL,                  -- sha256(content) hex; == on-chain OP_RETURN
  author_account_id uuid REFERENCES public.accounts(id),
  author_identity   text NOT NULL,                  -- snapshot: "@handle" or raw ecash address
  payer_address     text NOT NULL,                  -- proven payer (tx.inputs[0])
  payout_address    text NOT NULL,                  -- snapshot; where replies to this post pay
  amount_sats       bigint NOT NULL,                -- total paid (author + platform)
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz                     -- soft delete: author tombstoned the post
);

-- Soft-delete column (safe to re-run on an existing table).
ALTER TABLE public.feed_posts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Quote target (safe to re-run on an existing table).
ALTER TABLE public.feed_posts ADD COLUMN IF NOT EXISTS quoted_txid text;

-- Avalanche-finality state. A post is published at 0-conf the moment its payment
-- is SEEN, so the feed feels instant; finalized_at stays NULL until the tx is
-- Avalanche-final. The reconcile sweep (/api/feed/reconcile) re-checks each NULL
-- row: it stamps finalized_at once the tx finalizes, or hard-deletes the row if
-- the tx never finalizes within the grace window (a double-spend that lost, so
-- the post was never really paid for). Safe to re-run.
ALTER TABLE public.feed_posts ADD COLUMN IF NOT EXISTS finalized_at timestamptz;

-- Sweep lookup: the provisional (not-yet-final) rows the reconcile job re-checks.
CREATE INDEX IF NOT EXISTS feed_posts_provisional_idx
  ON public.feed_posts (created_at)
  WHERE finalized_at IS NULL;

-- Deny-by-default for anon/authenticated keys. The app only ever touches this
-- table via the service-role key (createServerSupabase), which bypasses RLS, so
-- enabling RLS with NO policies locks out direct client access — nobody can
-- INSERT/UPDATE/DELETE around the pay-to-post verification — without breaking
-- reads or writes. Safe to re-run.
ALTER TABLE public.feed_posts ENABLE ROW LEVEL SECURITY;

-- Newest-first feed of top-level entries: original posts (1) and quotes (3),
-- both of which surface in the main timeline. Replies (2) are excluded.
-- Recreated to widen the predicate from `action = 1`; safe to re-run.
DROP INDEX IF EXISTS public.feed_posts_toplevel_created_idx;
CREATE INDEX IF NOT EXISTS feed_posts_toplevel_created_idx
  ON public.feed_posts (created_at DESC)
  WHERE action IN (1, 3);

-- Thread lookups: all replies to a given parent.
CREATE INDEX IF NOT EXISTS feed_posts_parent_idx
  ON public.feed_posts (parent_txid);

CREATE INDEX IF NOT EXISTS feed_posts_author_idx
  ON public.feed_posts (author_account_id);

-- Reply counts for a batch of post txids (mirrors get_comment_counts).
CREATE OR REPLACE FUNCTION public.get_feed_reply_counts(post_txids text[])
RETURNS TABLE (parent_txid text, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    f.parent_txid,
    COUNT(*)::bigint AS count
  FROM public.feed_posts f
  WHERE f.action = 2
    AND f.deleted_at IS NULL
    AND f.parent_txid = ANY (post_txids)
  GROUP BY f.parent_txid;
$$;
