-- Extend the unified notification store with the two article-side event types:
--   unlock  -> "@x unlocked <Your Article>"     (fired when a reader pays to unlock)
--   comment -> "@x commented on <Your Article>" (fired on a new article comment)
--
-- Recipient = the article's author account; post_txid carries the article's
-- POST ID (not a chain txid), which the bell resolves to a /posts/<slug> link at
-- read time. See lib/feedNotifications.js (recordArticleNotification) and the
-- unlock/comment routes.
--
-- Idempotent: drops and re-adds the type CHECK with the full current set. Apply
-- in the Supabase SQL editor. Safe to re-run.

ALTER TABLE public.feed_notifications
  DROP CONSTRAINT IF EXISTS feed_notifications_type_chk;
ALTER TABLE public.feed_notifications
  ADD CONSTRAINT feed_notifications_type_chk
  CHECK (type IN ('reply', 'quote', 'like', 'repost', 'follow', 'offer', 'unlock', 'comment'));
