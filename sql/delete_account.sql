-- =============================================================================
--  delete_account(p_account_id) — hard-delete an account and ALL of its data
--  in ONE transaction, in FK-safe order.
--
--  Replaces the old sequential per-table DELETEs in
--  app/api/author/delete-account/route.js, which had two bugs:
--    1. It never touched the feed tables (feed_posts / feed_events), so a
--       deleted account's tweets/replies/likes/reposts survived.
--    2. Because feed_posts.author_account_id and feed_events.actor_account_id
--       REFERENCE accounts(id) with NO on-delete rule, the final
--       `DELETE FROM accounts` hit a foreign-key violation for any feed-active
--       account — and since each step was its own committed statement, the
--       account was left HALF-deleted (articles/authors/addresses gone, account
--       + feed activity still present, 500 shown to the user).
--
--  A plpgsql function body runs in a single transaction: if any step raises,
--  everything rolls back. So deletion is now all-or-nothing.
--
--  NOT deleted, by design: handles / reserved_handles / claim_grants /
--  pending_mints. A handle is an on-chain NFT the wallet still holds; wiping its
--  registry row would wrongly free a name that is still owned on-chain (the
--  handle identity model resolves ownership from Chronik, not from this row).
--  On-chain records (posts' content hashes, the NFT itself) are permanent
--  regardless of what we delete here.
-- =============================================================================

create or replace function public.delete_account(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author_id uuid;
  v_addresses text[];
begin
  select author_id into v_author_id from accounts where id = p_account_id;

  select coalesce(array_agg(address), '{}') into v_addresses
    from account_addresses where account_id = p_account_id;

  -- Comments the user posted ANYWHERE (on their own or others' articles). The
  -- comments table has no account/author column — authorship is the proven
  -- payer address (tx.inputs[0]) — so match on every address this account owns.
  if array_length(v_addresses, 1) is not null then
    delete from comments where payer_address = any(v_addresses);
  end if;

  -- Article side (only if this account is linked to an author). Comments ON the
  -- user's own articles (from any commenter) go before the posts they hang off.
  if v_author_id is not null then
    delete from comments where post_id in (select id from posts where author_id = v_author_id);
    delete from posts where author_id = v_author_id;
  end if;

  -- Feed side: these reference accounts(id) with no ON DELETE rule, so they must
  -- be cleared before the accounts row or the delete below is blocked.
  delete from feed_events where actor_account_id = p_account_id;
  delete from feed_posts  where author_account_id = p_account_id;

  -- Wallet links, then the account itself. Deleting the accounts row cascades
  -- the ON DELETE CASCADE tables (feed_follows, feed_notifications, feed_blocks,
  -- account_links) automatically.
  delete from account_addresses where account_id = p_account_id;
  delete from accounts where id = p_account_id;

  -- Author row LAST: accounts.author_id may reference it, so it can't be removed
  -- until the accounts row is gone. No-op if this account had no author.
  if v_author_id is not null then
    delete from authors where id = v_author_id;
  end if;
end;
$$;

-- Callable only by the service role (the delete-account route uses the
-- service-role client after app-layer auth). Never expose to anon/authenticated.
revoke all on function public.delete_account(uuid) from public;
revoke all on function public.delete_account(uuid) from anon;
revoke all on function public.delete_account(uuid) from authenticated;
grant execute on function public.delete_account(uuid) to service_role;
