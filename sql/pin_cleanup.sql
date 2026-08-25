-- =============================================================================
--  pin_cleanup.sql — clear stale account pins.
--
--  Null out any accounts.pinned_post_txid that no longer points to the account's
--  OWN, live, top-level (POST / QUOTE) feed post. The render path already refuses
--  to show such a pin (lib/getFeed.js prependPinnedPost requires
--  author_account_id = the account, deleted_at IS NULL, action IN top-level), and
--  /api/feed/pin now enforces ownership on every new pin — so this is pure
--  hygiene: it clears dead pointers left by older data (a pin set before the
--  ownership check, or a post since deleted / re-attributed).
--
--  Idempotent; safe to re-run. Data-only (no schema change).
-- =============================================================================

UPDATE public.accounts a
SET pinned_post_txid = NULL
WHERE a.pinned_post_txid IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.feed_posts p
    WHERE p.txid = a.pinned_post_txid
      AND p.author_account_id = a.id
      AND p.deleted_at IS NULL
      AND p.action IN (1, 3)  -- FEED_ACTION POST (1) + QUOTE (3): the pinnable set
  );
