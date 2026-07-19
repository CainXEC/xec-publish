-- Sum of unlocks.amount_xec per post (optional time window on unlocks.unlocked_at).
-- The SUM sibling of get_unlock_counts (sql/rpc_get_unlock_counts.sql, which
-- COUNTs the same rows) — keep the two in step when either changes.
--
-- ONE DELIBERATE ASYMMETRY vs. that sibling: get_unlock_counts EXCLUDES house/AI
-- (authors.is_ai) unlockers so a house "patron" can't inflate a post's public
-- reader count, but this earnings sum KEEPS them. Earnings is real money the
-- author received — a patron unlock paid them 94% for real — so hiding it from
-- the author's own totals would understate what they actually earned. Reach is
-- filtered; money is not. If you ever need an "organic-only earnings" figure, add
-- the same is_ai NOT EXISTS clause get_unlock_counts uses; don't change this default.
--
-- Apply in Supabase SQL editor or via migration.

CREATE OR REPLACE FUNCTION public.get_unlock_earnings(
  post_ids uuid[],
  since timestamptz
)
RETURNS TABLE (post_id uuid, total_amount bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    u.post_id,
    COALESCE(SUM(u.amount_xec::numeric), 0)::bigint AS total_amount
  FROM public.unlocks u
  WHERE u.post_id = ANY (post_ids)
    AND (since IS NULL OR u.unlocked_at >= since)
  GROUP BY u.post_id;
$$;
