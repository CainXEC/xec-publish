-- =============================================================================
--  pow_rewards_scoring.sql  —  Phase 1 of the Contribution-Score airdrop
--  Extends pow_rewards.sql (apply that first). See docs/pow-token-migration-plan.md.
--
--  Adds:
--    • pow_reward_config — one live, DB-editable parameter set (pool, weights,
--      points, curve, cap…) so tuning needs no code deploy.
--    • per-component snapshot columns on epochs + claims, so every finalized week
--      records WHY each account got what (transparency / audit, never re-derived).
--
--  RLS enabled, NO policies — service-role only. Safe to re-run.
-- =============================================================================

create table if not exists public.pow_reward_config (
  id          text primary key default 'active',
  config      jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table public.pow_reward_config enable row level security;

-- Seed the initial production parameters (§27) only if not already present.
insert into public.pow_reward_config (id, config) values ('active', '{
  "weeklyPoolAtoms": 1000,
  "weights": { "economic": 0.35, "creation": 0.35, "engagement": 0.30 },
  "economicCurve": "sqrt",
  "creationPoints": { "article": 100, "feedPost": 10, "reply": 5, "repost": 5, "quote": 15 },
  "creationCategoryCap": 500,
  "engagementPoints": { "unlock": 10, "reply": 3, "quote": 4, "repost": 2, "reaction": 1 },
  "repeatDecay": [1.0, 0.5, 0.25, 0.1],
  "maxUserShare": 0.10,
  "loyaltyMultMax": 1.20
}'::jsonb)
on conflict (id) do nothing;

-- Epoch: snapshot the config used + the component denominators.
alter table public.pow_reward_epochs add column if not exists config jsonb;
alter table public.pow_reward_epochs add column if not exists total_economic numeric;
alter table public.pow_reward_epochs add column if not exists total_creation numeric;
alter table public.pow_reward_epochs add column if not exists total_engagement numeric;
alter table public.pow_reward_epochs add column if not exists total_contribution numeric;

-- Claim: per-account score breakdown + underlying activity (for transparency §25).
alter table public.pow_reward_claims add column if not exists economic_score numeric;
alter table public.pow_reward_claims add column if not exists creation_score numeric;
alter table public.pow_reward_claims add column if not exists engagement_score numeric;
alter table public.pow_reward_claims add column if not exists loyalty_mult numeric not null default 1.0;
alter table public.pow_reward_claims add column if not exists contribution_score numeric;
alter table public.pow_reward_claims add column if not exists capped boolean not null default false;
alter table public.pow_reward_claims add column if not exists activity jsonb;
