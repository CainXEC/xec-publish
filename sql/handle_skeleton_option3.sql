-- =============================================================================
--  handle_skeleton_option3.sql
--
--  Adopts the "Option 3" uniqueness skeleton (lib/handleSkeleton.ts): the entire
--  bare-vertical family { i, I, l, 1 } folds to 'l', then lowercase. This closes
--  the case-leak where @indonesia and @Indonesia minted as two different names
--  (old rule folded capital I but not lowercase i).
--
--  Recomputes handle_skeleton across EVERY table that stores it, because the mint
--  gate / blocklist / grant lookups all compare against the new fold:
--    handles          — minted NFTs (skeleton has a UNIQUE INDEX; PK = token_id)
--    reserved_handles — name blocklist (skeleton IS THE PRIMARY KEY)
--    claim_grants     — grandfather claim invites (skeleton IS THE PRIMARY KEY)
--    pending_mints    — transient payment tracking (skeleton unconstrained; PK=id)
--
--  Because @indonesia + @Indonesia already exist on-chain, they now collapse to
--  the SAME skeleton ("lndonesla"). We keep BOTH as a permanent one-time artifact
--  via handles.skeleton_exempt + a PARTIAL unique index (unique among non-exempt
--  rows only). The app mint gate still sees the pair and blocks any future
--  indonesia-variant, so the bug is frozen and cannot recur.
--
--  reserved_handles legitimately MERGES under the stricter fold (admin+adm1n ->
--  admln, 4dmin+4dm1n -> 4dmln): those were separately-seeded impersonation
--  guards that one skeleton now covers. We de-duplicate, keeping one row per
--  skeleton — that is correct, not data loss.
--
--  The Option-3 fold in SQL — lower(regexp_replace(handle,'[Iil1]','l','g')) —
--  is byte-identical to skeleton() in lib/handleSkeleton.ts for these handles
--  (all ASCII, so displayHandle's NFKC/trim is a no-op; regexp_replace is
--  case-sensitive so [Iil1] matches exactly i, I, l, 1).
--
--  Safe to re-run. Run in the Supabase SQL editor (service role).
-- =============================================================================

begin;

-- ============================================================================
-- 1) handles — the minted NFTs
-- ============================================================================
alter table public.handles
  add column if not exists skeleton_exempt boolean not null default false;

-- drop any UNIQUE constraint / UNIQUE index on handles.handle_skeleton so the
-- in-place update below can never trip a transient collision.
do $$
declare c text; i text;
begin
  for c in
    select con.conname from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname='public' and rel.relname='handles' and con.contype='u'
      and pg_get_constraintdef(con.oid) ilike '%handle_skeleton%'
  loop execute 'alter table public.handles drop constraint '||quote_ident(c); end loop;

  for i in
    select indexname from pg_indexes
    where schemaname='public' and tablename='handles'
      and indexdef ilike '%unique%' and indexdef ilike '%handle_skeleton%'
  loop execute 'drop index if exists public.'||quote_ident(i); end loop;
end $$;

update public.handles
  set handle_skeleton = lower(regexp_replace(handle, '[Iil1]', 'l', 'g'));

-- GUARDRAIL: exactly one collision group, of exactly two rows, is allowed
-- (the @indonesia/@Indonesia artifact). Anything else rolls the whole tx back.
do $$
declare groups int; worst int; detail text;
begin
  select count(*), coalesce(max(n),0) into groups, worst
  from (select handle_skeleton, count(*) n from public.handles
        group by handle_skeleton having count(*)>1) g;
  if groups <> 1 or worst <> 2 then
    select string_agg(handle_skeleton||' x'||n, ', ') into detail
    from (select handle_skeleton, count(*) n from public.handles
          group by handle_skeleton having count(*)>1) g;
    raise exception
      'Unexpected handles collisions under Option 3 (expected exactly one 2-row group): %',
      coalesce(detail,'(none)');
  end if;
end $$;

-- flag the one grandfathered pair (auto-detected — no hardcoded token ids)
update public.handles
  set skeleton_exempt = true
  where handle_skeleton in (
    select handle_skeleton from public.handles
    group by handle_skeleton having count(*)>1
  );

