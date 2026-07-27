-- =============================================================================
--  accounts_author_unique.sql — enforce the accounts↔authors 1:1 (issue #2).
--
--  Code across the app resolves author_id -> account with `.maybeSingle()`,
--  assuming one account per author (see lib/accountAuthorLink.ts,
--  lib/authorDisplayHandles.js "First non-null wins if an author somehow has
--  multiple accounts"). That 1:1 was never constraint-enforced. Verified clean
--  on 2026-07-26 (114 authors ↔ 114 accounts, 0 duplicates), so this applies
--  without error and makes every author_id -> account resolution provably
--  deterministic.
--
--  Partial (WHERE author_id IS NOT NULL) so reader-only accounts that haven't
--  been linked to an author yet — a legacy/transient state — are unaffected.
--
--  Apply in the Supabase SQL editor (schema is managed in the dashboard; this
--  file is the source of record). Safe to re-run.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS accounts_author_id_key
  ON public.accounts (author_id)
  WHERE author_id IS NOT NULL;
