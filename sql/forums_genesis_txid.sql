-- =============================================================================
--  forums: store the creation payment txid (genesis_txid).
--
--  A forum is created by a paid FORUM (OP_14) transaction. Recording its txid
--  lets the Live activity rail surface "@runner created /f/<slug>" with a link to
--  the on-chain tx, like every other rail line. NULL for forums created before
--  this column existed (they simply don't appear on the rail). Idempotent.
-- =============================================================================

ALTER TABLE public.forums
  ADD COLUMN IF NOT EXISTS genesis_txid text;
