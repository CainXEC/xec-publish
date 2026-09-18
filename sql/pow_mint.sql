-- =============================================================================
--  pow_mint.sql  —  accept POW (the SLP token) as an alternative payment for
--  handle NFT mints. See docs/pow-token-migration-plan.md §3.
--
--  An SLP token send can't carry the mintId OP_RETURN tag the XEC path matches
--  on, so a POW mint is matched by SENDER ∈ the account's proven addresses. These
--  columns record that on the pending_mints row. Safe to re-run.
-- =============================================================================

-- 'xec' (default, unchanged behavior) or 'pow'.
alter table public.pending_mints add column if not exists pay_token text not null default 'xec';
-- Required POW amount (atoms; POW is 0-decimal) when pay_token='pow'.
alter table public.pending_mints add column if not exists expected_atoms bigint;
-- The minting account's proven addresses at intent time — a POW send from any of
-- these matches this intent (text[] of ecash: addresses).
alter table public.pending_mints add column if not exists expected_payers text[];
