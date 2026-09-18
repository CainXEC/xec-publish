# POW utility & weekly rewards — build plan

Give the existing **POW token** real use on Proof of Writing, and distribute the
founder's held POW as **weekly gratitude rewards** tied to genuine platform
activity. This is a spec to build from, grounded in primitives this repo already
has (the handle-mint pipeline, Chronik finality gating, the idempotent
deliver+reconcile pattern).

> **Decision log (why this doc changed shape):** it began as an SLP→ALP *migration*
> plan. On inspection that migration buys nothing POW doesn't already have, so it's
> **dropped** — see §1. What remains is the part that always mattered: POW's utility
> (mints now, boosts later) and a weekly reward program. The filename is kept only
> to preserve links; this is no longer a migration doc.

---

## 1. Token basis — keep the existing SLP POW (NO migration)

On-chain facts (verified via Chronik, 2026-09):

| Property | Value |
|---|---|
| tokenId | `f36e1b3d9a2aaf74f132fef3834e9743b945a667a4204e761b85f2e7b65fd41a` |
| type | **SLP Type 1 (fungible)** |
| decimals | **0** (1 whole token = 1 atom) |
| genesis | block 685,949 — **2021-05-11** |
| circulating | **~982,595** across ~2,129 UTXOs |
| **mint baton** | **none live** — supply is **provably capped forever** |
| distribution | ~400K given away over the years; ~582K held by the founder |

**Why no migration.** Everything a new-token migration would buy, POW already has:
- *Provable hard cap* — no live baton means no one, including the founder, can ever
  mint more. Already true.
- *Tradability* — SLP Type 1 fungible qualifies for Agora **partial** offers
  (verified in `ecash-agora`), the same liquid trading an ALP token gets.
- *On-platform utility* — the mint/boost payment flows accept an SLP POW send just
  as easily as they would ALP (§3).

ALP's only genuine extra (multi-token atomic actions / pooled AMM) isn't something a
**gratitude token** needs, and a migration would cost a swap service, a hot wallet,
operator trust, and burning ~982K tokens across 2,129 UTXOs — real cost for no
benefit. **Decision: keep POW exactly as it is.** The earlier swap toolkit
(`lib/ecash/powToken.ts`, `scripts/alp-dryrun.ts`) and deep-link spike stay in the
tree as scratch, not on the build path.

Config: `POW_TOKEN_ID=f36e1b3d…41a` (server env).

---

## 2. What we're building (and in what order)

- **Phase 2a — accept POW for handle mints** (the demand sink). §3.
- **Phase 2b — weekly POW gratitude rewards** tied to platform fees. §5.
- **Deferred — boosts** (spend POW to promote a post): §4. Wait until the feed is
  busy enough that placement is actually scarce.

Build 2a first (it creates a reason to *want* POW), then 2b. Boosts whenever
activity justifies them.

---

## 3. Accept POW for handle mints (Phase 2a)

Adds a POW payment option beside the existing XEC one on the handle-mint flow. The
entire **delivery** pipeline ([lib/mintProcessor.ts](../lib/mintProcessor.ts)) is
unchanged — only the *payment* leg gains a POW path.

### Pricing (by decree — POW has no market price)
POW is 0-decimal, so a price is a whole-token count (= atoms):

| Handle | Chars | XEC price (unchanged) | **POW price** |
|---|---|---|---|
| base | 11–15 | 10,000 XEC (~$0.05) | **10 POW** |
| mid | 6–10 | 100,000 XEC (~$0.50) | **100 POW** |
| short | 1–5 | 1,000,000 XEC (~$5) | **1,000 POW** |

Keep the 1:10:100 ratio the XEC tiers already use. **Keep both payment paths at
parity** — no separate "POW discount" is needed, because paying in a token you
received for free *is* the discount. Base is deliberately cheap to **activate the
dormant airdrop** and pull gratitude-recipients into the identity system; short
stays a meaningful stretch.

