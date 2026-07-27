-- =============================================================================
--  authors_xec_address_unique.sql — resolve the two duplicate authors.xec_address
--  pairs found in the 2026-07-27 audit follow-up, then enforce one author row per
--  payout address forever. (Audit Priority 1, unblocks the partial unique index.)
--
--  Verified read-only (service-role) before writing this file — every FK
--  reference to the orphan rows below is zero, so both survivors keep everything:
--
--    PAIR A — ecash:qzdhjv4ymltsxlg5js87h26cev6fk579ecfkceh7qg  (writer "Lots")
--      SURVIVOR 1ad01417 — owns 10 articles + the @Lots account (that address is
--        its primary; payouts already route correctly).
--      ORPHAN   afff2868 — a pure dangling author row: 0 posts, 0 accounts, 0
--        claim-grant refs. Its shell account was already absorbed when Lots's
--        address moved. NOTE: this pair did NOT exist before the manual Lots fix
--        — `update authors set xec_address = <new>` collided the legacy row with
--        the orphan that was already sitting on that new address.
--
--    PAIR B — ecash:qqtacwv7mw2tsnf5hsd35w0n9njsxvws2cr6mxhhs4
--      SURVIVOR af6c38ec — account e5a59273 holds this address as PRIMARY and has
--        real feed activity (1 post, 1 reaction).
--      ORPHAN   033c631a — 0 posts, linked only to addressless account 273d2683
--        (zero activity, no addresses → unreachable by login). A ~6ms
--        double-registration on 2026-07-14.
--
--  One transaction, ending in the index build. Every delete is GUARDED (it only
--  fires while the row is still a true empty orphan), and if any duplicate
--  somehow survived, CREATE UNIQUE INDEX fails and the whole script rolls back —
--  so the index doubles as the correctness check. Apply in the Supabase SQL editor.
-- =============================================================================

begin;

-- PAIR A: drop the dangling Lots orphan (only if it still owns nothing).
delete from public.authors a
 where a.id = 'afff2868-39db-4169-a93e-1c56ed9eef38'
   and not exists (select 1 from public.posts    p where p.author_id = a.id)
   and not exists (select 1 from public.accounts c where c.author_id = a.id);

-- PAIR B: drop the orphan's addressless account first (FK: authors is referenced
-- by accounts.author_id, so the account must go before its author), then the
-- author. Both guarded against having gained any content since the audit.
delete from public.accounts c
 where c.id = '273d2683-62c5-47f6-8d3a-0d55acdcabeb'
   and not exists (select 1 from public.account_addresses ad where ad.account_id = c.id)
   and not exists (select 1 from public.feed_posts  fp where fp.author_account_id = c.id)
   and not exists (select 1 from public.feed_events fe where fe.actor_account_id  = c.id);

delete from public.authors a
 where a.id = '033c631a-61f7-4911-a75f-4bac87054678'
   and not exists (select 1 from public.posts    p where p.author_id = a.id)
   and not exists (select 1 from public.accounts c where c.author_id = a.id);

-- Enforce it going forward: one author per payout address, compared on the
-- NORMALIZED form (lowercase, "ecash:" stripped) because legacy rows store either
-- form — a raw-column index would let "qq…" and "ecash:qq…" both exist. Partial
-- (xec_address IS NOT NULL) so account-less/address-less author rows are exempt.
-- Mirrors account_addresses_address_norm_key (sql/change_primary_address.sql).
create unique index if not exists authors_xec_address_norm_key
  on public.authors (lower(replace(xec_address, 'ecash:', '')))
  where xec_address is not null;

commit;
