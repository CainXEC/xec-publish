# Supabase Audit — proofofwriting.com

**Date:** 27 July 2026
**Scope:** `public` schema, RLS posture, identity model, index health, table bloat
**Database size:** ~10.6 MB across 35 tables

---

## Summary

Two live issues were found and fixed. Neither was a performance problem.

1. **A writer's earnings were routing to a wallet he no longer controlled** — one account, 10 articles.
2. **Every paywalled article was readable without paying**, using the anon key that ships in the client bundle. Author emails and payout addresses were exposed the same way.

Everything else checked out. There is no bloat, no missing-index emergency, RLS is enabled on all 35 tables, and the agent tables were the best-designed access control in the database.

---

## Fixed

### 1. Payout address drift (`Lots`, account `261f4f03`)

**Symptom:** articles paying to `qzmv02d8kgp6mjfmravc4ma5dc3chyx8xsp7vszg9s` while the account's auth-verified wallet was `qzdhjv4ymltsxlg5js87h26cev6fk579ecfkceh7qg`.

**Root cause:** two `authors` rows for the same person.

| row | created | username | email | address |
|---|---|---|---|---|
| `1ad01417` | Apr 17 | Lots | yes | old |
| `afff2868` | Jul 14 | — | no | correct |

The April row is the legacy identity. It owns the 10 articles and is what `accounts.author_id` points at. The July row was minted when he connected a new wallet, and owns nothing.

Because `posts` has no address column, article payouts resolve at read time from the author row — so a single `UPDATE` corrected all 10 articles retroactively.

**Applied:**
```sql
update public.authors
set xec_address = 'ecash:qzdhjv4ymltsxlg5js87h26cev6fk579ecfkceh7qg'
where id = '1ad01417-359e-4726-8371-19bd7321b5ae'
  and xec_address = 'ecash:qzmv02d8kgp6mjfmravc4ma5dc3chyx8xsp7vszg9s';
```

Orphan `afff2868` was deliberately left in place — it owns nothing and deleting it risks an unmapped FK.

**Scope check:** only one account was affected. The pocket feature is clean (17 pocket addresses across 18 multi-address accounts, zero orphans), so ordinary address-adding does *not* mint a duplicate author. The trigger is specifically a legacy author claiming with a wallet that differs from their migrated address.

---

### 2. RLS: public policies on core tables

`anon` and `authenticated` held full table privileges on every table in `public`, so RLS was the only gate. Twelve policies were granted to role `public` (which includes `anon`). Four were correctly guarded by `auth.role() = 'service_role'` and one was dead via `auth.uid()`. The rest were open.

| policy | expression | impact |
|---|---|---|
| `posts` SELECT | `published = true` | **full `body` column readable — paywall bypass on every paid article** |
| `authors` SELECT | `true` | 66 emails + all payout addresses readable |
| `authors` INSERT | `check = true` | arbitrary author rows, including `is_admin = true` |
| `unlocks` INSERT | `check = true` | self-granted entitlements |
| `comments` INSERT | `check = true` | replies without payment |
| `notifications` INSERT | `check = true` | arbitrary notifications (name says service role; policy says anyone) |

The paywall one is the significant one. `posts.body` holds the entire article — the paywall is an inline TipTap marker split server-side by `splitPostBodyAtPaywall.js`, which protects the rendered page but not a direct table read.

The `authors` INSERT policy also formed a plausible privilege-escalation chain: plant a row with `is_admin = true` and a controlled address, then authenticate with that wallet and let the address-based author lookup adopt it.

**Applied:** all twelve policies dropped, plus:
```sql
revoke all on all tables in schema public from anon, authenticated;
```

Site verified working afterward — nothing client-side was reading Supabase directly.

**Also done:** `service_role` key rotated.

**End state:** all 35 tables deny-all to `anon`. Agent tables reachable only through the dedicated `agent_worker` role.

---

## Checked and clean

