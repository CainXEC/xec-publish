-- =============================================================================
--  migrate_follows_to_feed_follows.sql
--
--  Backfill the account-keyed follow graph (feed_follows) from the legacy
--  wallet-keyed follows table, so follows made from the article-page Follow
--  button survive the cutover to /api/feed/follow.
--
--  WHY: the article page used to write public.follows (reader_wallet_address ->
--  authors.id) via the now-deleted /api/follows route. That route took the
--  wallet straight from the request body with no session check, so anyone could
--  forge follows for any wallet. The article button now calls the session-authed
--  /api/feed/follow, which writes public.feed_follows (account -> account). This
--  copies the real, pre-existing follows across so nobody's follows reset.
--
--  Safe to re-run (idempotent via ON CONFLICT). Rows are SKIPPED when:
--    - the reader wallet never became an account (a stray wallet that never
--      logged in — it can't be represented, and couldn't be shown, in the
--      account world anyway), or
--    - the followed author has no account row, or
--    - the mapping would be a self-follow (feed_follows forbids it).
--
--  Address matching is prefix/case-insensitive ('ecash:' stripped, lowercased)
--  so rows written in either format line up.
--
--  Apply in the Supabase SQL editor (schema is managed in the dashboard; this
--  file is the source of record).
-- =============================================================================

INSERT INTO public.feed_follows (follower_account_id, followee_account_id)
SELECT DISTINCT aa.account_id, ac.id
FROM public.follows f
JOIN public.account_addresses aa
  ON lower(replace(aa.address, 'ecash:', ''))
   = lower(replace(f.reader_wallet_address, 'ecash:', ''))
JOIN public.accounts ac
  ON ac.author_id = f.author_id
WHERE aa.account_id <> ac.id
ON CONFLICT DO NOTHING;

-- After verifying the backfill (e.g. compare counts below), the legacy table and
-- its route are fully retired — nothing in the app reads public.follows anymore.
-- Drop it when you're satisfied:
--
--   -- SELECT count(*) FROM public.follows;        -- legacy rows
--   -- SELECT count(*) FROM public.feed_follows;   -- after backfill
--   -- DROP TABLE public.follows;
