-- Sum of unlocks.amount_xec per post (optional time window on unlocks.unlocked_at).
-- Mirrors get_unlock_counts(post_ids, since) but aggregates SUM instead of COUNT.
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
