-- Minimal clone of the production tables sql/search.sql touches, for the
-- hermetic scratch-Postgres test (tests/integration/searchDb.test.js).
-- Only the columns the search migration references exist here — if the
-- migration ever grows a reference to a column this file lacks, the test
-- fails loudly at apply time, which is the point.

CREATE TABLE public.posts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id            uuid,
  title                text,
  slug                 text,
  teaser               text,
  body                 text,
  price_xec            numeric DEFAULT 100,
  published            boolean DEFAULT false,
  legacy               boolean DEFAULT false,
  publish_paid         boolean DEFAULT false,
  pinned               boolean DEFAULT false,
  reading_time_minutes integer,
  created_at           timestamptz NOT NULL DEFAULT now(),
  published_at         timestamptz
);

CREATE TABLE public.feed_posts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txid              text NOT NULL UNIQUE,
  action            smallint NOT NULL DEFAULT 1,
  content           text NOT NULL,
  author_account_id uuid,
  author_identity   text NOT NULL DEFAULT 'ecash:qtestaddress',
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

CREATE TABLE public.accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id      uuid,
  display_handle text,
  handle_color   text
);
