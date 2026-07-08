-- Unified "Following" timeline: a followee's own posts INTERLEAVED with posts
-- they REPOST, each positioned by its surfacing time (Twitter-style "Reposted
-- by @X").
--
-- WHY AN RPC. The plain Following feed is a single keyset scan over feed_posts.
-- A repost, though, lives in feed_events (action 4) with its OWN timestamp and
-- points at a DIFFERENT post (target_txid) — so surfacing reposts means merging
-- two tables and paginating the merged stream by a single time key. Doing that
-- correctly across pages (no skips/dupes at a boundary) is exactly what a keyset
-- over a UNION gives you, and that's awkward to express through the query builder
-- but trivial in SQL.
--
-- Each returned entry is one of:
--   kind='post'   → a native post/reply/quote by a followee. sort_ts = the post's
--                   own created_at; display_txid = the post itself.
--   kind='repost' → the ORIGINAL post, resurfaced at the REPOST's created_at.
--                   sort_ts = the repost time (so it floats to where the repost
--                   happened, not where the original was written); display_txid =
--                   the reposted post; reposter_* = who reposted it.
--
-- ORDERING / KEYSET. Ordered (sort_ts DESC, sort_id DESC). sort_id is the source
-- row's uuid (feed_posts.id or feed_events.id) — a deterministic tiebreaker when a
-- post and a repost share a timestamp, so a page boundary never skips or repeats.
-- Pass the previous page's last (sort_ts, sort_id) as (before_ts, before_id) to
-- get the next window; pass NULLs for the first page.
--
-- DEDUP IS NOT DONE HERE. A post can appear both natively AND via one or more
-- reposts. The caller keeps only the MOST-RECENT surfacing of each display_txid,
-- which — because the stream is newest-first — is simply the FIRST occurrence it
-- sees (within a window, and across pages via the client's existing txid dedup).
-- Collapsing in SQL would fight the keyset, so we leave it to the caller.
--
-- BLOCKS. Reposts whose ORIGINAL author is in a block relationship with the
-- viewer are excluded (blocked_ids). Native posts are already limited to
-- follower_ids, which the caller has pre-filtered of blocked accounts.
--
-- Apply in the Supabase SQL editor (schema is managed in the dashboard; this
-- file is the source of record). Safe to re-run.

CREATE OR REPLACE FUNCTION public.get_following_timeline(
  follower_ids uuid[],
  blocked_ids  uuid[],
  before_ts    timestamptz,
  before_id    uuid,
  page_size    int
)
RETURNS TABLE (
  display_txid        text,
  kind                text,
  reposter_account_id uuid,
  reposter_identity   text,
  sort_ts             timestamptz,
  sort_id             uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH entries AS (
    -- A followee's own posts/replies/quotes (the plain Following stream).
    SELECT
      p.txid        AS display_txid,
      'post'::text  AS kind,
      NULL::uuid    AS reposter_account_id,
      NULL::text    AS reposter_identity,
      p.created_at  AS sort_ts,
      p.id          AS sort_id
    FROM public.feed_posts p
    WHERE p.action IN (1, 2, 3)
      AND p.deleted_at IS NULL
      AND p.author_account_id = ANY (follower_ids)

    UNION ALL

    -- Posts a followee reposted, resurfaced at the repost's timestamp.
    SELECT
      p.txid             AS display_txid,
      'repost'::text     AS kind,
      e.actor_account_id AS reposter_account_id,
      e.actor_identity   AS reposter_identity,
      e.created_at       AS sort_ts,
      e.id               AS sort_id
    FROM public.feed_events e
    JOIN public.feed_posts p ON p.txid = e.target_txid
    WHERE e.action = 4
      AND e.actor_account_id = ANY (follower_ids)
      AND p.deleted_at IS NULL
      AND (blocked_ids IS NULL OR p.author_account_id <> ALL (blocked_ids))
  )
  SELECT display_txid, kind, reposter_account_id, reposter_identity, sort_ts, sort_id
  FROM entries
  WHERE before_ts IS NULL
     OR sort_ts < before_ts
     OR (sort_ts = before_ts AND sort_id < before_id)
  ORDER BY sort_ts DESC, sort_id DESC
  LIMIT GREATEST(page_size, 1);
$$;
