-- =============================================================================
--  Fix: get_comment_counts must exclude soft-deleted comments.
--
--  A deleted comment is tombstoned (comments.deleted_at set), but this RPC —
--  which feeds the article's 💬 metric (SSR initial count via
--  getPublishedPostBySlug + the reading pane) and the profile article lists —
--  was still counting it, so the metric showed how many comments there USED to
--  be. The count API (/api/comments/count) already filters deleted; this makes
--  the batch RPC agree. Mirrors get_feed_reply_counts, which already filters.
--
--  CREATE OR REPLACE keeps the same signature (uuid[] in, TABLE(post_id uuid,
--  count bigint) out) — it only adds the `deleted_at IS NULL` predicate.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_comment_counts(post_ids uuid[])
RETURNS TABLE (post_id uuid, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    c.post_id,
    COUNT(*)::bigint AS count
  FROM public.comments c
  WHERE c.post_id = ANY (post_ids)
    AND c.deleted_at IS NULL
  GROUP BY c.post_id;
$$;
