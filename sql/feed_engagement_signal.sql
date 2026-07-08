-- Paid-engagement ranking signal for a window of feed posts.
--
-- The denormalized counters on feed_posts (like_count, repost_count, …) are
-- COUNT-ONLY: they can't tell you how many DISTINCT people paid, how much XEC
-- they spent, or whether a reaction was self-dealing. Those three facts are the
-- whole anti-gaming story, so they can't come from the counters — they need a
-- set-based aggregation over the raw rows. This RPC does exactly that for one
-- ~25-post feed window at a time (called once per window in getFeed's ranker).
--
-- WHAT IT RETURNS, per candidate post:
--   distinct_supporters — how many DISTINCT paying clusters reacted (the primary
--                         quality signal; breadth is what an attacker can't fake
--                         cheaply — alt wallets cost real fees to fund).
--   total_amount_sats   — total XEC paid across those reactions (a SECONDARY
--                         boost; the ranker saturates it hard so a whale can
--                         nudge a post up a few slots but never buy the page).
--
-- WHAT COUNTS AS A "REACTION": every PAID interaction with the post —
--   • likes + reposts  → feed_events rows targeting the post (target_txid)
--   • replies + quotes → feed_posts rows pointing at the post (parent/quoted_txid)
-- Replies/quotes deliberately appear here AND in the ranker's separate
-- conversation term: a paid reply is both support (money spent) and discussion.
--
-- THE ANTI-GAMING FILTER IS BAKED INTO THE JOIN. Each supporter and each post
-- author is mapped to a CLUSTER via account_links (COALESCE(cluster_id, own id)
-- when unlinked — see account_links.sql). The join keeps a reaction only when
--     supporter_cluster IS DISTINCT FROM author_cluster
-- so a self-tip (same account) or an alt-ring tip (same cluster) FAILS THE JOIN
-- and never enters COUNT/SUM. "Filter before the tally" — gamed reactions are
-- gone before any aggregation happens, not discounted afterward.
--
-- FINALITY: we intentionally do NOT gate on finalized_at. Reactions are recorded
-- at 0-conf so the signal is as fresh as the counters, and the reconcile sweep
-- hard-deletes any reaction whose tx never finalizes (a lost double-spend that
-- was never really paid) — which self-corrects this tally on the next read. A
-- double-spend can't durably inflate rank, so gating on finality would only add
-- 2-3s of lag for no safety gain.
--
-- Apply in the Supabase SQL editor (schema is managed in the dashboard; this
-- file is the source of record). Depends on account_links.sql. Safe to re-run.

CREATE OR REPLACE FUNCTION public.get_feed_engagement_signal(post_txids text[])
RETURNS TABLE (
  target_txid        text,
  distinct_supporters bigint,
  total_amount_sats   numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH targets AS (
    -- Each candidate post with its author's effective cluster (own id if unlinked).
    SELECT
      p.txid,
      COALESCE(al.cluster_id, p.author_account_id) AS author_cluster
    FROM public.feed_posts p
    LEFT JOIN public.account_links al ON al.account_id = p.author_account_id
    WHERE p.txid = ANY (post_txids)
  ),
  reactions AS (
    -- Likes (5) + reposts (4): content-free paid reactions in feed_events.
    SELECT
      e.target_txid,
      COALESCE(al.cluster_id, e.actor_account_id) AS supporter_cluster,
      e.amount_sats
    FROM public.feed_events e
    LEFT JOIN public.account_links al ON al.account_id = e.actor_account_id
    WHERE e.target_txid = ANY (post_txids)

    UNION ALL

    -- Replies (2, via parent_txid) + quotes (3, via quoted_txid): paid feed_posts
    -- pointing at a target. Only live rows (a tombstoned reply isn't support).
    SELECT
      COALESCE(c.parent_txid, c.quoted_txid) AS target_txid,
      COALESCE(al.cluster_id, c.author_account_id) AS supporter_cluster,
      c.amount_sats
    FROM public.feed_posts c
    LEFT JOIN public.account_links al ON al.account_id = c.author_account_id
    WHERE c.deleted_at IS NULL
      AND (
        (c.action = 2 AND c.parent_txid = ANY (post_txids)) OR
        (c.action = 3 AND c.quoted_txid = ANY (post_txids))
      )
  )
  SELECT
    t.txid AS target_txid,
    COUNT(DISTINCT r.supporter_cluster)   AS distinct_supporters,
    COALESCE(SUM(r.amount_sats), 0)::numeric AS total_amount_sats
  FROM targets t
  JOIN reactions r
    ON r.target_txid = t.txid
   -- The anti-gaming exclusion: self-tips and alt-ring tips fail this predicate
   -- and are dropped BEFORE the COUNT/SUM.
   AND r.supporter_cluster IS DISTINCT FROM t.author_cluster
  GROUP BY t.txid;
$$;
