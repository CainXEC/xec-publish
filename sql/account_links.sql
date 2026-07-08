-- Linked-wallet clustering for anti-gaming on the paid feed.
--
-- The feed ranks posts by PAID engagement (likes/reposts/tips/replies/quotes,
-- all on-chain payments). The obvious attack is self-dealing: an author funds a
-- handful of alt wallets from one source and has them all tip/like their own
-- posts to climb the feed. Because every reaction resolves to an accounts.id
-- (actor_account_id / author_account_id), NAIVE self-tipping — same account
-- reacting to its own post — is already caught for free by the ranking RPC
-- (a supporter whose account == the author's account is excluded from the tally).
--
-- This table is the ADDITIVE upgrade that also catches the alt-wallet RING: it
-- maps each account into a CLUSTER (the on-chain "one wallet funds ten alts"
-- star pattern is detectable off-chain). The ranking RPC excludes a reaction
-- whenever the supporter's cluster == the author's cluster, so an entire ring
-- earns zero ranking benefit — wash-trading becomes pure XEC loss for the
-- attacker.
--
-- IT SHIPS EMPTY ON PURPOSE. With zero rows, COALESCE(cluster_id, account_id)
-- falls back to the account's own id, so every account is its own cluster and
-- the RPC still kills naive self-tipping. A later clustering worker (Phase 2)
-- just POPULATES this table — no code change to the RPC or ranker. That's why
-- the exclusion is written against clusters from day one even though clusters
-- don't exist yet.
--
-- Apply in the Supabase SQL editor (schema is managed in the dashboard; this
-- file is the source of record). FK depends on public.accounts(id).

CREATE TABLE IF NOT EXISTS public.account_links (
  account_id  uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  cluster_id  uuid NOT NULL,               -- the group this account belongs to
  reason      text,                        -- why it was linked (e.g. 'shared-funding-source')
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- "Who else is in this cluster?" — used by the (future) clustering worker and
-- any audit/debug of a flagged ring.
CREATE INDEX IF NOT EXISTS account_links_cluster_idx
  ON public.account_links (cluster_id);

-- Deny-by-default: the app only touches this via the service-role key (bypasses
-- RLS). Enabling RLS with NO policies locks out direct anon/authenticated access
-- without affecting server writes. Safe to re-run.
ALTER TABLE public.account_links ENABLE ROW LEVEL SECURITY;
