-- =============================================================================
--  Feed polls — voting store.
--
--  A poll is a normal feed_posts row with:
--    card_kind = 'poll'
--    card_meta = { "options": [{ "id": "o0", "text": "…" }, …],
--                  "eligibility": "handle" | "account" }
--  The poll QUESTION is the post content (hashed on-chain like any paid post —
--  the options are structured metadata, not part of the proof-of-writing).
--
--  Voting is FREE and account-gated (unlike everything else, which is paid):
--    eligibility 'account' → any logged-in account may vote
--    eligibility 'handle'  → only accounts currently holding a handle may vote
--  One vote per account per poll (immutable). Enforcement is app-layer via
--  getAuthedAccount(); this table just records the votes. Service-role only.
-- =============================================================================

create table if not exists public.feed_poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_txid text not null,
  voter_account_id uuid not null references public.accounts(id) on delete cascade,
  option_id text not null,
  created_at timestamptz not null default now(),
  unique (poll_txid, voter_account_id)
);

create index if not exists feed_poll_votes_poll_idx
  on public.feed_poll_votes (poll_txid);

alter table public.feed_poll_votes enable row level security;
-- No policies: RLS denies all; the app reaches this table only via the
-- service-role client after app-layer eligibility checks.
