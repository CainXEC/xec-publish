-- =============================================================================
--  Launch-blocker #1 — close the anon-key paywall leak.
--
--  The public NEXT_PUBLIC_SUPABASE_ANON_KEY (shipped in the browser bundle) could
--  read `posts.body` — the PAYWALLED content — directly via Supabase REST:
--      curl '<url>/rest/v1/posts?select=body' -H "apikey: <anon key>"
--  returned the full locked body for every paid article. RLS is row-level (not
--  column-level), so the fix is to deny the anon/authenticated roles ALL direct
--  access to these article-world tables.
--
--  Why this is safe (verified 2026-07-10):
--    * Every SERVER path that reads/writes these tables now uses the service-role
--      client (createServerSupabase), which has BYPASSRLS — unaffected.
--    * The author dashboard reads `unlocks` ONLY through the SECURITY DEFINER RPCs
--      get_unlock_earnings / get_unlock_counts, which run as the function owner and
--      also bypass RLS — unaffected.
--    * No browser/client component reads posts/comments/authors via the anon key
--      (the only anon-client component, AuthorProfilePosts.js, is dead code).
--    * Enabling RLS with NO policies = deny-all for anon/authenticated.
--
--  Run this once in the Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
--  Idempotent: safe to run more than once.
-- =============================================================================

alter table public.posts    enable row level security;
alter table public.comments enable row level security;
alter table public.authors  enable row level security;
alter table public.unlocks  enable row level security;

-- Remove any lingering direct table grants to the public API roles so a direct
-- REST call gets "permission denied" instead of an empty set. Service-role and
-- SECURITY DEFINER functions are unaffected (different roles / definer rights).
revoke all on public.posts    from anon, authenticated;
revoke all on public.comments from anon, authenticated;
revoke all on public.authors  from anon, authenticated;
revoke all on public.unlocks  from anon, authenticated;

-- Sanity check after running (should return 0 rows / permission denied for anon):
--   set role anon;
--   select body from public.posts limit 1;   -- expect: permission denied / no rows
--   reset role;
