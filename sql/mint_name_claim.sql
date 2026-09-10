-- =============================================================================
--  mint_name_claim.sql   (item 4: atomic name-claim on first payment)
--  Only ONE payment may hold a live claim on a handle at a time. The instant a
--  payment is detected and its row flips to 'paid', this partial unique index
--  claims the name; a SECOND payment for the same name (a double-buy race) trips
--  a unique violation on its flip and is refunded (delivery is impossible — the
--  name is already someone else's). Prevents any double-mint window, and makes
--  the loser's refund deterministic and immediate instead of discovered later.
--
--  Scope = the "owed a delivery" states only: 'paid' (being delivered) and
--  'stuck' (delivery owed, parked for manual review). NOT 'minted' — that's
--  terminal and already guarded by the unique index on handles.handle_skeleton;
--  including it here could collide with historical rows. 'pending' (unpaid),
--  'expired', 'refunded', 'failed', 'contended' hold no claim, so many may coexist.
--
--  Precondition (verified 2026-09-09): no skeleton currently has >1 paid/stuck row.
--  Idempotent — safe to run more than once.
-- =============================================================================

create unique index if not exists pending_mints_active_claim_uidx
  on pending_mints (handle_skeleton)
  where status in ('paid', 'stuck');
