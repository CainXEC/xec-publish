-- New-user welcome faucet: 1,000 XEC + 10 POW for a brand-new account whose
-- wallet was funded by Cashtab's captcha-gated 42 XEC new-wallet faucet.
-- Apply in the Supabase SQL editor BEFORE enabling the faucet. Safe to re-run.
--
-- One row per claim. status:
--   pending — slot reserved, send in progress
--   sent    — broadcast succeeded (txid set)
--   failed  — definitely NOT sent (build error / node rejected) — frees the slot,
--             doesn't count toward the daily cap, and allows a retry
--   unknown — broadcast outcome ambiguous (network error mid-send). Counts toward
--             the cap and blocks a re-claim (never risk a double-pay); resolve by
--             hand after checking the patron wallet's tx history.

create table if not exists public.faucet_claims (
  id          bigserial primary key,
  account_id  uuid not null references public.accounts(id),
  cluster_id  uuid not null,              -- effective (alt-collapsed) account
  to_address  text not null,              -- where the gift was sent (primary address)
  xec_sats    bigint not null,
  pow_atoms   bigint not null,
  status      text not null default 'pending',
  txid        text,
  error       text,
  ip          text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One live claim per account, per alt-cluster, and per receiving address.
-- Partial (status <> 'failed') so a definitely-failed attempt can be retried.
create unique index if not exists faucet_claims_account_live
  on public.faucet_claims (account_id) where status <> 'failed';
create unique index if not exists faucet_claims_cluster_live
  on public.faucet_claims (cluster_id) where status <> 'failed';
create unique index if not exists faucet_claims_address_live
  on public.faucet_claims (to_address) where status <> 'failed';
create index if not exists faucet_claims_created_idx
  on public.faucet_claims (created_at);

-- Service-role only (this repo's rule): RLS on, no policies, no anon/auth grants.
alter table public.faucet_claims enable row level security;
revoke all on public.faucet_claims from anon, authenticated;

-- Atomically reserve one claim slot: dedupe (account / cluster / address) and
-- enforce the UTC-day caps under a transaction-scoped advisory lock, so two
-- simultaneous claims can't both slip past the cap. Returns
-- {ok:true,id} | {ok:false,reason:'already_claimed'|'capped'}.
create or replace function public.faucet_reserve_slot(
  p_account_id          uuid,
  p_cluster_id          uuid,
  p_to_address          text,
  p_xec_sats            bigint,
  p_pow_atoms           bigint,
  p_daily_xec_cap_sats  bigint,
  p_daily_pow_cap_atoms bigint,
  p_ip                  text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_xec bigint;
  v_pow bigint;
  v_id  bigint;
begin
  perform pg_advisory_xact_lock(hashtext('faucet_reserve_slot'));

  if exists (
    select 1 from faucet_claims
     where status <> 'failed'
       and (account_id = p_account_id or cluster_id = p_cluster_id or to_address = p_to_address)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed');
  end if;

  select coalesce(sum(xec_sats), 0), coalesce(sum(pow_atoms), 0)
    into v_xec, v_pow
    from faucet_claims
   where status <> 'failed' and created_at >= v_day_start;

  if v_xec + p_xec_sats > p_daily_xec_cap_sats
     or v_pow + p_pow_atoms > p_daily_pow_cap_atoms then
    return jsonb_build_object('ok', false, 'reason', 'capped');
  end if;

  insert into faucet_claims (account_id, cluster_id, to_address, xec_sats, pow_atoms, ip)
  values (p_account_id, p_cluster_id, p_to_address, p_xec_sats, p_pow_atoms, p_ip)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.faucet_reserve_slot(uuid, uuid, text, bigint, bigint, bigint, bigint, text)
  from public, anon, authenticated;
