-- =============================================================================
--  bind_claim_account(p_author_id, p_new_address, p_token_id, p_handle)
--  — the transactional core of a grandfather claim's account binding.
--
--  Replaces the open-coded bindAuthorAccount() in lib/claimGrant.ts, which had a
--  latent split-identity bug (see docs/supabase-audit-2026-07-27.md, "Lots"):
--
--    A legacy author (authors row from before the account model, owning their
--    articles) who LOGS IN or PAYS with a NEW wallet gets a fresh shell account
--    minted for that address by resolveOrCreateAccount(). When they later CLAIM
--    their handle, the old bindAuthorAccount() would try to point that shell
--    account at their legacy author_id — but the legacy author already has an
--    account, so accounts_author_id_key (the 1:1 unique index) is VIOLATED and
--    the claim THROWS *after the NFT is already minted on-chain* (retry risks a
--    double-mint). Even when it didn't throw it left earnings split across two
--    author rows.
--
--  THE FIX mirrors what the pocket flow and change_primary_address already do:
--  resolve to ONE surviving account and absorb the empty shell. Almost all of
--  the hard work is delegated to change_primary_address() (empty-shell
--  absorption, keeping the old address linked for recovery, and re-pointing all
--  three denormalized payout copies — account_addresses.is_primary /
--  authors.xec_address / feed_posts.payout_address — in one transaction). This
--  function only decides WHICH account survives and binds the display handle.
--
--  Three cases (S = surviving account):
--    1. The author already has an account A  ->  S = A. change_primary_address(A,
--       new_addr) promotes the claimed wallet to primary and, if that wallet
--       belongs to an empty shell account (the premature-login case above),
--       absorbs it: the shell's addresses re-point to A, the shell account +
--       its orphan author row are deleted. THIS is the Lots case, healed.
--    2. No account for the author yet, but the claimed address already has an
--       account B (they used the feed from the new wallet before claiming) -> S =
--       B. Adopt B for the legacy author: re-point B.author_id, drop B's orphan
--       author row (guarded — must own no articles), then normalize primary/
--       payouts via change_primary_address(B, new_addr).
--    3. Neither exists -> mint a fresh account for the author and link the
--       claimed address as primary (already-primary, so no swap needed).
--  Then, in every case, stamp the claimed handle as the account's active display
--  identity.
--
--  KNOWN RESIDUAL (documented, not a regression): if the shell/other account has
--  REAL activity (own feed posts, paid reactions, follows, or articles under its
--  author), it is NOT an empty shell and merging two real accounts is out of
--  scope — change_primary_address raises 'address_in_use' and the claim fails
--  safely (needs manual reconciliation). This is strictly better than today's
--  unconditional unique-violation throw, and far rarer.
--
--  DEPENDS ON sql/change_primary_address.sql (and, transitively, its
--  sql/pocket_wallets.sql prerequisite) being applied first.
--
--  Apply in the Supabase SQL editor. Safe to re-run.
-- =============================================================================

create or replace function public.bind_claim_account(
  p_author_id uuid,
  p_new_address text,
  p_token_id text,
  p_handle text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bare       text;
  v_pref       text;
  v_now        timestamptz := now();
  v_survivor   uuid;
  v_a          uuid;   -- the author's existing account (case 1)
  v_b          uuid;   -- the account currently holding the claimed address (case 2)
  v_b_author   uuid;   -- B's current author, if any (the orphan to reassign/drop)
begin
  v_bare := lower(regexp_replace(trim(p_new_address), '^ecash:', ''));
  if v_bare is null or v_bare = '' then
    raise exception 'invalid_address';
  end if;
  v_pref := 'ecash:' || v_bare;

  -- The author's existing account, if any. Locked to serialize against a
  -- concurrent change_primary_address / claim touching the same identity.
  if p_author_id is not null then
    select id into v_a from accounts where author_id = p_author_id for update;
  end if;

  -- The account currently linked to the claimed address, if any.
  select account_id into v_b
    from account_addresses
   where lower(replace(address, 'ecash:', '')) = v_bare
   limit 1;

  if v_a is not null then
    -- CASE 1: author has an account. Make the claimed wallet its primary; absorb
    -- an empty shell on that wallet if present (the Lots case). All payout copies
    -- move with it inside change_primary_address's single transaction.
    v_survivor := v_a;
    perform change_primary_address(v_a, p_new_address);

  elsif v_b is not null then
    -- CASE 2: no account for the author yet, but the claimed address already has
    -- one. Adopt it for the legacy author.
    v_survivor := v_b;
    if p_author_id is not null then
      select author_id into v_b_author from accounts where id = v_b for update;
      if v_b_author is distinct from p_author_id then
        -- Reassigning/deleting an author that owns articles would strand those
        -- articles' payouts. That's a real-account merge — out of scope.
        if v_b_author is not null
           and exists (select 1 from posts where author_id = v_b_author) then
          raise exception 'address_in_use';
        end if;
        update accounts set author_id = p_author_id, updated_at = v_now where id = v_b;
        if v_b_author is not null then
          -- orphan author (no articles, verified above): drop it so it can't
          -- later hijack a login's identity resolution.
          delete from authors where id = v_b_author;
        end if;
      end if;
    end if;
    -- With B now pointing at the legacy author, normalize primary + payouts to
    -- the claimed wallet (also demotes B's old primary, kept linked for recovery).
    perform change_primary_address(v_b, p_new_address);

  else
    -- CASE 3: brand-new. Mint the account and link the claimed address as primary.
    insert into accounts (author_id, updated_at) values (p_author_id, v_now)
      returning id into v_survivor;
    insert into account_addresses (account_id, address, is_primary, verified_at)
      values (v_survivor, v_pref, true, v_now);
    if p_author_id is not null then
      update authors set xec_address = v_pref where id = p_author_id;
    end if;
  end if;

  -- Stamp the claimed handle as the account's active display identity (the byline
  -- only shows @handle while the NFT is held on the primary address — which the
  -- change_primary_address calls above have just guaranteed the claimed wallet is).
  update accounts
     set active_handle_token_id = p_token_id,
         display_handle = p_handle,
         display_handle_checked_at = v_now,
         updated_at = v_now
   where id = v_survivor;

  return jsonb_build_object('account_id', v_survivor);
end;
$$;

-- Service-role only (the claim runs it after code + on-chain proof-of-keys).
revoke all on function public.bind_claim_account(uuid, text, text, text) from public;
revoke all on function public.bind_claim_account(uuid, text, text, text) from anon;
revoke all on function public.bind_claim_account(uuid, text, text, text) from authenticated;
grant execute on function public.bind_claim_account(uuid, text, text, text) to service_role;
