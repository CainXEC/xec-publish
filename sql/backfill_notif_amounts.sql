-- Backfill amount_sats on paid notifications recorded before the amount was
-- captured, so the bell can show what the recipient EARNED (net of the 6% fee,
-- computed at read time). amount_sats is a DISPLAY-only field — it never affects
-- payments or entitlements — so a rare mismatch is cosmetic and re-runnable.
--
-- Each notification is matched to its source payment by (actor + target); when an
-- actor acted on the same target more than once, the temporally-closest source
-- row wins (the notification is written immediately after the action). Idempotent:
-- only rows where amount_sats IS NULL are touched. Amounts are stored GROSS, in
-- sats — the display derives the net.

-- Replies → the reply feed_post (action 2 = REPLY) to this parent by this actor.
update public.feed_notifications n
set amount_sats = (
  select p.amount_sats
  from public.feed_posts p
  where p.action = 2
    and p.parent_txid = n.post_txid
    and p.author_account_id = n.actor_account_id
    and p.amount_sats is not null
  order by abs(extract(epoch from (p.created_at - n.created_at)))
  limit 1
)
where n.type = 'reply' and n.amount_sats is null;

-- Reposts → the repost feed_event (action 4 = REPOST) on this target by this
-- actor (one per actor per post, so the match is unique).
update public.feed_notifications n
set amount_sats = (
  select e.amount_sats
  from public.feed_events e
  where e.action = 4
    and e.target_txid = n.post_txid
    and e.actor_account_id = n.actor_account_id
    and e.amount_sats is not null
  order by abs(extract(epoch from (e.created_at - n.created_at)))
  limit 1
)
where n.type = 'repost' and n.amount_sats is null;

-- Comments → the comment on this article (post_txid = article id) by this actor.
-- Covers both top-level (pays the article author) and comment replies (pay the
-- parent commenter); both notify with type 'comment'.
update public.feed_notifications n
set amount_sats = (
  select c.amount_sats
  from public.comments c
  where c.post_id = n.post_txid
    and c.author_account_id = n.actor_account_id
    and c.amount_sats is not null
  order by abs(extract(epoch from (c.created_at - n.created_at)))
  limit 1
)
where n.type = 'comment' and n.amount_sats is null;

-- Unlocks → the article's gross price. post_txid IS the article id, so read
-- posts.price_xec directly (XEC → sats, ×100). This is exactly what the live
-- unlock notification records (verify-payment uses post.price_xec), and it avoids
-- unlocks.amount_xec, which despite its name stores the author's NET in sats.
update public.feed_notifications n
set amount_sats = round(p.price_xec * 100)
from public.posts p
where n.type = 'unlock'
  and n.amount_sats is null
  and p.id = n.post_txid
  and p.price_xec is not null;
