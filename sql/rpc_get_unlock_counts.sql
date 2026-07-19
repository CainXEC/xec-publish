-- Reader (unlock) counts per post, with an optional time window on
-- unlocks.unlocked_at. This is the COUNT sibling of get_unlock_earnings
-- (sql/rpc_get_unlock_earnings.sql, which SUMs the same rows) — keep the two
-- in step when either changes.
--
-- WHY THIS FILE EXISTS NOW: get_unlock_counts has always lived only in the
-- Supabase dashboard. This is now its source of record (repo convention: the
-- schema is managed in the dashboard, the sql/ file is authoritative). Apply in
-- the Supabase SQL editor; service-role only, no RLS policies. Safe to re-run.
--
-- HOUSE/AI UNLOCKS ARE EXCLUDED FROM THE COUNT — a deliberate POLICY CHOICE.
-- The platform runs AI agents (authors.is_ai), e.g. a "patron" that unlocks real
-- users' articles. That payment is real (the author is paid 94%) and the reach is
-- desired, but "readers" is a PUBLIC reach signal: it feeds the front-page rail's
-- lead / most-read ranking (app/api/articles/rail/route.ts) and the "N readers"
-- byline. A house grant must not inflate that, so an unlock whose payer maps to an
-- is_ai author is dropped from the count.
--   The opposite choice is defensible — a patron unlock IS a real read — so this
--   is a policy decision, not a correctness rule. To count house reads as reach,
--   delete the ai_addresses CTE and its NOT EXISTS clause below.
--   NOTE the asymmetry with get_unlock_earnings, which KEEPS these rows: reach
--   (this count) is filtered, but money (that sum) is not, because the author
--   genuinely received the patron's payment.
--
-- IDENTIFYING THE UNLOCKER: unlocks has no account column — the only identity is
-- the on-chain payer_address (lib/verifyPaymentUnlock.js). We bridge it to an
-- author two ways, mirroring lib/resolveProfile.authorForAddress: a wallet linked
-- to the account (account_addresses) OR the author's own payout wallet
-- (authors.xec_address). Addresses are compared on the NORMALIZED form (lowercase,
-- leading 'ecash:' stripped) because rows store either form (sql/change_primary_address.sql).

CREATE OR REPLACE FUNCTION public.get_unlock_counts(
  post_ids uuid[],
  since timestamptz
)
RETURNS TABLE (post_id uuid, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH ai_addresses AS (
    -- Every normalized wallet address belonging to a house/AI author: their
    -- linked login/spend wallets, plus their own payout address. Tiny set.
    SELECT lower(regexp_replace(aa.address, '^ecash:', '')) AS addr
    FROM public.account_addresses aa
    JOIN public.accounts acc ON acc.id = aa.account_id
    JOIN public.authors au ON au.id = acc.author_id
    WHERE au.is_ai = true
    UNION
    SELECT lower(regexp_replace(au.xec_address, '^ecash:', '')) AS addr
    FROM public.authors au
    WHERE au.is_ai = true AND au.xec_address IS NOT NULL
  )
  SELECT
    u.post_id,
    COUNT(*)::bigint AS count
  FROM public.unlocks u
  WHERE u.post_id = ANY (post_ids)
    AND (since IS NULL OR u.unlocked_at >= since)
    -- Exclude house/AI unlockers (see header). NOT EXISTS is NULL-safe: an unlock
    -- with a NULL / unresolvable payer matches nothing here and stays counted.
    AND NOT EXISTS (
      SELECT 1 FROM ai_addresses a
      WHERE a.addr = lower(regexp_replace(u.payer_address, '^ecash:', ''))
    )
  GROUP BY u.post_id;
$$;
