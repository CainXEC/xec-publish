-- =============================================================================
--  mint_payment_alerts.sql  —  payments to the mint wallet that no order claimed
--  See lib/mintPaymentAlerts.ts.
--
--  Every mint-matching gap so far failed the same SILENT way: the buyer's money
--  sat at the mint wallet, no NFT, no refund, and nobody knew until someone
--  looked by hand. The 5-minute cron now records any final, purchase-sized
--  payment (any POW, or >= 1,000 XEC) that no pending_mints row has claimed 30+
--  minutes after it was first seen. A row stays open (and counts in the admin
--  bell) until an order claims the payment (auto-resolved 'claimed') or an admin
--  dismisses it on /admin/mints with a written note ('dismissed').
--
--  Report-only: nothing reads this to deliver or refund.
--  RLS enabled, NO policies — service-role only (repo convention, see CLAUDE.md).
--  Never grant to anon/authenticated. Safe to re-run.
-- =============================================================================

create table if not exists public.mint_payment_alerts (
  txid           text primary key,             -- the payment tx (one alert per payment, ever)
  sats           bigint not null default 0,    -- XEC sats paid to the mint address
  pow_atoms      bigint not null default 0,    -- POW atoms paid to the mint address
  payer_address  text,                         -- first input's address
  mint_id        uuid,                         -- the mintId tag in its OP_RETURN, if any
  seen_at        timestamptz,                  -- Chronik first-seen (else block) time
  flagged_at     timestamptz not null default now(),
  resolved_at    timestamptz,                  -- null = open (counts in the bell)
  resolution     text check (resolution in ('claimed', 'dismissed')),
  note           text                          -- the admin's reason, on dismiss
);

create index if not exists mint_payment_alerts_open_idx
  on public.mint_payment_alerts (flagged_at) where resolved_at is null;

alter table public.mint_payment_alerts enable row level security;
revoke all on public.mint_payment_alerts from anon, authenticated;
