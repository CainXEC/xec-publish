-- =============================================================================
--  feed_notifications: add the 'forum_fee' type.
--
--  A forum RUNNER earns the 6% engagement fee on replies + positive reactions to
--  posts in their forum, but until now that arrived silently. This notification
--  surfaces it: "You earned N XEC — someone reacted/replied in /f/<forum>."
--  amount_sats = the 6% earned; post_txid = the engaged post; emoji set for a
--  reaction.
--
--  Re-adds the type CHECK with the FULL current set (the dashboard-managed
--  constraint has drifted ahead of individual sql/ files, so we list them all)
--  plus 'forum_fee'. Idempotent. Apply in the Supabase SQL editor.
-- =============================================================================

ALTER TABLE public.feed_notifications
  DROP CONSTRAINT IF EXISTS feed_notifications_type_chk;
ALTER TABLE public.feed_notifications
  ADD CONSTRAINT feed_notifications_type_chk
  CHECK (type IN (
    'reply', 'quote', 'like', 'repost', 'follow', 'offer', 'offer_listed',
    'tip', 'mention', 'unlock', 'comment', 'comment_like', 'forum_fee'
  ));
