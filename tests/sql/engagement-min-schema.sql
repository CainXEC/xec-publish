-- Minimal clone of the production tables that sql/feed_engagement_signal.sql,
-- sql/rpc_get_unlock_counts.sql and sql/rpc_get_unlock_earnings.sql touch, for
-- the hermetic scratch-Postgres test (tests/integration/feedEngagementSignalDb.test.js).
-- Only the columns those RPCs reference exist here — if an RPC grows a reference
-- to a column this file lacks, the test fails loudly at apply time, by design.

CREATE TABLE public.authors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  xec_address text,
  is_ai       boolean NOT NULL DEFAULT false
);

CREATE TABLE public.accounts (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid
);

CREATE TABLE public.account_addresses (
  account_id uuid NOT NULL,
  address    text NOT NULL,
  is_primary boolean DEFAULT false
);

CREATE TABLE public.account_links (
  account_id uuid PRIMARY KEY,
  cluster_id uuid NOT NULL
);

CREATE TABLE public.feed_posts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txid              text NOT NULL UNIQUE,
  action            smallint NOT NULL DEFAULT 1,
  parent_txid       text,
  quoted_txid       text,
  author_account_id uuid,
  amount_sats       bigint NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

CREATE TABLE public.feed_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txid             text NOT NULL UNIQUE,
  action           smallint NOT NULL,
  target_txid      text NOT NULL,
  actor_account_id uuid,
  amount_sats      bigint NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.unlocks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       uuid NOT NULL,
  txid          text UNIQUE,
  payer_address text,
  amount_xec    numeric,
  unlocked_at   timestamptz NOT NULL DEFAULT now()
);
