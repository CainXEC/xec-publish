-- Top published posts by RECENT unlock volume — the discovery query behind the
-- front page's "Most Read this week" section (app/api/articles/rail/route.ts).
--
-- WHY THIS EXISTS: get_unlock_counts (sql/rpc_get_unlock_counts.sql) takes a
-- KNOWN post_ids list and tallies unlocks for each. That can't resurface an OLD
-- or legacy article, because the rail only ever knows about the ~80 most recently
-- created/published posts — a years-old piece being unlocked a lot right now is
-- never in that list, so its recent count is never even computed. This function
-- INVERTS the lookup: it scans recent unlocks and returns the hottest post_ids,
-- so the rail can pull those posts into its candidate pool regardless of age.
--
-- Same house/AI exclusion as get_unlock_counts (keep the two in step): an unlock
-- whose payer maps to an authors.is_ai account is dropped, so a patron/house
-- agent can't pump an article onto the front page. Reach is filtered; money
-- (get_unlock_earnings) is not — same asymmetry documented there.
--
-- Repo convention: schema managed in the Supabase dashboard, this sql/ file is
-- the source of record. Apply in the SQL editor; service-role only, no RLS.
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.get_recent_hot_posts(
  since timestamptz,
  max_posts int
)
RETURNS TABLE (post_id uuid, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH ai_addresses AS (
    -- Every normalized wallet address belonging to a house/AI author (linked
    -- login/spend wallets + their own payout address). Mirrors get_unlock_counts.
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
  -- Only surface live, published posts (an unlock could point at a since-
  -- unpublished draft; the front page must never link to one).
  JOIN public.posts p ON p.id = u.post_id AND p.published = true
  WHERE (since IS NULL OR u.unlocked_at >= since)
    AND NOT EXISTS (
      SELECT 1 FROM ai_addresses a
      WHERE a.addr = lower(regexp_replace(u.payer_address, '^ecash:', ''))
    )
  GROUP BY u.post_id
  ORDER BY count DESC, u.post_id
  LIMIT GREATEST(max_posts, 0);
$$;
