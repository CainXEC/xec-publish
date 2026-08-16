-- =============================================================================
--  handle_offer_listed_notify — notify a bidder when the handle they offered on
--  gets listed on Agora AT their offered price.
--
--  We can't trust the "List at N" button click (it only opens Cashtab; the
--  holder may cancel or change the number). Instead the marketplace reconciles
--  live Agora listings against open offers on every read: when a handle is now
--  listed at a price that exactly matches an open bid, the bidder gets one
--  'offer_listed' bell. `listed_notified_sats` records the price we last told a
--  given bidder about, so we notify once per (offer, price) — not on every
--  gallery load, and again only if the listing price later changes to re-match.
--
--  Apply in the Supabase SQL editor. Safe to re-run.
-- =============================================================================

ALTER TABLE public.handle_offers
  ADD COLUMN IF NOT EXISTS listed_notified_sats bigint;

-- Register the new notification type (bell: "@holder listed @handle at your
-- offer of N XEC"). post_txid carries the handle's token id, like 'offer'.
ALTER TABLE public.feed_notifications
  DROP CONSTRAINT IF EXISTS feed_notifications_type_chk;
ALTER TABLE public.feed_notifications
  ADD CONSTRAINT feed_notifications_type_chk
  CHECK (type IN ('reply', 'quote', 'like', 'repost', 'follow', 'offer',
                  'offer_listed', 'tip', 'mention',
                  'unlock', 'comment', 'comment_like'));
