-- The notifications page needs to show the FULL TEXT of a reply/comment inline
-- (X-style), not just "so-and-so replied to your post". post_txid on a 'reply'
-- row is the TARGET being replied to (for the link), not the reply's own txid —
-- there was never a column for "which specific row is this action". Add one:
--   reply    -> action_txid = the reply's OWN feed_posts.txid
--   comment  -> action_txid = the comment's OWN comments.txid
--   quote    -> unused (post_txid already IS the quote's own txid — no change)
-- Nullable: older rows and types that don't need it (like/repost/follow/offer/
-- unlock/comment_like) leave it null.
--
-- Also folds in 'comment_like' to the type CHECK constraint — it's been a live
-- type in lib/feedNotifications.js (ARTICLE_NOTIF_TYPES) since
-- feed_notifications_article_types.sql shipped, but that migration's CHECK
-- constraint only ever listed 'unlock' and 'comment'. If the live DB constraint
-- was never separately patched via the dashboard, every comment_like insert has
-- been silently failing (recordFeedNotification swallows the error). This
-- re-adds the FULL current type list either way — a no-op if it was already
-- fixed, a real fix if it wasn't.
--
-- Idempotent. Apply in the Supabase SQL editor. Safe to re-run.

ALTER TABLE public.feed_notifications
  ADD COLUMN IF NOT EXISTS action_txid text;

ALTER TABLE public.feed_notifications
  DROP CONSTRAINT IF EXISTS feed_notifications_type_chk;
ALTER TABLE public.feed_notifications
  ADD CONSTRAINT feed_notifications_type_chk
  CHECK (type IN (
    'reply', 'quote', 'like', 'repost', 'follow', 'offer',
    'unlock', 'comment', 'comment_like'
  ));
