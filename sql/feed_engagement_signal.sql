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
--
-- (Previously also returned total_amount_sats, a hard-saturated anti-whale boost.
-- Dropped 2026-08-27: with tips removed from posts and reactions/reposts flat at
-- 100 XEC, the only remaining amount variance was reply/quote length, so the term
-- degenerated to a near-constant "+~1h if any paid support" that breadth already
-- captured. The ranker now scores on breadth + conversation + exploration alone.)
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
-- HOUSE/AI SUPPORTERS ARE EXCLUDED THE SAME WAY. The platform runs AI agents
-- (authors.is_ai) that pay to react to real users' posts — e.g. a "herald" that
-- likes/reposts. Those payments are REAL (the target author still receives 94%)
-- and stay visible on the post, but they must not buy organic rank. So a reaction
-- whose SUPPORTER account maps to an is_ai author is anti-joined out (ai_accounts
-- CTE) at the SAME "filter before the tally" stage as a self/alt-ring reaction —
-- it adds neither breadth nor amount. This filters is_ai SUPPORTERS only; whether
-- an is_ai account's OWN posts stay in the ranked window is a separate policy
-- call, made upstream in getFeed's candidate query, not here.
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

-- The 2026-08-27 amount-drop removed a column from RETURNS TABLE, and Postgres
-- refuses to change a function's return type via CREATE OR REPLACE — so drop the
-- old (3-column) signature first. IF EXISTS keeps this safe on a fresh DB.
DROP FUNCTION IF EXISTS public.get_feed_engagement_signal(text[]);

CREATE OR REPLACE FUNCTION public.get_feed_engagement_signal(post_txids text[])
RETURNS TABLE (
  target_txid        text,
  distinct_supporters bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH ai_accounts AS (
    -- House/AI-operated accounts (authors.is_ai): the herald and any other agent
    -- that pays to react. Materialized once, then anti-joined out of both reaction
    -- branches below so an is_ai supporter adds neither breadth nor amount. In
    -- practice this set is a handful of rows (usually empty) = near-zero overhead.
    SELECT acc.id AS account_id
    FROM public.accounts acc
    JOIN public.authors au ON au.id = acc.author_id
    WHERE au.is_ai = true
  ),
  targets AS (
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
      COALESCE(al.cluster_id, e.actor_account_id) AS supporter_cluster
    FROM public.feed_events e
    LEFT JOIN public.account_links al ON al.account_id = e.actor_account_id
    WHERE e.target_txid = ANY (post_txids)
      -- Drop house/AI reactors: still visible on-chain, but they buy no rank.
      AND NOT EXISTS (SELECT 1 FROM ai_accounts x WHERE x.account_id = e.actor_account_id)

    UNION ALL

    -- Replies (2, via parent_txid) + quotes (3, via quoted_txid): paid feed_posts
    -- pointing at a target. Only live rows (a tombstoned reply isn't support).
    SELECT
      COALESCE(c.parent_txid, c.quoted_txid) AS target_txid,
      COALESCE(al.cluster_id, c.author_account_id) AS supporter_cluster
    FROM public.feed_posts c
    LEFT JOIN public.account_links al ON al.account_id = c.author_account_id
    WHERE c.deleted_at IS NULL
      AND (
        (c.action = 2 AND c.parent_txid = ANY (post_txids)) OR
        (c.action = 3 AND c.quoted_txid = ANY (post_txids))
      )
      -- Same house/AI exclusion for paid replies/quotes.
      AND NOT EXISTS (SELECT 1 FROM ai_accounts x WHERE x.account_id = c.author_account_id)
  )
  SELECT
    t.txid AS target_txid,
    COUNT(DISTINCT r.supporter_cluster) AS distinct_supporters
  FROM targets t
  JOIN reactions r
    ON r.target_txid = t.txid
   -- The anti-gaming exclusion: self-tips and alt-ring tips fail this predicate
   -- and are dropped BEFORE the COUNT/SUM.
   AND r.supporter_cluster IS DISTINCT FROM t.author_cluster
  GROUP BY t.txid;
$$;
