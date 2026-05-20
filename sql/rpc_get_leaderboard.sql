-- Author leaderboard: unlock counts and earnings per author.
-- Scope: published posts only (includes legacy). Optional time window on unlocks.unlocked_at.
-- Apply in Supabase SQL editor or via migration.

CREATE OR REPLACE FUNCTION public.get_leaderboard(
  since timestamptz,
  sort_by text
)
RETURNS TABLE (
  author_id uuid,
  username text,
  post_count bigint,
  total_unlocks bigint,
  total_xec bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH stats AS (
    SELECT
      p.author_id,
      COUNT(DISTINCT p.id)::bigint AS post_count,
      COUNT(u.id)::bigint AS total_unlocks,
      COALESCE(SUM(u.amount_xec::numeric), 0)::bigint AS total_xec
    FROM public.posts p
    INNER JOIN public.unlocks u ON u.post_id = p.id
    WHERE p.published = true
      AND (since IS NULL OR u.unlocked_at >= since)
    GROUP BY p.author_id
  )
  SELECT
    a.id AS author_id,
    COALESCE(a.username, '') AS username,
    s.post_count,
    s.total_unlocks,
    s.total_xec
  FROM stats s
  INNER JOIN public.authors a ON a.id = s.author_id
  ORDER BY
    CASE WHEN sort_by = 'xec' THEN s.total_xec ELSE s.total_unlocks END DESC,
    CASE WHEN sort_by = 'xec' THEN s.total_unlocks ELSE s.total_xec END DESC;
$$;
