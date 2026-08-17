-- =============================================================================
--  feed_emoji_reactions — turn the single ♥ like into an 8-emoji reaction set.
--
--  Each reaction is still an OP_5 "like" payment (feed_events, action=5), now
--  carrying WHICH emoji, and a user may react many times (paying each time). The
--  emoji is display metadata; polarity (author 94/6 vs 👎 → platform 100%) is
--  proven on-chain by the payment split and verified server-side.
--
--  Palette (lib/reactions.js): ❤️ 😂 🔥 👏 💯 👍 👎 🤔
--
--  Apply in the Supabase SQL editor (schema is managed in the dashboard; this
--  file is the source of record). Everything here is idempotent — safe to re-run.
-- =============================================================================

-- 1. Which emoji this reaction is. NULL = a legacy ♥ like → rendered as ❤️.
--    App layer (lib/reactions.js isReaction) is the real gate, so we only guard
--    against junk here rather than pin the exact multibyte emoji set in a CHECK.
ALTER TABLE public.feed_events ADD COLUMN IF NOT EXISTS emoji text;
ALTER TABLE public.feed_events DROP CONSTRAINT IF EXISTS feed_events_emoji_len_chk;
ALTER TABLE public.feed_events
  ADD CONSTRAINT feed_events_emoji_len_chk
  CHECK (emoji IS NULL OR char_length(emoji) BETWEEN 1 AND 8);

-- 2. Multi-react: drop the one-like-per-wallet uniqueness for LIKES, but keep
--    reposts one-per-wallet. Replace UNIQUE(action,target_txid,payer_address)
--    with a PARTIAL unique index scoped to reposts (action=4). txid stays UNIQUE
--    (idempotency), so a given reaction tx is still recorded at most once.
DO $$
DECLARE c text;
BEGIN
  -- Drop whatever unique constraint currently covers (action,target,payer).
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.feed_events'::regclass AND contype = 'u'
      AND conkey @> (
        SELECT array_agg(attnum) FROM pg_attribute
        WHERE attrelid = 'public.feed_events'::regclass
          AND attname IN ('action','target_txid','payer_address'))
  LOOP
    EXECUTE format('ALTER TABLE public.feed_events DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS feed_events_repost_once
  ON public.feed_events (target_txid, payer_address)
  WHERE action = 4;

-- 3. Per-emoji counts on the post, alongside the existing like_count total.
ALTER TABLE public.feed_posts
  ADD COLUMN IF NOT EXISTS reaction_counts jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Extend the reaction-counter trigger (was: sql/feed_reaction_counts.sql) so an
-- action=5 INSERT/DELETE also bumps reaction_counts[emoji] (NULL emoji → ❤️).
-- Reposts (action=4) are unchanged.
CREATE OR REPLACE FUNCTION public.feed_events_maintain_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE k text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.action = 5 THEN
      k := COALESCE(NEW.emoji, '❤️');
      UPDATE public.feed_posts SET
        like_count = like_count + 1,
        reaction_counts = jsonb_set(
          reaction_counts, ARRAY[k],
          to_jsonb(COALESCE((reaction_counts ->> k)::int, 0) + 1))
      WHERE txid = NEW.target_txid;
    ELSIF NEW.action = 4 THEN
      UPDATE public.feed_posts SET repost_count = repost_count + 1 WHERE txid = NEW.target_txid;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.action = 5 THEN
      k := COALESCE(OLD.emoji, '❤️');
      UPDATE public.feed_posts SET
        like_count = GREATEST(like_count - 1, 0),
        reaction_counts = jsonb_set(
          reaction_counts, ARRAY[k],
          to_jsonb(GREATEST(COALESCE((reaction_counts ->> k)::int, 0) - 1, 0)))
      WHERE txid = OLD.target_txid;
    ELSIF OLD.action = 4 THEN
      UPDATE public.feed_posts SET repost_count = GREATEST(repost_count - 1, 0) WHERE txid = OLD.target_txid;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- 4. Backfill reaction_counts from current rows (idempotent). Legacy null emoji
--    folds into ❤️, so existing likes appear as ❤️ counts.
UPDATE public.feed_posts p SET reaction_counts = COALESCE((
  SELECT jsonb_object_agg(k, c) FROM (
    SELECT COALESCE(e.emoji, '❤️') AS k, COUNT(*) AS c
    FROM public.feed_events e
    WHERE e.action = 5 AND e.target_txid = p.txid
    GROUP BY COALESCE(e.emoji, '❤️')
  ) s
), '{}'::jsonb);

-- 5. Notification bell: which emoji a reaction was, so it can read "reacted 🔥".
ALTER TABLE public.feed_notifications ADD COLUMN IF NOT EXISTS emoji text;
