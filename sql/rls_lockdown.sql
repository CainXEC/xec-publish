-- =============================================================================
--  rls_lockdown.sql — close anon-readable table leaks (review issue #3).
--
--  The checked-in RLS files covered most tables but not these. A probe with the
--  ANON key (which is subject to RLS, unlike the service-role key the app uses)
--  on 2026-07-26 found:
--
--    handles          — 234 rows fully ANON-READABLE  (leak)
--    reserved_handles — 122 rows fully ANON-READABLE  (leak)
--    auth_challenges  — empty at probe time; RLS state unconfirmable by probe
--    feed_blocks      — empty at probe time; RLS state unconfirmable by probe
--
--  Everything else the app touches was already locked — either RLS deny-all
--  (accounts, account_addresses, feed_*, pocket_wallets, publishes, claim_grants,
--  mint/nft counters, handle_offers, feed_poll_votes …) or grant-revoked at the
--  role level (posts, authors, comments, unlocks → 401). The paywall boundary is
--  intact: `posts` is fully locked, so posts.body (which holds locked content)
--  never reaches anon.
--
--  The `handles` leak exposed minted_for_account_id — the internal account UUID
--  behind each handle — letting anyone correlate multiple handles to one owner.
--
--  This is safe and behavior-preserving: EVERY read of these four tables in the
--  app goes through the service-role key (adminDb, lib/db.ts), which BYPASSES
--  RLS. No browser/anon client touches them (verified). Enabling RLS with NO
--  policies denies anon + authenticated all rows — the same deny-all pattern the
--  other checked-in tables use (see sql/feed_follows.sql). Idempotent.
--
--  Apply in the Supabase SQL editor (schema is managed in the dashboard; this
--  file is the source of record). After applying, re-run the anon probe: handles
--  and reserved_handles must return 0 rows / permission denied.
-- =============================================================================

-- Confirmed anon-readable leaks. NOTE: `ENABLE ROW LEVEL SECURITY` alone did NOT
-- close these — a re-probe still returned all rows to anon — because both tables
-- carry a PERMISSIVE SELECT policy (Supabase's default "enable read for all",
-- from the mint pipeline's table creation) that overrides deny-all. So we (1)
-- drop every policy on them and (2) revoke the role grants outright, matching the
-- grant-revoked lock that posts/authors/comments/unlocks already use (→ 401).
ALTER TABLE public.handles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reserved_handles ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('handles', 'reserved_handles')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- Grant-level lock (independent of RLS/policies; service_role is unaffected —
-- it's a separate role with BYPASSRLS, which is what the app uses via adminDb).
REVOKE ALL ON public.handles          FROM anon, authenticated;
REVOKE ALL ON public.reserved_handles FROM anon, authenticated;

-- Defensive: login-nonce + block-list tables were empty at probe time, so their
-- RLS state couldn't be confirmed. auth_challenges holds login challenge nonces
-- (replay-protection surface) and must never be anon-readable; lock both. No-op
-- if RLS is already enabled.
ALTER TABLE public.auth_challenges  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_blocks      ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Verify RLS is enabled on every table the app touches (run this to confirm;
-- rowsecurity should be true for all rows returned):
--
--   SELECT relname AS table, relrowsecurity AS rls_enabled
--   FROM pg_class
--   WHERE relnamespace = 'public'::regnamespace
--     AND relkind = 'r'
--   ORDER BY relrowsecurity, relname;
-- ---------------------------------------------------------------------------
