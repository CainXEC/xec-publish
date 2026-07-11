-- =============================================================================
--  change_primary_address(p_account_id, p_new_address) — atomically move an
--  account's identity + payout to a NEW wallet address.
--
--  The address lives in three DB places that must never diverge:
--    1. account_addresses.is_primary  — login identity / handle-ownership anchor
--    2. authors.xec_address           — where article-unlock payments are built
--    3. feed_posts.payout_address     — where replies/tips on feed posts pay
--  A plpgsql body runs in ONE transaction, so the swap is all-or-nothing; a
--  partial update (e.g. new primary but stale xec_address) would silently route
--  earnings to the wrong wallet.
--
--  Security model (see app/api/account/change-address/*): the caller has BOTH
--  a challenge-scope session for this account AND an on-chain nonce payment
--  signed by the NEW wallet, so control of both sides is proven before this
--  function runs. This function only enforces DB consistency:
--    - the new address must not belong to any OTHER account or author
--      (merging accounts is out of scope — raise 'address_in_use');
--    - the OLD address stays linked (is_primary = false). That keeps the old
--      wallet's unlock entitlements attached to the account, keeps old payer-
--      address bylines resolving to this profile, and — deliberately — keeps
--      the old wallet able to LOG IN to this account, so the real owner of a
--      hijacked account can always switch the address back.
--
--  Re-promoting a previously-linked address (switching back) is supported: the
--  existing row is promoted instead of inserting a duplicate.
--
--  feed_posts.payout_address is re-pointed for THIS account's posts so future
--  tips/replies on old posts follow the account ("earnings follow the account",
--  the platform invariant). Mint-card posts live on the official platform
--  account, so a user's swap never touches platform payout rows. Known tiny
--  race, accepted: a reply/tip prepared seconds before a swap and paid after it
--  fails confirm-time validation — the sats went to the author's own old
--  wallet, only the reaction record is lost.
--
--  Addresses are compared on a NORMALIZED form (lowercase, "ecash:" prefix
--  stripped) because legacy rows store either form. New writes always store the
--  prefixed form, matching walletAuth's payerOf().
-- =============================================================================

create or replace function public.change_primary_address(
  p_account_id uuid,
  p_new_address text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author_id   uuid;
  v_bare        text;
  v_pref        text;
  v_old_primary text;
  v_now         timestamptz := now();
begin
  v_bare := lower(regexp_replace(trim(p_new_address), '^ecash:', ''));
  if v_bare is null or v_bare = '' then
    raise exception 'invalid_address';
  end if;
  v_pref := 'ecash:' || v_bare;

  -- Lock the account row: serializes concurrent swaps for the same account.
  select author_id into v_author_id
    from accounts where id = p_account_id for update;
  if not found then
    raise exception 'account_not_found';
  end if;

  -- The new address must not be claimed by another account…
  if exists (
    select 1 from account_addresses
     where lower(replace(address, 'ecash:', '')) = v_bare
       and account_id <> p_account_id
  ) then
    raise exception 'address_in_use';
  end if;

  -- …nor by another (possibly legacy, account-less) author row, or a later
  -- login with that wallet would resolve to the wrong author identity.
  if exists (
    select 1 from authors
     where lower(replace(xec_address, 'ecash:', '')) = v_bare
       and (v_author_id is null or id <> v_author_id)
  ) then
    raise exception 'address_in_use';
  end if;

  select address into v_old_primary
    from account_addresses
   where account_id = p_account_id and is_primary
   limit 1;

  -- Demote the old primary but KEEP it linked (entitlements + recovery login).
  update account_addresses
     set is_primary = false
   where account_id = p_account_id and is_primary;

  -- Promote an existing link for this address, or insert a fresh one.
  update account_addresses
     set is_primary = true, verified_at = v_now
   where account_id = p_account_id
     and lower(replace(address, 'ecash:', '')) = v_bare;
  if not found then
    insert into account_addresses (account_id, address, is_primary, verified_at)
    values (p_account_id, v_pref, true, v_now);
  end if;

  -- Payouts follow the account.
  if v_author_id is not null then
    update authors set xec_address = v_pref where id = v_author_id;
  end if;
  update feed_posts
     set payout_address = v_pref
   where author_account_id = p_account_id;

  update accounts set updated_at = v_now where id = p_account_id;

  return jsonb_build_object('old_primary', v_old_primary, 'new_primary', v_pref);
end;
$$;

-- Callable only by the service role (the change-address route runs it after the
-- challenge-session + new-wallet-payment checks). Never expose to anon.
revoke all on function public.change_primary_address(uuid, text) from public;
revoke all on function public.change_primary_address(uuid, text) from anon;
revoke all on function public.change_primary_address(uuid, text) from authenticated;
grant execute on function public.change_primary_address(uuid, text) to service_role;

-- Backstop the app-layer conflict check: one account per (normalized) address.
-- Both historical writers (walletAuth login, claimGrant) insert at most one row
-- per address, so this should apply cleanly; if it errors with a duplicate,
-- STOP and investigate — two accounts already share a wallet.
create unique index if not exists account_addresses_address_norm_key
  on account_addresses (lower(replace(address, 'ecash:', '')));
