-- =============================================================================
--  The Pocket — schema + link RPC.
--
--  A pocket is a second, low-value address per account whose PRIVATE KEY lives
--  only in the owner's browser (derived client-side from a Cashtab signature
--  over a fixed sentence — see lib/pocket/derive.js). The server never sees key
--  material; it only records WHICH address is an account's pocket so that:
--    1. payments signed by the pocket attribute to the SAME account
--       (payerOf(tx) → resolveOrCreateAccount finds the account_addresses link),
--    2. the pocket can NEVER escalate: kind='pocket' rows are rejected by login
--       (verifyAuth) and by address-change (change_primary_address v3), so a
--       stolen pocket key is capped at "spend the pocket change", never
--       "own the account",
--    3. a re-derived key can be checked against the registered pubkey — a
--       mismatch means the wrong wallet signed (or ecash-lib's deterministic
--       signMsg changed) and the client freezes instead of silently minting a
--       new pocket.
--
--  RUN ORDER: run THIS file first (it adds account_addresses.kind, which the
--  v3 guards reference), then RE-RUN sql/change_primary_address.sql (v3).
--
--  Conventions: RLS enabled with zero policies (service-role only); RPC is
--  SECURITY DEFINER + pinned search_path, execute granted to service_role only.
-- =============================================================================