-- new backstop: unique among non-exempt handles only.
create unique index if not exists handles_skeleton_uniq
  on public.handles (handle_skeleton)
  where not skeleton_exempt;

-- ============================================================================
-- 2) Foreign keys pointing AT reserved_handles / claim_grants block the rebuilds
--    below (e.g. claim_grants.handle_skeleton -> reserved_handles.handle_skeleton).
--    Capture their exact definitions, drop them, and recreate them verbatim at
--    the end once both tables carry the new skeletons. Integrity is preserved:
--    the new fold is strictly coarser than the old, so any grant that matched a
--    reserved row before still matches its (possibly-merged) row after.
-- ============================================================================
create temp table _fk on commit drop as
  select con.conname,
         con.conrelid::regclass::text as child_table,
         pg_get_constraintdef(con.oid)  as def
  from pg_constraint con
  where con.contype = 'f'
    and con.confrelid in ('public.reserved_handles'::regclass,
                          'public.claim_grants'::regclass);

do $$
declare r record;
begin
  for r in select * from _fk loop
    execute 'alter table '||r.child_table||' drop constraint '||quote_ident(r.conname);
  end loop;
end $$;

-- ============================================================================
-- 3) reserved_handles — blocklist (PK = handle_skeleton; stricter fold MERGES)
--    Rebuild de-duplicated: one row per new skeleton. Keeping the PK intact,
--    we delete-all then re-insert the deduped set (no transient PK collision).
-- ============================================================================
create temp table _rh on commit drop as
  select distinct on (new_sk)
         new_sk as handle_skeleton, handle, reason
  from (
    select lower(regexp_replace(handle,'[Iil1]','l','g')) as new_sk, handle, reason
    from public.reserved_handles
  ) s
  order by new_sk, handle;   -- deterministic survivor per skeleton

delete from public.reserved_handles;
insert into public.reserved_handles (handle_skeleton, handle, reason)
  select handle_skeleton, handle, reason from _rh;

-- ============================================================================
-- 4) claim_grants — grandfather invites (PK = handle_skeleton; NO collisions).
--    Rebuild preserving every column; PK re-asserts uniqueness on insert.
-- ============================================================================
create temp table _cg on commit drop as select * from public.claim_grants;
update _cg set handle_skeleton = lower(regexp_replace(handle,'[Iil1]','l','g'));
delete from public.claim_grants;
insert into public.claim_grants select * from _cg;

-- ============================================================================
-- 5) Recreate the foreign keys captured in step 2, verbatim. Both tables now
--    carry Option-3 skeletons, so every child row still resolves to a parent.
-- ============================================================================
do $$
declare r record;
begin
  for r in select * from _fk loop
    execute 'alter table '||r.child_table||' add constraint '||quote_ident(r.conname)||' '||r.def;
  end loop;
end $$;

-- ============================================================================
-- 6) pending_mints — transient payment tracking (skeleton unconstrained).
--    Drop any leftover unique index defensively, then update in place. The
--    indonesia pair collides here too but nothing enforces uniqueness on it.
-- ============================================================================
do $$
declare i text;
begin
  for i in
    select indexname from pg_indexes
    where schemaname='public' and tablename='pending_mints'
      and indexdef ilike '%unique%' and indexdef ilike '%handle_skeleton%'
  loop execute 'drop index if exists public.'||quote_ident(i); end loop;
end $$;

update public.pending_mints
  set handle_skeleton = lower(regexp_replace(handle,'[Iil1]','l','g'))
  where handle is not null;

commit;

-- sanity checks (run after commit):
--   select handle, handle_skeleton, skeleton_exempt from public.handles
--     where skeleton_exempt order by handle;            -- @indonesia + @Indonesia
--   select handle_skeleton, count(*) from public.handles
--     group by handle_skeleton having count(*)>1;        -- only lndonesla x2
--   select count(*) from public.reserved_handles;        -- 124 - 2 merged = 122
--   select count(*) from public.claim_grants;            -- unchanged (53)
