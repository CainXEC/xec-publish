-- =============================================================================
--  LAUNCH WIPE — proofofwriting.com
--  Clears the test feed + retires the rehearsal (POWH) handle world so the real
--  WRITE collection (04311f17…bde42e0) starts clean. Run ONCE in the Supabase
--  SQL editor (Dashboard → SQL Editor → paste → Run).
--
--  GOLDEN RULE — articles & identity are NEVER touched. This does NOT delete from
--  posts, comments, unlocks, publishes, authors, accounts, account_addresses,
--  reserved_handles, follows, or notifications.
--
--  >>> TAKE A DATABASE BACKUP FIRST <<<  (Supabase → Database → Backups).
--  The whole thing runs in one transaction: if any statement errors, EVERYTHING
--  rolls back and nothing changes.
-- =============================================================================

BEGIN;

-- 1) Feed wipe — the test posts and all their engagement (173 posts, 53 events…).
TRUNCATE TABLE
  public.feed_posts,
  public.feed_events,
  public.feed_follows,
  public.feed_blocks,
  public.feed_notifications
  RESTART IDENTITY;

-- 2) Clear stale handle bylines on kept accounts FIRST — they point at dead
--    rehearsal handles, and nulling them here also removes any reference before
--    we drop the handles table below (no foreign-key surprise, whatever the FK).
UPDATE public.accounts
   SET active_handle_token_id    = NULL,
       display_handle            = NULL,
       display_handle_checked_at = NULL
 WHERE active_handle_token_id IS NOT NULL
    OR display_handle IS NOT NULL;

-- 3) Retire the rehearsal handle NFTs, pending mints, and internal test claim
--    grants (all 6 are caincurrency* — your own testing).
--    NOTE: reserved_handles is intentionally KEPT (platform/project name blocklist:
--    pow, ecash, xec, proof_of_writing, … — group-agnostic protection).
--    Real grandfather grants get re-seeded after launch via scripts/seed-claim-grants.ts.
TRUNCATE TABLE
  public.handles,
  public.pending_mints,
  public.claim_grants
  RESTART IDENTITY;

-- 4) Reset the mint counter: 0 minted. Leave live = FALSE so minting stays CLOSED
--    until go-live — and only after the real grandfather grants are re-seeded, so a
--    legacy author's handle can never be minted out from under them. Flipping
--    live = true is the final go-live switch (done alongside SITE_LIVE=true).
UPDATE public.nft_mint_counter
   SET minted = 0, live = false
 WHERE id = 1;

-- 5) Clear the mint lock (idempotent — already clear).
UPDATE public.mint_lock
   SET locked_until = NULL, holder = NULL
 WHERE id = 1;

-- 6) Clear transient login challenges.
TRUNCATE TABLE public.auth_challenges;

COMMIT;

-- ---- verification: expect feed_posts/handles/pending_mints/claim_grants = 0,
-- ----               posts/authors/accounts UNCHANGED, mint_live = false ----------
SELECT
  (SELECT count(*) FROM public.feed_posts)      AS feed_posts,
  (SELECT count(*) FROM public.handles)         AS handles,
  (SELECT count(*) FROM public.pending_mints)   AS pending_mints,
  (SELECT count(*) FROM public.claim_grants)    AS claim_grants,
  (SELECT count(*) FROM public.reserved_handles) AS reserved_kept,
  (SELECT count(*) FROM public.posts)           AS posts_kept,
  (SELECT count(*) FROM public.authors)         AS authors_kept,
  (SELECT count(*) FROM public.accounts)        AS accounts_kept,
  (SELECT count(*) FROM public.unlocks)         AS unlocks_kept,
  (SELECT live FROM public.nft_mint_counter WHERE id = 1) AS mint_live;
