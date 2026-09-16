-- =============================================================================
--  pow_rewards.sql  —  weekly POW gratitude rewards
--  See docs/pow-token-migration-plan.md §5.
--
--  A fixed weekly POW pool is split pro-rata by how much XEC the PLATFORM ADDRESS
--  received from each account that ISO week (unlocks/posts/reactions/comments/
--  forum fees + mint revenue; 👎 downvotes and profile tips excluded; the founder,
--  is_ai house accounts, and alt-clusters excluded). POW is 0-decimal, so every
--  atom count here is a WHOLE POW token.
--
--  Two tables, mirroring the mint pipeline's idempotent deliver+reconcile shape:
--    pow_reward_epochs  — one row per ISO week (the pool + the tally denominator)
--    pow_reward_claims  — one row per (week, account); compare-and-set on send_txid
--                         so a crash or retry can NEVER double-pay real tokens.
--
--  RLS enabled, NO policies — service-role only (repo convention, see CLAUDE.md).
--  Never grant to anon/authenticated. Safe to re-run.
-- =============================================================================

create table if not exists public.pow_reward_epochs (
  iso_week         text primary key,            -- ISO year+week, e.g. '2026-W37'
  week_start       timestamptz not null,        -- inclusive UTC start
  week_end         timestamptz not null,        -- exclusive UTC end
  pool_atoms       bigint not null,             -- this week's POW budget (whole tokens)
  carryover_atoms  bigint not null default 0,   -- rolled-in from prior weeks:
                                                --   flooring remainder + sub-1-POW shares
  total_fee_sats   bigint,                      -- denominator: eligible platform-received sats
  status           text not null default 'open',
    -- open -> tallied -> paying -> done ; or 'failed'
  computed_at      timestamptz,                 -- when the tally was frozen
  note             text,                        -- free-form ops note (e.g. failure reason)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.pow_reward_claims (
  id                bigint generated always as identity primary key,
  iso_week          text not null references public.pow_reward_epochs(iso_week),
  account_id        uuid not null,
  fee_sats          bigint not null,            -- account's eligible platform-received sats (the weight)
  allocation_atoms  bigint not null,            -- floored whole-POW award; a sub-1 share is never inserted
  to_address        text not null,              -- account primary address, snapshotted at tally time
  send_txid         text,                       -- set once broadcast — the double-pay guard
  status            text not null default 'pending',
    -- pending -> sent ; or 'failed'
  error             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Idempotency anchor: at most one claim per account per week. A re-run of the
  -- tally is an upsert on this key, never a second row.
  unique (iso_week, account_id)
);

create index if not exists pow_reward_claims_week_idx
  on public.pow_reward_claims (iso_week);
-- Partial index for the reconciler: the rows still owed a send.
create index if not exists pow_reward_claims_unpaid_idx
  on public.pow_reward_claims (iso_week) where status <> 'sent';

alter table public.pow_reward_epochs enable row level security;
alter table public.pow_reward_claims enable row level security;
-- Intentionally NO policies: every read/write goes through the service role
-- (lib/db.ts adminDb). Granting any policy to public/anon/authenticated would
-- expose reward accounting to the world — see CLAUDE.md.