- **No bloat.** Worst dead-tuple ratio is `accounts` at 46%, which is 176 KB. Autovacuum is keeping up. The single-row counters (`mint_lock`, `nft_mint_counter`) churn hard but stay tiny.
- **RLS enabled on all 35 tables.** 19 have no policy at all — deny-all except `service_role`, which is the correct posture.
- **Agent tables** use a dedicated `agent_worker` Postgres role rather than a shared key. This matches the build brief and is the strongest access control in the schema.
- **No client-side Supabase access.** Dropping every read policy broke nothing.

---

## Remaining actions

### Priority 1 — before the legacy-author outreach

> **Resolved 2026-07-27 (code follow-up).** The fix landed at the **claim path**, not
> login: the sole author-INSERT site (`resolveOrCreateAccount`) fires for a brand-new,
> unlinked address where the system genuinely cannot know the wallet belongs to a
> legacy author — minting there is correct for real new users, and the split is
> healed at claim time. Shipped `sql/bind_claim_account.sql` (a `SECURITY DEFINER`
> RPC that reuses `change_primary_address` to absorb an empty shell account a legacy
> author picked up by logging in early) + rewired `bindAuthorAccount` in
> `lib/claimGrant.ts`. This removes the unique-index collision that used to throw
> *after* the on-chain mint.
>
> The partial unique index is now in place — `authors_xec_address_norm_key`
> (`sql/authors_xec_address_unique.sql`), on the normalized address. Resolving it
> turned up **two** duplicate pairs, not one:
> - `qqtacwv7…` — a ~6ms double-registration on Jul 14. Kept `af6c38ec` (its
>   account holds the address as primary + has feed activity); removed orphan
>   `033c631a` and its addressless account `273d2683` (0 posts, unreachable by login).
> - `qzdhjv4y…` (Lots) — **created by this audit's own manual fix**: the
>   `UPDATE authors set xec_address = <new>` collided the legacy row (`1ad01417`,
>   owns the 10 articles) with the leftover orphan `afff2868` that was already on
>   that new address. Removed `afff2868` (by then a pure dangling row: 0 posts, 0
>   accounts, 0 grants). Lesson: leaving the orphan "in place" wasn't neutral — it
>   became a uniqueness collision the moment the legacy row moved onto its address.
>
> Both deletes were verified reference-free read-only first and run as one guarded
> transaction ending in the index build. Post-run: 155 authors, 0 duplicate address
> groups.

**Fix the author-creation path.** On wallet auth, if the resolved account already has an `author_id`, add the address to `account_addresses` and stop. Never mint a second `authors` row.

- 43 unclaimed legacy authors remain — each one is a chance to reproduce the Lots split.
- The pocket flow already handles this correctly; the claim path likely just needs to do what pocket does.
- Consider a partial unique index on `authors.xec_address` once the existing duplicate pair (`qqtacwv7mw2tsnf5hsd35w0n9njsxvws2cr6mxhhs4`, on two rows) is resolved.

### Priority 2 — decisions, not code

- **The 66 emails in `authors.email`.** No longer exposed, but still stored on a platform that advertises no identity disclosure. Export them first if you want the unclaimed-author outreach list, then `update public.authors set email = null;`.
- **Supabase Auth is still running** — 66 users, 66 identities, 75 live sessions, none of it used since the `pow_session` migration. Disable every provider in the dashboard, then `delete from auth.sessions;` (cascades to `refresh_tokens`). Order matters: providers first.
- **Tell Lots.** His articles were earning to an abandoned wallet; he may want to check whether that key is recoverable.

### Priority 3 — performance

At 10.6 MB the whole database fits in memory several times over. Index choice barely matters; **query count is the only real lever.**

