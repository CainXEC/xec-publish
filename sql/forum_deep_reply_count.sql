-- Forum reply_count should be the DEEP total (every nested reply in the
-- thread), matching what a forum's own thread page shows via getFeedThread's
-- `deep: true` flat descendant list — not just direct children. A plain FEED
-- reply (forum_id NULL) keeps counting direct children only, since a feed
-- thread page only ever shows one level of replies (never a nested tree), so
-- "deep" there would show a bigger number than the page ever displays.
--
-- Before this: /f/<slug>'s card and any other forum listing showed a post's
-- DIRECT reply count (feed_posts.reply_count, maintained by the existing
-- feed_posts_reply_count trigger, which only bumps the immediate parent);
-- the thread page itself showed the deep total. Same post, two different
-- numbers.
--
-- Apply in the Supabase SQL editor. Idempotent — safe to re-run; the backfill
-- at the bottom re-derives the same totals every time.

-- 1. Recompute a forum post's reply_count from scratch (every live nested
--    reply anywhere under it, any depth) — self-healing, called on every
--    write instead of an incremental +1/-1 so a forum thread's counts can
--    never drift out of sync with reality.
CREATE OR REPLACE FUNCTION public.count_forum_descendants(root_txid text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH RECURSIVE descendants AS (
    SELECT txid FROM public.feed_posts
    WHERE parent_txid = root_txid AND action = 2 AND deleted_at IS NULL
    UNION ALL
    SELECT c.txid FROM public.feed_posts c
    JOIN descendants d ON c.parent_txid = d.txid
    WHERE c.action = 2 AND c.deleted_at IS NULL
  )
  SELECT COUNT(*)::integer FROM descendants;
$$;

-- 2. Walk UP from `start_txid` (a reply's direct parent) through every
--    ancestor to the forum root, refreshing each one's reply_count. A reply
--    5 levels deep counts toward its parent, grandparent, ... all the way up.
CREATE OR REPLACE FUNCTION public.feed_posts_refresh_forum_ancestors(start_txid text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  anc text;
BEGIN
  IF start_txid IS NULL THEN
    RETURN;
  END IF;
  FOR anc IN
    WITH RECURSIVE ancestors AS (
      SELECT txid, parent_txid FROM public.feed_posts WHERE txid = start_txid
      UNION ALL
      SELECT p.txid, p.parent_txid FROM public.feed_posts p
      JOIN ancestors a ON p.txid = a.parent_txid
    )
    SELECT txid FROM ancestors
  LOOP
    UPDATE public.feed_posts SET reply_count = public.count_forum_descendants(anc) WHERE txid = anc;
  END LOOP;
END;
$$;

-- 3. Redefine the reply/quote counter trigger: a forum reply (forum_id set)
--    refreshes its whole ancestor chain deeply; a plain feed reply keeps the
--    original single-parent +1/-1 (unchanged — quotes are untouched either way).
CREATE OR REPLACE FUNCTION public.feed_posts_maintain_reply_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.action = 2 AND NEW.parent_txid IS NOT NULL AND NEW.deleted_at IS NULL THEN
      IF NEW.forum_id IS NOT NULL THEN
        PERFORM public.feed_posts_refresh_forum_ancestors(NEW.parent_txid);
      ELSE
        UPDATE public.feed_posts SET reply_count = reply_count + 1 WHERE txid = NEW.parent_txid;
      END IF;
    ELSIF NEW.action = 3 AND NEW.quoted_txid IS NOT NULL AND NEW.deleted_at IS NULL THEN
      UPDATE public.feed_posts SET quote_count = quote_count + 1 WHERE txid = NEW.quoted_txid;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.action = 2 AND NEW.parent_txid IS NOT NULL THEN
      IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
        IF NEW.forum_id IS NOT NULL THEN
          PERFORM public.feed_posts_refresh_forum_ancestors(NEW.parent_txid);
        ELSE
          UPDATE public.feed_posts SET reply_count = GREATEST(reply_count - 1, 0) WHERE txid = NEW.parent_txid;
        END IF;
      ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
        IF NEW.forum_id IS NOT NULL THEN
          PERFORM public.feed_posts_refresh_forum_ancestors(NEW.parent_txid);
        ELSE
          UPDATE public.feed_posts SET reply_count = reply_count + 1 WHERE txid = NEW.parent_txid;
        END IF;
      END IF;
    ELSIF NEW.action = 3 AND NEW.quoted_txid IS NOT NULL THEN
      IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
        UPDATE public.feed_posts SET quote_count = GREATEST(quote_count - 1, 0) WHERE txid = NEW.quoted_txid;
      ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
        UPDATE public.feed_posts SET quote_count = quote_count + 1 WHERE txid = NEW.quoted_txid;
      END IF;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.action = 2 AND OLD.parent_txid IS NOT NULL AND OLD.deleted_at IS NULL THEN
      IF OLD.forum_id IS NOT NULL THEN
        PERFORM public.feed_posts_refresh_forum_ancestors(OLD.parent_txid);
      ELSE
        UPDATE public.feed_posts SET reply_count = GREATEST(reply_count - 1, 0) WHERE txid = OLD.parent_txid;
      END IF;
    ELSIF OLD.action = 3 AND OLD.quoted_txid IS NOT NULL AND OLD.deleted_at IS NULL THEN
      UPDATE public.feed_posts SET quote_count = GREATEST(quote_count - 1, 0) WHERE txid = OLD.quoted_txid;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;
-- The trigger itself (feed_posts_reply_count on feed_posts) already points at
-- this function by name — CREATE OR REPLACE above is enough, no re-wiring.

-- 4. Backfill every EXISTING forum post's reply_count to the deep total, and
--    every plain feed post's back to the direct-children total (unchanged
--    formula) — re-run-safe, re-derives the same numbers each time.
UPDATE public.feed_posts p SET
  reply_count = CASE
    WHEN p.forum_id IS NOT NULL THEN public.count_forum_descendants(p.txid)
    ELSE COALESCE((
      SELECT COUNT(*) FROM public.feed_posts c
      WHERE c.action = 2 AND c.deleted_at IS NULL AND c.parent_txid = p.txid), 0)
  END
WHERE p.action IN (1, 2); -- top-level posts and replies only — nothing else carries a meaningful reply_count