### The one hard constraint → match by sender, not by tag
An **SLP token send uses the entire OP_RETURN** for its protocol script, so a POW
payment **cannot carry the `mintId` tag** the XEC path matches on
([app/api/mint/intent/route.ts](../app/api/mint/intent/route.ts) line ~97). So POW
mints **require login** and match an incoming payment to its intent by
**sender address ∈ the account's proven addresses**
([lib/accountUnlockAddresses.js](../lib/accountUnlockAddresses.js) — the same
all-addresses set, Pocket included, used by the unlock gates). This mirrors the XEC
flow's structure; only the match key changes (sender, not OP_RETURN tag).

### Flow
```
1. User (logged in) picks a handle, chooses "Pay with POW"
2. POST /api/mint/intent { handle, payWith:'pow' }
   → pending_mints row: pay_token='pow', expected_atoms=<price>,
     expected_payers=<account proven addresses>, status='pending'
   → returns a RAW token deep link (below)
3. User sends POW to the mint address
4. Detect the POW send to the mint address (SLP atoms + sender), match to a
   pending 'pow' intent by sender, atoms >= expected_atoms (a FLOOR)
5. Gate Avalanche finality (isTxFinal) — blocks double-spends
6. Mark 'paid' with payer_address → existing mintProcessor delivers the NFT there
```
Detection has the same two drivers as the XEC path: a ws/poll watch on the mint
address (fast) + the mint reconciler as the crash-safe backstop — each gains a
"POW token send, matched by sender" branch.

### Deep link (raw — the opposite of the XEC path)
POW is 0-decimal, so `token_decimalized_qty` is the whole-token count. The token
bip21 must be passed **raw, not URL-encoded** (confirmed against Cashtab's
`SendByUrlParams.test.js`; encoding drops the user on the plain XEC screen):
```
https://cashtab.com/#/send?bip21=<MINT_ADDRESS>?token_id=<POW_TOKEN_ID>&token_decimalized_qty=10
```
This is the **inverse** of the XEC intent link, which URL-encodes its bip21 (intent
route line ~121). **Add a loud code comment** so nobody "fixes" the token link by
encoding it. The amount is editable in Cashtab, but the server treats
`expected_atoms` as a floor (same `>=` discipline as the XEC path), so underpaying
just doesn't deliver.

### Where the received POW goes
It accumulates in the mint wallet, which **safely holds token UTXOs** — ecash-wallet
excludes them from XEC fuel (`spendableSatsOnlyUtxos`), so a normal mint tx can never
accidentally burn received POW. Later it can **top up the weekly reward pool** (§5) —
a recycle loop that extends the program's runway without touching the founder's
holdings.

### Edge case (paid from an unlinked wallet)
Login identifies the *account*; it doesn't say *which wallet the POW came from*. If a
user pays from a wallet their account never proved, sender-matching misses it — but
because they're logged in, resolving it is trivial: the client reports the txid
(Pocket/extension get it back), or the mint screen asks "paying from a different
wallet? paste the address," or the logged-in status shows "received X POW — claim
for @you?" Not worth per-intent HD deposit addresses unless volume ever demands it.

### Build list
1. **Pricing** — add POW tiers (10/100/1000 atoms) to
   [lib/handlePricing.ts](../lib/handlePricing.ts).
2. **Config** — `POW_TOKEN_ID` env; reuse the existing `MINT_PAYMENT_ADDRESS` to
   receive it.
3. **Intent route** — accept `payWith:'pow'`; require auth; store `pay_token`,
   `expected_atoms`, `expected_payers`; return the raw token deep link (no
   `op_return_raw`).
4. **Payment detection** ([lib/mintPayments.ts](../lib/mintPayments.ts)) — an SLP-POW
   reader (atoms + sender to the mint address) + a sender-based matcher, parallel to
   `satsToAddress` / `taggedMintId`.
5. **Reconciler** ([lib/mintReconcile.ts](../lib/mintReconcile.ts)) — map unclaimed
   POW sends to pending 'pow' intents by sender.
6. **`pending_mints`** — new columns `pay_token`, `expected_atoms`, `expected_payers`.
7. **UI** — a "Pay with POW (10/100/1000)" option beside XEC.

