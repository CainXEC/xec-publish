-- =============================================================================
--  change_primary_address(p_account_id, p_new_address) — atomically move an
--  account's identity + payout to a NEW wallet address. v2: absorbs empty
--  shell accounts.
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
--    - the OLD address stays linked (is_primary = false). That keeps the old
--      wallet's unlock entitlements attached to the account, keeps old payer-
--      address bylines resolving to this profile, and — deliberately — keeps
--      the old wallet able to LOG IN to this account, so the real owner of a
--      hijacked account can always switch the address back.
--
--  SHELL ABSORPTION (v2): every wallet that ever paid a login challenge got an
--  account minted for it, so the natural "try the new wallet by logging in
--  once" walls that wallet off from address-change. When the new address
--  belongs to another account that is an EMPTY SHELL — no articles, no feed
--  posts, no paid reactions, no follows in either direction — the swap absorbs
--  it: every address the shell held is re-pointed at the surviving account,
--  the shell's account/author rows are deleted, and (if the survivor has no
--  bound handle) the shell's handle binding is carried over. This grants no
--  new power: the shell's only credential IS the wallet key the caller just
--  proved, so they could equally log into the shell and delete it by hand.
--  Address-keyed history (unlocks, comments) follows the moved addresses into
--  the survivor automatically. An account with ANY deliberate activity still
--  hard-blocks with 'address_in_use' — merging real accounts stays out of
--  scope.
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
--
--  Locking: the caller's account row is locked first, then the shell's. Two
--  simultaneous swaps absorbing each other's account could in theory deadlock;
--  Postgres aborts one and the caller simply retries.
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
  v_author_id    uuid;
  v_bare         text;
  v_pref         text;
  v_old_primary  text;
  v_now          timestamptz := now();
  v_shell_id     uuid;
  v_shell_author uuid;
  v_shell_token  text;
  v_shell_handle text;
  v_absorbed     boolean := false;
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

  -- Does the new address belong to another account?
  select account_id into v_shell_id
    from account_addresses
   where lower(replace(address, 'ecash:', '')) = v_bare
     and account_id <> p_account_id
   limit 1;

  if v_shell_id is not null then
    -- Lock the shell, then require it to be a true empty shell.
    select author_id, active_handle_token_id, display_handle
      into v_shell_author, v_shell_token, v_shell_handle
      from accounts where id = v_shell_id for update;
    if not found then
      v_shell_id := null; -- vanished mid-flight; treat as unclaimed
    elsif exists (select 1 from feed_posts   where author_account_id   = v_shell_id)
       or exists (select 1 from feed_events  where actor_account_id    = v_shell_id)
       or exists (select 1 from feed_follows where follower_account_id = v_shell_id
                                                or followee_account_id = v_shell_id)
       or (v_shell_author is not null and
           exists (select 1 from posts where author_id = v_shell_author))
    then
      raise exception 'address_in_use';
    else
      -- Absorb: every address the shell held joins the survivor (non-primary;
      -- the candidate is promoted below). Unlocks/comments key on the address,
      -- so their history follows automatically.
      update account_addresses
         set account_id = p_account_id, is_primary = false
       where account_id = v_shell_id;

      -- Deleting the accounts row cascades feed_follows / feed_notifications /
      -- feed_blocks / account_links (same as delete_account); feed_posts and
      -- feed_events are empty by the checks above.
      delete from accounts where id = v_shell_id;
      if v_shell_author is not null then
        delete from authors where id = v_shell_author; -- no posts, checked above
      end if;
      v_absorbed := true;
    end if;
  end if;

  -- A legacy, account-less author row on this address would still hijack a
  -- later login's identity resolution — keep blocking those. (An absorbed
  -- shell's author row was deleted just above and no longer trips this.)
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

  -- Carry the shell's handle binding when the survivor has none: the NFT sits
  -- in the wallet that just became the survivor's primary. Best-effort — the
  -- caller re-verifies against the chain right after (rebindHandleAfterSwap),
  -- which clears a binding the wallet doesn't actually hold.
  if v_absorbed and v_shell_token is not null then
    update accounts
       set active_handle_token_id = v_shell_token,
           display_handle = v_shell_handle,
           display_handle_checked_at = v_now
     where id = p_account_id and active_handle_token_id is null;
  end if;

  update accounts set updated_at = v_now where id = p_account_id;

  return jsonb_build_object(
    'old_primary', v_old_primary,
    'new_primary', v_pref,
    'absorbed', v_absorbed
  );
end;
$$;

-- Callable only by the service role (the change-address route runs it after the
-- challenge-session + new-wallet-payment checks). Never expose to anon.
revoke all on function public.change_primary_address(uuid, text) from public;
revoke all on function public.change_primary_address(uuid, text) from anon;
revoke all on function public.change_primary_address(uuid, text) from authenticated;
grant execute on function public.change_primary_address(uuid, text) to service_role;

-- Backstop the app-layer conflict check: one account per (normalized) address.
-- (Already applied with v1; IF NOT EXISTS makes re-running this script safe.)
create unique index if not exists account_addresses_address_norm_key
  on account_addresses (lower(replace(address, 'ecash:', '')));
