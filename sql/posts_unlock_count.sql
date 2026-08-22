-- =============================================================================
--  posts_unlock_count.sql — denormalized READER count per article.
--
--  An author's profile shows each story's reader (unlock) count, the "most read"
--  ranking, and a total-readers tally. Those were computed on every profile view
--  by get_unlock_counts — a GROUP BY over the whole `unlocks` table for ALL of
--  the author's posts, with an AI-exclusion join. For a prolific author (a big
--  legacy archive) that aggregate dominated the page's load time.
--
--  This denormalizes it: each `posts` row carries its own live reader count in
--  `unlock_count`, maintained by a trigger as unlocks land (and, symmetrically,
--  if one is ever deleted). A profile read then just SELECTs the column — no
--  per-view aggregate — and "most read" becomes an indexed ORDER BY.
--
--  SEMANTICS MATCH get_unlock_counts EXACTLY (the all-time / since=NULL case):
--  house/AI unlockers (authors.is_ai) are EXCLUDED, because "readers" is a public
--  reach signal a house patron must not inflate. The one shared source of that
--  rule is is_ai_payer() below — the trigger and the backfill both call it, so
--  they can't drift. (Time-WINDOWED reader counts — "most read this week" — still
--  go through get_unlock_counts with a `since`; only the all-time total is
--  denormalized here.)
--
--  Apply in the Supabase SQL editor (schema is managed in the dashboard; this
--  file is the source of record). Idempotent — safe to re-run. Ordering matters:
--  column, then helper + trigger, THEN the absolute backfill last, so any unlock
--  landing mid-migration is already trigger-counted and the row-locked backfill
--  overwrites with the true total — nothing double-counts or is lost.
-- =============================================================================

-- 1. Counter column (default 0, never null).
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS unlock_count integer NOT NULL DEFAULT 0;

-- 2. The AI-exclusion predicate, shared by the trigger and the backfill so the
--    denormalized count can't drift from get_unlock_counts. True when `addr` is a
--    house/AI author's wallet — a linked login/spend address OR their payout
--    address — compared on the NORMALIZED form (lowercase, 'ecash:' stripped),
--    exactly as get_unlock_counts does.
CREATE OR REPLACE FUNCTION public.is_ai_payer(addr text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.account_addresses aa
    JOIN public.accounts acc ON acc.id = aa.account_id
    JOIN public.authors au ON au.id = acc.author_id
    WHERE au.is_ai = true
      AND lower(regexp_replace(aa.address, '^ecash:', '')) =
          lower(regexp_replace(coalesce(addr, ''), '^ecash:', ''))
    UNION
    SELECT 1
    FROM public.authors au
    WHERE au.is_ai = true
      AND au.xec_address IS NOT NULL
      AND lower(regexp_replace(au.xec_address, '^ecash:', '')) =
          lower(regexp_replace(coalesce(addr, ''), '^ecash:', ''))
  );
$$;

-- 3. Trigger: keep posts.unlock_count in step as unlocks are inserted/deleted.
--    A NULL/unresolvable payer is NOT an AI wallet, so it stays counted (matches
--    get_unlock_counts' NULL-safe NOT EXISTS). DELETE is floored at 0 so a stray
--    double-delete can't drive the count negative. Unlocks are effectively
--    append-only; the DELETE arm exists only for account deletion / cleanup.
CREATE OR REPLACE FUNCTION public.unlocks_maintain_post_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT public.is_ai_payer(NEW.payer_address) THEN
      UPDATE public.posts SET unlock_count = unlock_count + 1 WHERE id = NEW.post_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF NOT public.is_ai_payer(OLD.payer_address) THEN
      UPDATE public.posts SET unlock_count = GREATEST(unlock_count - 1, 0) WHERE id = OLD.post_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS unlocks_maintain_post_count_trg ON public.unlocks;
CREATE TRIGGER unlocks_maintain_post_count_trg
AFTER INSERT OR DELETE ON public.unlocks
FOR EACH ROW EXECUTE FUNCTION public.unlocks_maintain_post_count();

-- 4. Absolute backfill (LAST). Row-locked UPDATE to the true AI-excluded total,
--    so it's correct even if the trigger already counted an unlock that landed
--    mid-migration. Posts with no (non-AI) unlocks stay at the default 0.
UPDATE public.posts p
SET unlock_count = COALESCE(c.cnt, 0)
FROM (
  SELECT u.post_id, COUNT(*)::int AS cnt
  FROM public.unlocks u
  WHERE NOT public.is_ai_payer(u.payer_address)
  GROUP BY u.post_id
) c
WHERE p.id = c.post_id;

-- Reset any post whose only unlocks were AI (or which the subquery didn't touch)
-- to 0 — keeps a re-run idempotent rather than additive.
UPDATE public.posts p
SET unlock_count = 0
WHERE p.unlock_count <> 0
  AND NOT EXISTS (
    SELECT 1 FROM public.unlocks u
    WHERE u.post_id = p.id AND NOT public.is_ai_payer(u.payer_address)
  );

-- 5. Index for the "most read" ranking (top-N by reader count per author).
CREATE INDEX IF NOT EXISTS posts_author_unlock_count_idx
  ON public.posts (author_id, unlock_count DESC)
  WHERE published;

-- Service-role only, matching the repo's no-public-grants posture.
REVOKE ALL ON FUNCTION public.is_ai_payer(text) FROM public;
REVOKE ALL ON FUNCTION public.is_ai_payer(text) FROM anon;
REVOKE ALL ON FUNCTION public.is_ai_payer(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_ai_payer(text) TO service_role;