**Build it as a reusable `powPayment` module** (intent → detect → sender-match →
finality). Boosts (§4) reuse it verbatim.

---

## 4. Boosts — DEFERRED (spend POW to promote a post)

A boost buys *placement*, which only has value once the feed is busy enough that
being seen is scarce. At today's activity that's not true, so **don't build boosts
yet** — any price would be arbitrary. When the time comes:

- **Payment reuses the §3 `powPayment` primitive** — same POW send, sender-match,
  finality, floor, raw deep link, reconciler. Give boosts their **own receiving
  address** so a payment's destination already says "boost, not mint."
- **No on-chain delivery leg.** Verified payment just writes a `pow_boosts` row
  (post txid, account, atoms, started_at, expires_at); the feed ranker reads it. The
  whole back half of the mint flow disappears.
- **The only net-new work is the ranker** — a bounded, saturating `boostBoost` term
  in [lib/feedRanking.js](../lib/feedRanking.js) (expressed in the same "equivalent
  hours newer" currency as the other terms, decaying over the purchased window) +
  a visible **"Boosted"** label. Boosting buys placement, never organic rank, so
  self-dealing still fails the `account_links` cluster filter.
- Spent boost-POW recycles into the weekly reward pool (§5), same as mint-POW.
- First-cut price when it ships: ≈ one base handle (100 POW) for a 24h window, tuned
  against real traffic.

---

## 5. Weekly POW gratitude rewards (Phase 2b)

Spread the founder's ~582K held POW to the people who make PoW **more valuable to
others** — weekly, by a three-component **Contribution Score**, not raw spend.

### The metric — a three-component Contribution Score per ISO week
> Full design: the "POW Weekly Airdrop System" spec. Params live in the
> `pow_reward_config` table (edit → no deploy). Phase 1 is **built**
> ([lib/powRewards/score.ts](../lib/powRewards/score.ts),
> [freezeWeek.ts](../lib/powRewards/freezeWeek.ts)); Phase 2 (extra anti-gaming
> beyond clusters) and Phase 3 (impact multiplier, referrals, loyalty) are deferred.

```
Contribution = Economic×0.35 + Creation×0.35 + Engagement×0.30
```
Each component is normalized to its **share** of the week's total (so each dimension
controls exactly its weight of the pool), renormalized across active dimensions,
then a **10% per-user cap** (iterative redistribution), floor to whole POW, and the
round-up-of-the-leftover to the closest sub-1 accounts.

