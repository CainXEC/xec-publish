-- =============================================================================
--  mint_reconcile.sql
--  Server-side mint delivery: a PAID mint is now retried until the handle is
--  delivered, never refunded for a transient hiccup. This adds the bookkeeping
--  the retry loop needs, plus a fast index for the reconciler's sweep.
--
--  New columns on pending_mints:
--    attempts        int   -- how many delivery attempts this paid mint has had
--    last_attempt_at ts    -- when the last attempt ran (spaces retries so an
--                             in-flight broadcast has time to index → no double-mint)
--
--  New status value 'stuck' (no schema change — status is free text): a paid
--  mint that has failed MAX_MINT_ATTEMPTS times is parked here for manual review.
--  It is NOT refunded — the buyer paid, so delivery is owed; 'stuck' just means
--  "stop the automatic loop and look at this by hand."
--
--  Idempotent — safe to run more than once.
-- =============================================================================

alter table pending_mints add column if not exists attempts int not null default 0;
alter table pending_mints add column if not exists last_attempt_at timestamptz;

-- The reconciler sweeps rows that still owe a delivery, oldest attempt first.
create index if not exists pending_mints_owed_idx
  on pending_mints (status, last_attempt_at nulls first)
  where status = 'paid';
