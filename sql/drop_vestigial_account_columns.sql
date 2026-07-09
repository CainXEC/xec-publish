-- Drop the two now-vestigial accounts columns left over from the reader/author
-- unification:
--   * kind  — always 'author' since the split was removed; never read for
--             behavior. Its writes are gone from lib/walletAuth.ts and
--             lib/claimGrant.ts.
--   * bio   — bio unified onto authors.bio; accounts.bio is unreferenced (the
--             unify_reader_author backfill already copied any values across).
--
-- Run AFTER deploying the code that stops writing accounts.kind (kind is NOT
-- NULL with no default, so old code writes it and new code omits it — deploy
-- first, then run this). Idempotent.

alter table public.accounts drop column if exists kind;
alter table public.accounts drop column if exists bio;
