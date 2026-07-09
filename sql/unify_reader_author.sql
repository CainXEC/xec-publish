-- Unify reader and author accounts.
--
-- The reader/author split was legacy. `authors` is the pre-wallet-auth identity,
-- and nothing ever minted new author rows, so any wallet account without a
-- matching legacy author was stuck as a permanent "reader" — it could log in,
-- comment, follow, hold handles, set a bio, but could NOT publish an article.
--
-- Every account is now an author identity; "author" just means "has published".
-- This backfills one author row for every account that lacks one — carrying over
-- any bio the account already set, and paying out to the account's proven login
-- address — then links it, so existing readers become write-capable.
--
-- Backward compatible: run this BEFORE (or alongside) the code that mints author
-- rows for brand-new signups. Old code keeps working; it just finds author_id
-- already populated. Idempotent: re-running only touches accounts still missing
-- an author.

-- Wallet authors have no legacy email or username (they route by handle/address),
-- so those columns must accept NULL.
alter table public.authors alter column email drop not null;
alter table public.authors alter column username drop not null;

do $$
declare
  a record;
  new_id uuid;
  addr text;
begin
  for a in select id, bio from public.accounts where author_id is null loop
    select address into addr
      from public.account_addresses
      where account_id = a.id
      order by is_primary desc nulls last, created_at asc
      limit 1;

    insert into public.authors (id, email, username, bio, xec_address, is_admin, created_at)
    values (gen_random_uuid(), null, null, a.bio, addr, false, now())
    returning id into new_id;

    update public.accounts set author_id = new_id, kind = 'author' where id = a.id;
  end loop;
end $$;

-- The reader/author 'kind' flag is now vestigial (always 'author'); normalize the
-- rest. The column can be dropped in a later migration once no deployed code
-- writes it.
update public.accounts set kind = 'author' where kind is distinct from 'author';