-- ---------------------------------------------------------------------------
--  1) account_addresses.kind — 'wallet' (default, a real user wallet) or
--     'pocket' (a browser-held spending key). The marker is PERMANENT per
--     address: a rotated-away pocket keeps kind='pocket' forever so it can
--     never be logged into or promoted later, and its payment history keeps
--     resolving to the account.
-- ---------------------------------------------------------------------------
alter table account_addresses
  add column if not exists kind text not null default 'wallet';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'account_addresses_kind_check'
  ) then
    alter table account_addresses
      add constraint account_addresses_kind_check check (kind in ('wallet', 'pocket'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
--  2) pocket_wallets — the CURRENT pocket per account (one each). Old pockets
--     survive only as kind='pocket' account_addresses rows. `pubkey` (33-byte
--     compressed, hex) is what a restoring client compares its re-derived key
--     against; `delegate_txid` is the first funding tx that carried the
--     on-chain DELEGATE commitment (public provenance, best-effort).
-- ---------------------------------------------------------------------------
create table if not exists pocket_wallets (
  account_id    uuid primary key references accounts(id) on delete cascade,
  address       text not null unique,
  pubkey        text not null,
  delegate_txid text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table pocket_wallets enable row level security;
-- No policies: service-role only, like every table in this app.

-- ---------------------------------------------------------------------------
--  3) link_pocket_address(p_account_id, p_address, p_pubkey, p_replace)
--
--  Registers p_address as the account's pocket in ONE transaction:
--    - rejects the account's own primary (kind-marking it would lock out login),
--    - idempotent when the same pocket is re-registered (device restore),
--    - a DIFFERENT existing pocket requires p_replace=true (the client shows a
--      freeze/replace screen first — never silently rotate), and the old
--      address row STAYS linked with kind='pocket',
--    - absorbs an EMPTY shell account owning the address (a stray pocket spend
--      before registration mints one via resolveOrCreateAccount) using the same
--      activity checks as change_primary_address; a shell with real activity
--      raises 'pocket_has_account', and a shell owning pocket rows of its own
--      is never absorbed ('address_in_use'),
--    - inserts the link as is_primary=false, kind='pocket' and upserts the
--      pocket_wallets registry row.
--
--  The ROUTE (app/api/pocket/register) is the security gate: challenge-scope
--  session + a signMsg proof that the caller holds the pocket key. This
--  function only enforces DB consistency.
-- ---------------------------------------------------------------------------
create or replace function public.link_pocket_address(
  p_account_id uuid,
  p_address text,
  p_pubkey text,
  p_replace boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bare          text;
  v_pref          text;
  v_now           timestamptz := now();
  v_author_id     uuid;
  v_primary_bare  text;
  v_current_addr  text;
  v_owner_id      uuid;
  v_owner_author  uuid;
  v_absorbed      boolean := false;
begin
  v_bare := lower(regexp_replace(trim(p_address), '^ecash:', ''));
  if v_bare is null or v_bare = '' then
    raise exception 'invalid_address';
  end if;
  v_pref := 'ecash:' || v_bare;

  if p_pubkey is null or p_pubkey !~ '^[0-9a-f]{66}$' then
    raise exception 'invalid_pubkey';
  end if;

  -- Lock the caller's account row: serializes concurrent registers/replaces.
  select author_id into v_author_id
    from accounts where id = p_account_id for update;
  if not found then
    raise exception 'account_not_found';
  end if;

  -- Never mark the account's own primary as a pocket — kind='pocket' blocks
  -- login, so this would lock the owner out of their account.
  select lower(replace(address, 'ecash:', '')) into v_primary_bare
    from account_addresses
   where account_id = p_account_id and is_primary
   limit 1;
  if v_primary_bare is not null and v_primary_bare = v_bare then
    raise exception 'pocket_is_primary';
  end if;

  -- Existing registry row for this account?
  select address into v_current_addr
    from pocket_wallets where account_id = p_account_id for update;
  if v_current_addr is not null then
    if lower(replace(v_current_addr, 'ecash:', '')) = v_bare then
      -- Same pocket re-registered (restore on a new device): refresh + done.
      update pocket_wallets
         set pubkey = p_pubkey, updated_at = v_now
       where account_id = p_account_id;
      update account_addresses
         set kind = 'pocket'
       where account_id = p_account_id
         and lower(replace(address, 'ecash:', '')) = v_bare
         and is_primary = false;
      return jsonb_build_object('ok', true, 'already', true, 'absorbed', false);
    elsif not p_replace then
      -- A different pocket exists — the client must show the freeze/replace
      -- screen and re-submit with p_replace. Never rotate silently.
      raise exception 'pocket_conflict';
    end if;
    -- p_replace: fall through. The OLD address row stays linked (kind='pocket',
    -- non-primary) so its history keeps resolving here and it can never log in.
  end if;

  -- Does the pocket address already belong to ANOTHER account? A pocket spend
  -- that raced ahead of registration mints an empty shell for it
  -- (resolveOrCreateAccount) — absorb that, exactly like change_primary_address
  -- absorbs a stray-login shell. Real activity blocks; owning pockets blocks.
  select account_id into v_owner_id
    from account_addresses
   where lower(replace(address, 'ecash:', '')) = v_bare
     and account_id <> p_account_id
   limit 1;

  if v_owner_id is not null then
    select author_id into v_owner_author
      from accounts where id = v_owner_id for update;
    if not found then
      v_owner_id := null; -- vanished mid-flight; treat as unclaimed
    elsif exists (select 1 from account_addresses
                   where account_id = v_owner_id and kind = 'pocket')
       or exists (select 1 from pocket_wallets where account_id = v_owner_id)
    then
      -- Never absorb an account that has pockets of its own — that would fold
      -- someone's real account into ours on the strength of a pocket key.
      raise exception 'address_in_use';
    elsif exists (select 1 from feed_posts   where author_account_id   = v_owner_id)
       or exists (select 1 from feed_events  where actor_account_id    = v_owner_id)
       or exists (select 1 from feed_follows where follower_account_id = v_owner_id
                                                or followee_account_id = v_owner_id)
       or (v_owner_author is not null and
           exists (select 1 from posts where author_id = v_owner_author))
    then
      raise exception 'pocket_has_account';
    else
      -- Absorb: re-point every address the shell held (non-primary), then
      -- delete the shell. Same shape as change_primary_address v2.
      update account_addresses
         set account_id = p_account_id, is_primary = false
       where account_id = v_owner_id;
      delete from accounts where id = v_owner_id;
      if v_owner_author is not null then
        delete from authors where id = v_owner_author;
      end if;
      v_absorbed := true;
    end if;
  end if;

  -- A legacy author row on this address (other than the caller's own) would
  -- hijack identity resolution later — block it, mirroring change_primary_address.
  -- (An absorbed shell's author row was deleted just above and no longer trips this.)
  if exists (
    select 1 from authors
     where lower(replace(xec_address, 'ecash:', '')) = v_bare
       and (v_author_id is null or id <> v_author_id)
  ) then
    raise exception 'address_in_use';
  end if;

  -- Link the pocket address to this account: promote an absorbed/pre-existing
  -- row to kind='pocket', or insert fresh. Never touches primary rows.
  update account_addresses
     set kind = 'pocket', is_primary = false, verified_at = v_now
   where account_id = p_account_id
     and lower(replace(address, 'ecash:', '')) = v_bare;
  if not found then
    insert into account_addresses (account_id, address, is_primary, verified_at, kind)
    values (p_account_id, v_pref, false, v_now, 'pocket');
  end if;

  -- Registry: the account's CURRENT pocket.
  insert into pocket_wallets (account_id, address, pubkey, created_at, updated_at)
  values (p_account_id, v_pref, p_pubkey, v_now, v_now)
  on conflict (account_id) do update
     set address = excluded.address,
         pubkey = excluded.pubkey,
         delegate_txid = null,   -- new pocket, new provenance
         updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'already', false, 'absorbed', v_absorbed);
end;
$$;

revoke all on function public.link_pocket_address(uuid, text, text, boolean) from public;
revoke all on function public.link_pocket_address(uuid, text, text, boolean) from anon;
revoke all on function public.link_pocket_address(uuid, text, text, boolean) from authenticated;
grant execute on function public.link_pocket_address(uuid, text, text, boolean) to service_role;