- **Collapse round-trips.** The ~16 sequential calls behind the feed are the latency. A Postgres view or RPC returning the whole feed payload turns 16 round-trips into 1. This is worth more than every index change combined.
- **`comments_parent_id_idx` and `comments_parent_txid_idx` — zero scans in 118 days.** Both threading indexes are cold, which means thread loading isn't using either. `EXPLAIN ANALYZE` the query that loads a comment thread. Two redundant indexes on the same relationship also suggests one predates the txid model.
- **`posts.search_tsv` exists** — confirm there's a GIN index on it and that `/search` actually uses it, rather than falling back to full-database `ilike`. An unindexed `ilike '%term%'` seq-scans every post.
- **`accounts_display_handle_trgm_idx` — zero scans.** Probably correct at current row counts (planner prefers seq scan on small tables), but verify the query can use it at all: an index on `display_handle` will never serve a predicate on `lower(display_handle)`.
- **`agent_queue` is 304 KB for 17 rows** (~16 KB/row). Either large JSON payloads or unvacuumed churn. Not urgent.

### Priority 4 — optional guardrail

A weekly `pg_cron` job running the split-identity detector, writing hits to a table. `pg_cron` is already installed.

```sql
select c.id as account_id, c.display_handle, a.id as linked_author, o.id as orphan_author
from public.accounts c
  join public.authors a on a.id = c.author_id
  join public.account_addresses ad on ad.account_id = c.id and ad.is_primary
  join public.authors o on replace(o.xec_address,'ecash:','') = replace(ad.address,'ecash:','')
where replace(a.xec_address,'ecash:','') <> replace(ad.address,'ecash:','');
```

### Priority 5 — product

Two of three agents have never run: `agent_curator_queue` and `agent_herald_draws` are both empty. `agent_runs` has 414 rows and `agent_spend_log` 105, so agent0 is doing all the work. "The agents aren't adding value" may really be "two of them were never wired up."

If they are wound down: stop the workers and revoke `agent_worker` grants. **Do not drop the tables** — `agent_spend_log` is a financial record, and AI_SATOSHI is a deployed author with published articles carrying earnings.

---

## Reference

### Identity model

```
account_addresses.address  →  accounts.id  →  accounts.author_id  →  authors.xec_address
   (auth-verified,              (display layer:      (NULLABLE)          (payout address)
    kind = wallet|pocket)        handle, color)
```

- `authors` is load-bearing: `xec_address` (payout), `bio`, `is_admin`, `is_ai`.
- `accounts.author_id` is nullable — accounts can exist before an author does.
- `account_links` (`cluster_id`) exists but is empty. Unused scaffold.
- Counts: 156 authors, 114 accounts, 132 addresses (115 wallet + 17 pocket).
- 43 authors have no account; 1 account has no author.

### Where addresses are stored

`posts` has **no** address column — article payouts resolve at read time from the author row. The feed layer freezes addresses per row instead:

`feed_posts`, `comments`, `feed_events` → `payer_address` + `payout_address`
`agent_curator_queue`, `agent_patron_queue` → `author_address`
`claim_grants` → `claimed_address` · `pending_mints` → `buyer_address`, `payer_address`
`unlocks` → `payer_address` · `pocket_wallets` → `address`

### Diagnostic queries worth re-running

```sql
-- unprotected tables
select tablename from pg_tables where schemaname='public' and not rowsecurity;

-- permissive policies granted to anon
select tablename, policyname, cmd, qual::text, with_check::text
from pg_policies where schemaname='public' and roles::text like '%public%';

-- tables being scanned end-to-end
select relname, seq_scan, seq_tup_read, idx_scan,
       seq_tup_read / nullif(seq_scan,0) as avg_rows_per_seq_scan
from pg_stat_user_tables
where schemaname='public' and seq_scan > 0
order by seq_tup_read desc limit 25;
```

Note: `pg_stat` counters had not been reset in 118 days at time of audit, so zero-scan readings were meaningful rather than artifacts. Unique-constraint indexes legitimately report zero scans — enforcement doesn't increment `idx_scan`.
