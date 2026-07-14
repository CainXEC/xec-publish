-- Paid, threaded article comments.
-- Apply in the Supabase SQL editor BEFORE deploying the paid-comments feature.
-- Turns the old free `comments` table into a pay-to-comment / pay-to-reply table
-- that mirrors feed_posts: one on-chain paid tx == one comment, replies pay the
-- author of whatever they answer (94/6), threaded by parent_txid.
--
-- Every column is added nullable / IF NOT EXISTS so pre-existing FREE comments
-- (txid IS NULL) keep rendering untouched — they're simply legacy rows that
-- predate payments. Safe to re-run.

-- Identity + payment snapshot, mirroring feed_posts. Identity is STAMPED at
-- write time (author_identity) and payout_address is a snapshot so replies to a
-- comment always pay the wallet that paid for it, even after a handle is sold.
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS txid              text,        -- the on-chain comment/reply tx
  ADD COLUMN IF NOT EXISTS action            smallint,    -- POWR action: 10 = comment, 11 = comment_reply (legacy free rows: NULL)
  ADD COLUMN IF NOT EXISTS parent_id         uuid REFERENCES public.comments(id), -- reply → parent comment (thread link; works for legacy free parents too)
  ADD COLUMN IF NOT EXISTS parent_txid       text,        -- reply → parent comment's txid (on-chain REPLY target; NULL if parent is a legacy free comment)
  ADD COLUMN IF NOT EXISTS content_hash      text,        -- sha256(content) hex; == on-chain OP_RETURN
  ADD COLUMN IF NOT EXISTS author_account_id uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS author_identity   text,        -- snapshot: "@handle" or raw ecash address
  ADD COLUMN IF NOT EXISTS payout_address    text,        -- snapshot; where replies to THIS comment pay
  ADD COLUMN IF NOT EXISTS amount_sats       bigint,      -- total paid (author + platform)
  ADD COLUMN IF NOT EXISTS finalized_at      timestamptz, -- Avalanche-final stamp (NULL = provisional)
  ADD COLUMN IF NOT EXISTS deleted_at        timestamptz; -- soft delete: tombstoned so replies don't orphan

-- One on-chain payment == one comment. Partial so the many legacy free rows
-- (txid IS NULL) don't collide on a single NULL key.
CREATE UNIQUE INDEX IF NOT EXISTS comments_txid_key
  ON public.comments (txid)
  WHERE txid IS NOT NULL;

-- Thread lookup: a comment's replies are the rows whose parent_id is its id.
CREATE INDEX IF NOT EXISTS comments_parent_id_idx
  ON public.comments (parent_id)
  WHERE parent_id IS NOT NULL;

-- List a post's comments in order.
CREATE INDEX IF NOT EXISTS comments_post_created_idx
  ON public.comments (post_id, created_at);

-- Finality reconcile: the provisional (paid but not-yet-final) rows the sweep
-- re-checks. Excludes legacy free rows (txid IS NULL), which are never on-chain.
CREATE INDEX IF NOT EXISTS comments_provisional_idx
  ON public.comments (created_at)
  WHERE finalized_at IS NULL AND txid IS NOT NULL;

-- RLS is already enabled on comments with no policies (deny-all for anon/auth);
-- all access is service-role only. Nothing to change here — documented so this
-- file is a complete picture of the table's access model.
