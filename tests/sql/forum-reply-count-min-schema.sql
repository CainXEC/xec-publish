-- Minimal clone of the tables sql/feed_reaction_counts.sql and
-- sql/forum_deep_reply_count.sql touch, for the hermetic scratch-Postgres test
-- (tests/integration/forumReplyCountDb.test.js). The real migration order is
-- reproduced: this schema is what feed_reaction_counts.sql expects to find
-- (feed_posts + feed_events, no count columns yet — it adds those itself),
-- plus forum_id, which predates it in production (sql/forums.sql).

CREATE TABLE public.feed_posts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txid        text NOT NULL UNIQUE,
  action      smallint NOT NULL DEFAULT 1,
  parent_txid text,
  quoted_txid text,
  forum_id    uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE TABLE public.feed_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txid             text NOT NULL UNIQUE,
  action           smallint NOT NULL,
  target_txid      text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
