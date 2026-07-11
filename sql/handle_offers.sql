-- =============================================================================
--  handle_offers — collector interest / named-price offers on minted handles.
--
--  v1 of the marketplace offer system: login-gated (a session already costs a
--  5.5 XEC challenge payment, which is the anti-spam floor), amounts PRIVATE
--  (only the current holder ever sees them; the public sees only a count).
--  One live offer per (handle, bidder): re-offering upserts the same row.
--
--  status: 'open' (live) | 'withdrawn' (bidder pulled it; row kept so the
--  unique key survives and a later re-offer just flips it back to open).
--
--  The holder is NOT a column — holdership is on-chain and changes hands with
--  the NFT. Every read resolves the current holder live (Chronik, with the
--  accounts.active_handle_token_id binding as fallback), so offers automatically
--  follow the token to a new owner.
--
--  Apply in the Supabase SQL editor (schema is managed in the dashboard; this
--  file is the source of record). Safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.handle_offers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id          text NOT NULL,
  handle            text NOT NULL,                 -- display snapshot at offer time
  bidder_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  amount_sats       bigint,                        -- NULL = interested, no price named
  status            text NOT NULL DEFAULT 'open',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT handle_offers_status_chk CHECK (status IN ('open', 'withdrawn')),
  CONSTRAINT handle_offers_amount_chk CHECK (amount_sats IS NULL OR amount_sats >= 100),
  CONSTRAINT handle_offers_one_per_bidder UNIQUE (token_id, bidder_account_id)
);

-- Deny-by-default: service-role only, like every other table (no policies).
ALTER TABLE public.handle_offers ENABLE ROW LEVEL SECURITY;

-- The two hot reads: open offers for one token (holder view + public count),
-- and a bidder's own offers.
CREATE INDEX IF NOT EXISTS handle_offers_token_idx
  ON public.handle_offers (token_id, status);
CREATE INDEX IF NOT EXISTS handle_offers_bidder_idx
  ON public.handle_offers (bidder_account_id, status);

-- ---------------------------------------------------------------------------
--  feed_notifications: allow the new 'offer' type (bell: "@x made an offer on
--  @yourhandle"). post_txid carries the handle's token id for offer rows.
-- ---------------------------------------------------------------------------
ALTER TABLE public.feed_notifications
  DROP CONSTRAINT IF EXISTS feed_notifications_type_chk;
ALTER TABLE public.feed_notifications
  ADD CONSTRAINT feed_notifications_type_chk
  CHECK (type IN ('reply', 'quote', 'like', 'repost', 'follow', 'offer'));
