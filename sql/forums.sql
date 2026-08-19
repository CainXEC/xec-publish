-- =============================================================================
--  forums — Reddit-style topic communities.
--
--  A forum is created (paid) by a @handle-holder, who becomes the RUNNER and
--  earns the engagement fee — the 6% on replies + POSITIVE reactions in their
--  forum (a 👎 stays 100% to the platform). Fees follow the runner's ACCOUNT
--  (its live primary address), like handle earnings — ownership is account-bound.
--  Top-level POSTING fees stay 100% to the platform (anti-spam: posting is never
--  discounted, so a runner can't spam cheaply). Forum posts are CONTAINED to the
--  forum via feed_posts.forum_id, kept out of the global Feed.
--
--  Apply in the Supabase SQL editor (source of record). Idempotent — safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.forums (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL,                 -- display slug (case preserved)
  slug_skeleton     text NOT NULL,                 -- case-insensitive/confusable-folded (lib/handleSkeleton)
  title             text NOT NULL,
  description       text,
  runner_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  post_count        integer NOT NULL DEFAULT 0,
  CONSTRAINT forums_slug_skeleton_uniq UNIQUE (slug_skeleton)
);
CREATE INDEX IF NOT EXISTS forums_runner_idx ON public.forums (runner_account_id);

-- Deny-by-default: service-role only (no policies), like every other table.
ALTER TABLE public.forums ENABLE ROW LEVEL SECURITY;

-- A feed post belongs to a forum via forum_id (NULL = the global Feed). The
-- global Feed query filters forum_id IS NULL (containment); a forum's page
-- filters forum_id = the forum.
ALTER TABLE public.feed_posts
  ADD COLUMN IF NOT EXISTS forum_id uuid REFERENCES public.forums(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS feed_posts_forum_idx
  ON public.feed_posts (forum_id, created_at DESC)
  WHERE forum_id IS NOT NULL;

-- Maintain forums.post_count on top-level forum posts (action 1 = post, 3 =
-- quote), mirroring the reply/quote counters in sql/feed_reaction_counts.sql.
CREATE OR REPLACE FUNCTION public.forums_maintain_post_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.forum_id IS NOT NULL AND NEW.action IN (1, 3) AND NEW.deleted_at IS NULL THEN
      UPDATE public.forums SET post_count = post_count + 1 WHERE id = NEW.forum_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.forum_id IS NOT NULL AND NEW.action IN (1, 3) THEN
      IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
        UPDATE public.forums SET post_count = GREATEST(post_count - 1, 0) WHERE id = NEW.forum_id;
      ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
        UPDATE public.forums SET post_count = post_count + 1 WHERE id = NEW.forum_id;
      END IF;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.forum_id IS NOT NULL AND OLD.action IN (1, 3) AND OLD.deleted_at IS NULL THEN
      UPDATE public.forums SET post_count = GREATEST(post_count - 1, 0) WHERE id = OLD.forum_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS feed_posts_forum_count ON public.feed_posts;
CREATE TRIGGER feed_posts_forum_count
  AFTER INSERT OR DELETE OR UPDATE OF deleted_at ON public.feed_posts
  FOR EACH ROW EXECUTE FUNCTION public.forums_maintain_post_count();
