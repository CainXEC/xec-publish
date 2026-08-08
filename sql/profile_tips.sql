-- Direct author tips — a tip sent to an AUTHOR from their profile page (the "Tip"
-- button next to Follow). Unlike a feed like (feed_events, which likes a POST and
-- splits 94/6), a profile tip targets the PERSON, pays 100% to the author (NO
-- platform fee), carries no post txid, and is REPEATABLE — a fan can tip the same
-- author as many times as they like. So it gets its own table rather than folding
-- into feed_events (no target post, no per-wallet dedupe, different split).
--
-- On chain: a single non-change output to the author's payout address carrying the
-- bare TIP marker (FEED_ACTION.TIP = OP_13, lib/feedProtocol.js). Detected by
-- scanning the author's payout address history (there is no platform leg to scan).
--
-- Apply in the Supabase SQL editor (schema is managed in the dashboard; this file
-- is the source of record). FKs depend on public.accounts(id).
--
-- Identity is STAMPED at write time (from_identity), matching feed_events: the
-- tipper's byline is frozen to who they were when they paid.

CREATE TABLE IF NOT EXISTS public.feed_tips (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txid             text NOT NULL UNIQUE,            -- the on-chain tip tx (idempotency key)
  from_account_id  uuid REFERENCES public.accounts(id),
  from_identity    text NOT NULL,                   -- snapshot: tipper "@handle" or raw ecash address
  to_account_id    uuid NOT NULL REFERENCES public.accounts(id), -- the tipped author
  payout_address   text NOT NULL,                   -- snapshot: where the 100% tip landed
  payer_address    text NOT NULL,                   -- proven payer (tx.inputs[0])
  amount_sats      bigint NOT NULL,                 -- total tipped (100% to the author)
  created_at       timestamptz NOT NULL DEFAULT now(),
  finalized_at     timestamptz                      -- Avalanche-final stamp (NULL = provisional)
);

-- Sweep lookup: provisional (not-yet-final) rows the reconcile job re-checks.
-- Tips are recorded at 0-conf the moment payment is SEEN; finalized_at stays NULL
-- until the tx is Avalanche-final (mirrors feed_events / comment_events).
CREATE INDEX IF NOT EXISTS feed_tips_provisional_idx
  ON public.feed_tips (created_at)
  WHERE finalized_at IS NULL;

-- Tips received by an author (profile "tips received" / activity), newest first.
CREATE INDEX IF NOT EXISTS feed_tips_to_idx
  ON public.feed_tips (to_account_id, created_at DESC);

-- Tips a given account has sent.
CREATE INDEX IF NOT EXISTS feed_tips_from_idx
  ON public.feed_tips (from_account_id, created_at DESC);

-- Deny-by-default: the app only touches this via the service-role key (bypasses
-- RLS). Enabling RLS with NO policies locks out direct anon/authenticated access
-- without affecting server writes. Safe to re-run.
ALTER TABLE public.feed_tips ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders (matches the 2026-07-27 audit): strip any table grants the
-- browser-facing roles may hold. Server reads/writes go through service_role,
-- which bypasses both grants and RLS.
REVOKE ALL ON public.feed_tips FROM anon, authenticated;
