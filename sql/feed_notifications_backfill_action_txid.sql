-- One-time backfill of feed_notifications.action_txid for reply/comment rows
-- created BEFORE the column existed (feed_notifications_action_txid.sql). Without
-- this, the notifications page can't find those rows' own text and falls back to
-- the plain verb line ("replied to your post") with no inline body.
--
-- A notification doesn't store which specific reply/comment it was for, so we
-- match on the identifying tuple and break ties by closest timestamp:
--   reply   -> the actor's REPLY (action 2) whose parent_txid = the target post
--   comment -> the actor's comment on the same article
-- The match is a DISPLAY pointer only (never touches payments), and the
-- closest-time tiebreak makes a wrong pick possible only when the same actor
-- replied/commented on the same target more than once near the same moment —
-- in which case it still shows that actor's own words, just possibly the wrong one.
--
-- Idempotent: only fills rows still NULL, so re-running is safe and a no-op once done.
-- Apply in the Supabase SQL editor. Requires feed_notifications_action_txid.sql first.

-- Replies (feed_posts) ------------------------------------------------------
UPDATE public.feed_notifications n
SET action_txid = (
  SELECT fp.txid
  FROM public.feed_posts fp
  WHERE fp.action = 2
    AND fp.parent_txid = n.post_txid
    AND fp.author_account_id = n.actor_account_id
  ORDER BY abs(extract(epoch FROM (fp.created_at - n.created_at)))
  LIMIT 1
)
WHERE n.type = 'reply'
  AND n.action_txid IS NULL
  AND EXISTS (
    SELECT 1 FROM public.feed_posts fp
    WHERE fp.action = 2
      AND fp.parent_txid = n.post_txid
      AND fp.author_account_id = n.actor_account_id
  );

-- Comments (comments; post_txid holds the article's post id) -----------------
UPDATE public.feed_notifications n
SET action_txid = (
  SELECT c.txid
  FROM public.comments c
  WHERE c.post_id::text = n.post_txid
    AND c.author_account_id = n.actor_account_id
  ORDER BY abs(extract(epoch FROM (c.created_at - n.created_at)))
  LIMIT 1
)
WHERE n.type = 'comment'
  AND n.action_txid IS NULL
  AND EXISTS (
    SELECT 1 FROM public.comments c
    WHERE c.post_id::text = n.post_txid
      AND c.author_account_id = n.actor_account_id
  );
