-- One-off backfill: fix inflated feed_posts.amount_sats.
--
-- matchFeedTx used to record `sats = authorSats + platformSats` (a SUM of the
-- tx's outputs to the payee). When the payer replies to / likes their OWN post,
-- the tx's change output returns to that same address, so the sum folded the
-- change into the recorded amount — e.g. a 100 XEC reply stored as 4,256 XEC,
-- which the "Live on eCash" rail then displayed. The code now records the
-- intended price/split instead; this corrects the rows written before that.
--
-- The correct amount for a post/reply/quote is its price: 1 XEC per character,
-- 100 XEC floor (== the feed's priceFeedPost), in sats. Mint cards
-- (card_kind = 'handle_mint', amount_sats = 0 by design) are excluded. This is a
-- no-op for rows already recorded correctly. Safe to re-run.
--
-- Note: char_length counts Unicode codepoints, matching priceFeedPost's
-- [...content].length closely enough for a display amount.

UPDATE public.feed_posts
SET amount_sats = GREATEST(100, char_length(content)) * 100
WHERE action IN (1, 2, 3)          -- post / reply / quote
  AND card_kind IS NULL            -- never touch mint cards (amount_sats = 0)
  AND content IS NOT NULL
  AND amount_sats <> GREATEST(100, char_length(content)) * 100;