- **Economic = `sqrt(platform+mint XEC generated)`** — diminishing returns so a
  whale mint can't dominate. The XEC figure is the on-chain platform-fee + mint
  receipts attributed to the account (see below); author payouts excluded (only the
  platform's cut counts), 👎 downvotes excluded.
- **Creation** = per-action points (article/post/reply/quote/repost), each category
  **capped per week** (anti-spam).
- **Engagement** = cross-user interactions (unlock/reply/quote/repost/reaction),
  credited to BOTH the actor (participation) and the content owner (impact),
  **same-cluster excluded**, with a **repeat-counterparty decay** so breadth of
  genuine users beats hammering one account.

Everything keys on the **effective (cluster) account** and excludes is_ai + the
founder. Whales who only spend, spammers who only post, and alt-rings all fail to
dominate by construction.

**Economic XEC — how it's measured** (see [lib/powRewards/tallyWeek.ts](../lib/powRewards/tallyWeek.ts)):
scan the platform fee address (`PLATFORM_XEC_ADDRESS`) + mint wallet
(`MINT_PAYMENT_ADDRESS`) on-chain receipts for the week, attribute each to the
paying account by **sender → `account_addresses`** (Pocket-paid fees count),
**skipping token outputs** (a POW-paid mint's token/dust is never counted as XEC).
Reading receipts directly is exact (it's the platform's real cut) and unified —
no per-table split formulas to reconstruct or keep in sync.

### Allocation
```
yourPOW = weeklyPool × (yourContributionScore / Σ eligible ContributionScores)
          then capped at maxUserShare (10%), floored, leftover rounded up
```
Fixed weekly pool, pro-rata by **Contribution Score** (not raw fees). The 10% cap
redistributes any excess to the uncapped; the floored leftover rounds the closest
sub-1 accounts up to 1 (spread to more real participants).

### Weekly pool schedule (DECIDED)
| Period | Weekly pool |
|---|---|
| **September test (first ~2 weeks)** | **1,000 POW/week** |
| **October onward** | **5,000 POW/week** |

Start small to shake out the mechanics on real data, then step up. At 5,000/week the
runway from ~582K held is ~116 weeks (~2.2 yr) — a floor, since recycled mint/boost
POW (§3, §4) tops the pool up over time. The weekly pool is a config value, so
changing it later is a one-line edit.

### Anti-gaming (why the metric is sound)
- **Economic counts only platform-received XEC** (not gross volume, not author
  payouts), so circular transfers and collusion generate no economic score — you'd
  have to send real money to the *platform*. And `sqrt` means a whale mint can't buy
  the pool.
- The pool is **fixed and diluted**, POW has **no market price**, so farming is
  **negative-sum** (pay real XEC to earn a token worth ≤ what you paid).
- **Engagement excludes same-cluster interactions** and **decays repeated
  counterparties**, so an A↔B alt-ring earns almost nothing — breadth of genuine,
  independent users is what pays.
- **`account_links` cluster filter** collapses an alt-cluster to one participant;
  **`is_ai` house accounts and the founder excluded.**
- **10% per-user cap** as a final backstop.
- (Phase 2 adds circular-transfer / new-account / suspicion signals on top.)
- **The founder's own account is excluded from proration** — it neither earns a
  share nor counts toward `totalPlatformFeeSats` (the founder is the *source* of the
  pool, not a recipient). Config: a `POW_REWARD_EXCLUDED_ACCOUNTS` list.

### Payout — push, to the primary address
- **Push** POW to each account's **current primary address** (the DB primary, kept
  current across address changes). Every account has one (wallet-only auth); the
  Pocket is never a payout target, only an earning source.
- **Minimum payout = 1 POW (DECIDED).** POW is 0-decimal, so allocations are floored
  to whole tokens (1 POW is also the dust floor — never send less than a whole token).
- **The flooring leftover rounds up the closest sub-1 accounts (DECIDED).** Flooring
  every share leaves the pool under-distributed (sum of floors < pool). That leftover
  is handed out **1 POW each to the sub-1-POW accounts closest to 1** (largest
  fractional share first), until it runs out — rounding the most-shortchanged small
  accounts up to 1, so the full pool reaches **more** real participants rather than
  the whales. It's the least gameable option (a slot needs real fees, and slots are
  nearest-first and capped by the leftover). Anything still left after that (or a week
  with no sub-1 accounts) **rolls forward** as next week's carryover.
- **Batch SLP sends** (~19 token outputs per tx), so a few hundred recipients = a
  handful of txs.
