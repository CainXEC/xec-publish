-- Denormalized engagement counters on feed_posts. Instead of re-aggregating
-- likes/reposts/replies/quotes on every feed read (the get_feed_event_counts /
-- get_feed_reply_counts RPCs), each post row carries its own live counts,
-- maintained by triggers as reactions, replies and quotes are inserted,
-- tombstoned, or swept away. A page read then just SELECTs the columns — no
-- per-page GROUP BY.
--
-- Apply in the Supabase SQL editor (schema is managed in the dashboard; this
-- file is the source of record). Everything here is idempotent — safe to re-run.
--
-- Ordering matters: create the columns, then the trigger functions + triggers,
-- THEN backfill the absolute counts. Installing triggers before the backfill
-- means any reaction/reply that lands mid-migration is already accounted for by
-- the trigger, and the absolute backfill (a row-locked UPDATE) overwrites with
-- the true total — so no event is double-counted or lost. Run the backfill in a
-- quiet window regardless; this is a low-traffic table.

-- 1. Counter columns (default 0, never null).
ALTER TABLE public.feed_posts ADD COLUMN IF NOT EXISTS reply_count  integer NOT NULL DEFAULT 0;
ALTER TABLE public.feed_posts ADD COLUMN IF NOT EXISTS like_count   integer NOT NULL DEFAULT 0;
ALTER TABLE public.feed_posts ADD COLUMN IF NOT EXISTS repost_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.feed_posts ADD COLUMN IF NOT EXISTS quote_count  integer NOT NULL DEFAULT 0;

-- 2a. Reaction counters: feed_events rows are likes (5) and reposts (4), keyed to
-- a post by target_txid. Events have no soft delete — they're inserted at 0-conf
-- and only ever hard-deleted by the reconcile sweep if they never finalize — so
-- INSERT bumps the count and DELETE decrements it (floored at 0, so a stray
-- double-delete can't drive the count negative). finalized_at updates don't touch
-- the count, so this trigger ignores UPDATE.
CREATE OR REPLACE FUNCTION public.feed_events_maintain_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.action = 5 THEN
      UPDATE public.feed_posts SET like_count = like_count + 1 WHERE txid = NEW.target_txid;
    ELSIF NEW.action = 4 THEN
      UPDATE public.feed_posts SET repost_count = repost_count + 1 WHERE txid = NEW.target_txid;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.action = 5 THEN
      UPDATE public.feed_posts SET like_count = GREATEST(like_count - 1, 0) WHERE txid = OLD.target_txid;
    ELSIF OLD.action = 4 THEN
      UPDATE public.feed_posts SET repost_count = GREATEST(repost_count - 1, 0) WHERE txid = OLD.target_txid;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- 2b. Reply + quote counters: both are feed_posts rows pointing at another post —
-- a reply is action=2 via parent_txid (counted on the parent), a quote is action=3
-- via quoted_txid (counted on the quoted post). The two are structurally identical,
-- so one function maintains both. Only LIVE rows count, so we track three transitions
-- (shown for a reply; a quote is the same on quote_count/quoted_txid):
--   INSERT of a live reply            -> parent.reply_count + 1
--   soft delete  (deleted_at set)     -> parent.reply_count - 1
--   undelete     (deleted_at cleared) -> parent.reply_count + 1
--   hard DELETE of a live reply       -> parent.reply_count - 1  (reconcile sweep)
-- A hard delete of an already-tombstoned row is a no-op (it wasn't counted).
-- The UPDATE branch fires only for deleted_at changes (see the trigger's
-- `UPDATE OF deleted_at` clause), which also means the counter-maintenance
-- UPDATEs this function issues never re-enter it — no recursion.
CREATE OR REPLACE FUNCTION public.feed_posts_maintain_reply_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.action = 2 AND NEW.parent_txid IS NOT NULL AND NEW.deleted_at IS NULL THEN
      UPDATE public.feed_posts SET reply_count = reply_count + 1 WHERE txid = NEW.parent_txid;
    ELSIF NEW.action = 3 AND NEW.quoted_txid IS NOT NULL AND NEW.deleted_at IS NULL THEN
      UPDATE public.feed_posts SET quote_count = quote_count + 1 WHERE txid = NEW.quoted_txid;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.action = 2 AND NEW.parent_txid IS NOT NULL THEN
      IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
        UPDATE public.feed_posts SET reply_count = GREATEST(reply_count - 1, 0) WHERE txid = NEW.parent_txid;
      ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
        UPDATE public.feed_posts SET reply_count = reply_count + 1 WHERE txid = NEW.parent_txid;
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
      UPDATE public.feed_posts SET reply_count = GREATEST(reply_count - 1, 0) WHERE txid = OLD.parent_txid;
    ELSIF OLD.action = 3 AND OLD.quoted_txid IS NOT NULL AND OLD.deleted_at IS NULL THEN
      UPDATE public.feed_posts SET quote_count = GREATEST(quote_count - 1, 0) WHERE txid = OLD.quoted_txid;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- 3. Wire the triggers (drop-then-create so re-running picks up any redefinition).
DROP TRIGGER IF EXISTS feed_events_counts ON public.feed_events;
CREATE TRIGGER feed_events_counts
  AFTER INSERT OR DELETE ON public.feed_events
  FOR EACH ROW EXECUTE FUNCTION public.feed_events_maintain_counts();

DROP TRIGGER IF EXISTS feed_posts_reply_count ON public.feed_posts;
CREATE TRIGGER feed_posts_reply_count
  AFTER INSERT OR DELETE OR UPDATE OF deleted_at ON public.feed_posts
  FOR EACH ROW EXECUTE FUNCTION public.feed_posts_maintain_reply_count();

-- 4. Backfill absolute counts from the current rows. Idempotent: re-running just
-- re-derives the same totals. This UPDATE doesn't touch deleted_at, so it never
-- fires the reply-count trigger on itself.
UPDATE public.feed_posts p SET
  reply_count = COALESCE((
    SELECT COUNT(*) FROM public.feed_posts c
    WHERE c.action = 2 AND c.deleted_at IS NULL AND c.parent_txid = p.txid), 0),
  quote_count = COALESCE((
    SELECT COUNT(*) FROM public.feed_posts c
    WHERE c.action = 3 AND c.deleted_at IS NULL AND c.quoted_txid = p.txid), 0),
  like_count = COALESCE((
    SELECT COUNT(*) FROM public.feed_events e
    WHERE e.action = 5 AND e.target_txid = p.txid), 0),
  repost_count = COALESCE((
    SELECT COUNT(*) FROM public.feed_events e
    WHERE e.action = 4 AND e.target_txid = p.txid), 0);
