-- =============================================================================
--  comment_emoji_reactions — give article comments the same 8-emoji reaction set
--  as feed posts, replacing the single ♥ like / tip.
--
--  Each reaction is still an OP_5 "like" payment (comment_events, action=5), now
--  carrying WHICH emoji, and a user may react many times (paying each time). The
--  emoji is display metadata; polarity (author 94/6 vs 👎 → platform 100%) is
--  proven on-chain by the payment split and verified server-side. Counts are
--  computed LIVE from the rows (grouped by emoji) — no denorm column/trigger.
--
--  Palette (lib/reactions.js): ❤️ 😂 🔥 🙏 💯 👍 👎 🤔
--
--  Apply in the Supabase SQL editor. Everything here is idempotent.
-- =============================================================================

-- 1. Which emoji this reaction is. NULL = a legacy ♥ like → rendered as ❤️.
ALTER TABLE public.comment_events ADD COLUMN IF NOT EXISTS emoji text;
ALTER TABLE public.comment_events DROP CONSTRAINT IF EXISTS comment_events_emoji_len_chk;
ALTER TABLE public.comment_events
  ADD CONSTRAINT comment_events_emoji_len_chk
  CHECK (emoji IS NULL OR char_length(emoji) BETWEEN 1 AND 8);

-- 2. Multi-react: drop the one-like-per-wallet uniqueness (UNIQUE(action,
--    target_txid, payer_address)) so a wallet can react as many times as it
--    pays. Comments have no reposts, so nothing replaces it. txid stays UNIQUE
--    (idempotency), so a given reaction tx is still recorded at most once.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.comment_events'::regclass AND contype = 'u'
      AND conkey @> (
        SELECT array_agg(attnum) FROM pg_attribute
        WHERE attrelid = 'public.comment_events'::regclass
          AND attname IN ('action','target_txid','payer_address'))
  LOOP
    EXECUTE format('ALTER TABLE public.comment_events DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