- **No per-account cap for the September test weeks (DECIDED)** — run pure pro-rata
  first to see the real distribution. A ≤2–3% cap (so newcomers can win and a whale
  can't vacuum it — top-5 accounts = 63% of unlock spend) stays a one-line add to
  revisit before/at the October step-up.

### Who runs it
- **xec-publish computes + sends** — it has the DB, Chronik, the wallet, and SLP-send
  capability (the mint wallet already sends tokens). A **weekly cron** tallies the
  prior ISO week and batch-sends.
- **The herald (POW_AGENT1) announces** the weekly rewards — fits its curator persona
  and gives it a recurring public job.
- *Alternative:* if you want the herald wallet to be the on-chain sender, xec-publish
  exposes the allocation list via an `agent_worker` endpoint and the herald sends
  from its own wallet. Default: xec-publish sends, herald announces.

### Data model
- `pow_reward_epochs` — `(iso_week PK, pool_atoms, total_fee_sats, status,
  created_at)`.
- `pow_reward_claims` — `(epoch, account_id, fee_sats, allocation_atoms, to_address,
  send_txid, status)`, unique on `(epoch, account_id)`, **compare-and-set on
  `send_txid`** so a crash/retry never double-pays. Same idempotent
  deliver+reconcile pattern as the mint pipeline.

### Framing & risk
Keep the public framing **utility + gratitude** ("earn POW for being a real,
paying part of the community; spend it to mint your handle"), not "buy POW and
profit." There's no buyback/burn mechanism engineered to enrich holders. *Not legal
advice* — a quick counsel check on the token framing before a public push is still
worth it.

---

## 6. Data model (consolidated)

New file(s) under `sql/`. All tables **RLS enabled, no policies, service-role only**
(repo convention — see [CLAUDE.md](../CLAUDE.md)).

- `pending_mints` — add `pay_token`, `expected_atoms`, `expected_payers` (§3).
- `pow_reward_epochs`, `pow_reward_claims` (§5).
- `pow_boosts` — later, with boosts (§4).

---

## 7. Reuse map (what's already here)

| Need | Existing primitive |
|---|---|
| Handle-mint delivery pipeline | [lib/mintProcessor.ts](../lib/mintProcessor.ts) |
| Detect a payment to the mint address | [lib/mintPayments.ts](../lib/mintPayments.ts) |
| Avalanche finality gate | [lib/ecash/finality.ts](../lib/ecash/finality.ts) (`isTxFinal`) |
| Extract sender from a tx | `payerOf` in mintPayments / `encodeCashAddress` |
| All proven addresses for an account | [lib/accountUnlockAddresses.js](../lib/accountUnlockAddresses.js) |
| Idempotent deliver + retry reconciler | mintProcessor + [lib/mintReconcile.ts](../lib/mintReconcile.ts) |
| Build + broadcast token (SLP) txs | `ecash-wallet` `action().build()` |
| Anti-gaming clusters | `account_links` + [sql/feed_engagement_signal.sql](../sql/feed_engagement_signal.sql) |
| Feed ranker (for boosts) | [lib/feedRanking.js](../lib/feedRanking.js) |
| Logged-in account + primary address | [lib/authHelpers.ts](../lib/authHelpers.ts) |
| House-agent surfaces (herald) | `agent_worker` role + `/api/agent/*` |

---

## 8. Build phases

**Phase 2a — mint-with-POW (build first):**
1. Pricing (10/100/1000) + `POW_TOKEN_ID` env.
2. `pending_mints` columns; intent-route `payWith:'pow'`; raw token deep link.
3. POW payment detection + sender-matcher (the reusable `powPayment` module).
4. Reconciler branch. UI "Pay with POW" option. Test end-to-end on a tiny amount.

**Phase 2b — weekly rewards (follows):**
5. `pow_reward_epochs` / `pow_reward_claims`; the weekly fee-tally query
   (platform-received, downvotes excluded, cluster-filtered, `is_ai` excluded).
6. Weekly cron: compute allocations → batch SLP send (push to primary, min-payout
   rollover) → idempotent claims + reconciler. Herald announcement.

**Later — boosts:** `pow_boosts` + the `boostBoost` ranker term + "Boosted" label,
paying through the §3 `powPayment` primitive.

---

## 9. Decisions

**Locked for the September test:**
- **Weekly pool:** 1,000 POW/week for the ~2 September test weeks → **5,000/week from
  October**.
- **Per-account cap:** none for the test weeks (pure pro-rata); revisit a ≤2–3% cap
  before the October step-up.
- **Founder account excluded** from proration (source of the pool, not a recipient).
- **Minimum payout = 1 POW**; sub-1 shares and the flooring remainder roll forward.
- **Herald announces**; xec-publish computes + sends.
- **Downvotes (👎) excluded** from the fee base.

**Still open:**
- **October per-account cap** — decide before the step-up, once the test shows the
  real distribution.
- **Recycle timing** — when mint/boost-POW starts topping up the reward pool.
- **Handle-mint pricing feel** — start at 10/100/1000; raise later if too cheap
  (easy up, awkward down).
- **Legal framing check** before a broader public rewards push.
