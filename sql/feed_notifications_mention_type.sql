-- Add the 'mention' notification type: someone @-tagged you in a feed post or an
-- article. post_txid = the feed post's own txid (feed mention, shows the post text
-- inline via action_txid) OR the article's posts.id (article mention, links to the
-- article + shows its title). See lib/feedNotifications.js
-- (recordFeedMentionNotifications / recordArticleMentionNotifications).
--
-- Idempotent: drops and re-adds the type CHECK with the full current set. Apply in
-- the Supabase SQL editor. Safe to re-run. Supersedes the type list in
-- feed_notifications_action_txid.sql.

ALTER TABLE public.feed_notifications
  DROP CONSTRAINT IF EXISTS feed_notifications_type_chk;
ALTER TABLE public.feed_notifications
  ADD CONSTRAINT feed_notifications_type_chk
  CHECK (type IN (
    'reply', 'quote', 'like', 'repost', 'follow', 'offer',
    'unlock', 'comment', 'comment_like', 'mention'
  ));
