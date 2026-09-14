# POW token migration + growth-incentive program — build plan

Migrate the original **POW SLP** token (1,000,000 supply, 0 decimals) to a new
**POW ALP** token, then use a capped pool to grow Proof of Writing: a time-released
incentive that rewards bringing in *real* new users, backed by real demand for the
token (POW-spent-on boosts + handle mints, recycled back into the reward pool).

This is a spec to build from, grounded in primitives this repo already has. It
can live in this repo (reusing them directly) or a sibling app that imports the
same libs.

> Structure: **Part A** (§1–7) is the SLP→ALP swap — self-contained and buildable
> on its own. **Part B** (§8–9) is the demand + growth-incentive design that spends
> the 600M pool over time. §10–13 (security, reuse, phases, decisions) cover both.
> Build A first; B can follow.

---

## 1. Principles (the decisions already made)

- **New token: 1,000,000,000 POW (ALP), 2 decimals, fixed supply forever.** Mint
  the full 1B at genesis, then **burn the mint baton** — no more can ever be made.
- **Swap ratio 1 : 1000** (1 old whole token → 1000 new whole tokens). Uniform for
  everyone, so proportional ownership is preserved — nobody is diluted by the change.
- **Two audiences, one fixed 1B:**
  - **400M — perpetual swap reserve.** The ~400K tokens given away over the years
    are the only ones in other people's hands, so the swap can *only ever* pay out
    400M. Original holders trade old→new anytime, **no deadline**.
  - **600M — growth-incentive pool.** Corresponds to the ~600K the founder still
    holds. NOT given away at once: **time-released** (e.g. ~100M/quarter for ~5–6
    quarters) as a standing incentive to attract real new users, so awareness of
    "earn POW on POW" compounds as it rolls out. See Part B (§8–9).
- **Burn on swap.** Every old SLP received is **burned on-chain**, so each new ALP
  in circulation is matched by an old token provably destroyed. The old token's
  supply becomes a live "how much is left to migrate" gauge.
- **Burn the founder's own ~600K old SLP up front**, so the only tokens that can
  ever be swapped are the ones actually given to the community.
- **Not atomic, and that's fine.** eCash has no native atomic token-for-token
  swap. The service takes brief custody of the SLP, sends ALP, burns the SLP.
  Finality-gating + an idempotent reconciler make it safe and reliable. It is a
  trust-in-the-operator flow, appropriate for a founder-run migration.

### Unit math (exact, integer — no rounding)
- Old: 0 decimals → 1 whole token = **1 atom**.
- New: 2 decimals → 1 whole token = **100 atoms**. 1B whole = **100,000,000,000 atoms**.
- Swap: `newAtoms = oldAtoms * 1000 * 100 = oldAtoms * 100000`.
  - e.g. deposit of 250 old → 250 × 100,000 = 25,000,000 atoms = 250,000 new whole.

---

## 2. One-time setup (before anything goes live)

1. **Genesis the ALP token** (see §3) from a dedicated **treasury wallet**. Mint
   the full 1B to treasury; keep the baton output only long enough to confirm the
   amount, then **burn the baton** in a follow-up tx (or omit the baton at genesis
   entirely for a hard cap — simplest and strongest signal).
2. **Split treasury conceptually** (same wallet, tracked in the DB, or two wallets
   for cleaner separation):
   - `swap_reserve` = 400M — funds outgoing swap sends (Part A).
   - `incentive` = 600M — funds the quarterly growth incentive, and receives
     recycled POW from boosts + handle mints (Part B).
   Two separate wallets is cleaner for accounting and blast-radius; one wallet with
   DB-tracked buckets is simpler. **Recommend two wallets.**
3. **Burn the founder's ~600K old POW SLP** (a burn tx from the wallet that holds
   them). After this, on-chain old-POW supply ≈ 400K.
4. **Fund XEC** in the swap wallet: every ALP send costs a small fee + a 546-sat
   dust output, and every SLP burn costs a small fee. Budget for thousands of
   sends/burns and monitor the balance.
5. **Publish the token doc** (genesis `url`) so wallets/explorers show provenance —
   point it at a page describing the migration.

### Key handling
The swap wallet is a **hot wallet holding 400M ALP**; the gift wallet holds 600M.
Treat both keys with the same care as the existing mint wallet (server-side env
secret, never in the client bundle). Consider a per-tx sanity cap in code (e.g.
refuse any single swap that would send more ALP than the largest plausible holder)
as defense-in-depth.

---

## 3. ALP genesis parameters

Built with `ecash-lib` `token/alp` genesis + `ecash-wallet`'s
`wallet.action({...}).build()` (same builder path as
[lib/mintProcessor.ts](../lib/mintProcessor.ts)).

| Field | Value |
|---|---|
| protocol | ALP (eMPP OP_RETURN) |
| tokenTicker | `POW` |
| tokenName | `Proof of Writing` (or as desired) |
| url | `https://proofofwriting.com/pow-token` (migration page) |
| decimals | `2` |
| genesis mint amount | `100000000000` atoms (= 1,000,000,000 whole) → to treasury |
| mint baton | **none** (hard cap) — or mint one then burn it immediately |

Record the resulting **ALP tokenId** in config/env; every send references it.

Also record the **old SLP tokenId** of POW — the swap route validates deposits
against it exactly, so a different token sent in is never credited.

---

## 4. Data model

Two tables, RLS enabled, **no policies** (service-role only — repo convention, see
[CLAUDE.md](../CLAUDE.md)). New file: `sql/pow_migration.sql`.

### `pow_swaps` — one row per inbound deposit (idempotency anchor)
```sql
create table pow_swaps (
  deposit_txid    text primary key,              -- the holder's SLP send; the idempotency key
  sender_address  text not null,                 -- ecash: first-input address of the deposit
  old_atoms       bigint not null,               -- SLP atoms received (0-decimal → whole tokens)
  new_atoms       bigint not null,               -- old_atoms * 100000
  status          text not null default 'detected',
    -- detected -> verified -> alp_sent -> burned -> done ; or failed_* 
  alp_send_txid   text,                           -- outgoing ALP send
  slp_burn_txid   text,                           -- the burn of the received SLP
  detected_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  error           text
);
create index pow_swaps_status_idx on pow_swaps (status) where status <> 'done';
```

The **Part B** tables (`pow_boosts`, `pow_reward_epochs`, `pow_reward_claims`) live
in the same `sql/pow_migration.sql` and are described where they're used (§8.1,
§9.2). The `pow_reward_claims` shape mirrors `pow_swaps`' idempotent
deliver+reconcile pattern (unique key per (epoch, account), compare-and-set on
`send_txid`).

---

## 5. Swap flow — `POST /api/pow-swap`

Mirrors the existing **verify → gate finality → deliver → record** pattern
([lib/verifyPaymentUnlock.js](../lib/verifyPaymentUnlock.js) for verify/sender
extraction, [lib/ecash/finality.ts](../lib/ecash/finality.ts) for the gate,
[lib/mintProcessor.ts](../lib/mintProcessor.ts) for build/broadcast).

**Trigger — server-driven, not page-driven.** The swap must complete whether or
not anyone has the site open, so detection lives on the server, not in a browser:

- **Primary:** a server-side Chronik websocket subscription on the swap address
  (same [watchPaymentAddress.ts](../lib/ecash/watchPaymentAddress.ts) primitive,
  run server-side) fires the swap on any inbound tx — within ~1s of the deposit.
- **Backstop:** the cron reconciler (§7) sweeps the address for any POW SLP UTXO
  with no `pow_swaps` row and processes it. This alone is sufficient for
  correctness; the ws is just the fast path.
- **Optional accelerant:** when a *logged-in* user has the explainer page open, the
  page MAY POST `{ txid }` on its own ws detection to nudge an immediate run. It is
  never required, and the server **never trusts it** — it re-fetches and
  re-validates everything from Chronik regardless.

The invariant: a holder can send POW from any wallet, with no proofofwriting tab
open ever, and still get their ALP back within seconds (ws) or by the next cron
tick (backstop).

Steps (all idempotent, keyed on `deposit_txid`):
1. **Fetch the tx** from Chronik. Reject if not found.
2. **Validate token + amount:** the tx must have an output to the swap address
   carrying the **old POW SLP tokenId**; sum those atoms → `old_atoms` (> 0).
   Ignore non-POW tokens and plain XEC (see edge cases).
3. **Extract sender:** the first input's `outputScript` → `ecash:` address
   (`encodeOutputScript`, exactly as `verifyPaymentUnlock` does). This is the ALP
   return address.
4. **Upsert** `pow_swaps` (`deposit_txid` PK) as `detected`. If the row already
   exists and is past `alp_sent`, **return its result** (idempotent replay).
5. **Gate finality:** `isTxFinal(deposit_txid)` must be true. If pending, leave the
   row `detected`/`verified` and return "pending" — the reconciler retries. (This
   is the double-spend defense: never send ALP against a reversible deposit.)
6. **Send ALP:** `new_atoms = old_atoms * 100000`, from the **swap wallet** to
   `sender_address`. Record `alp_send_txid`, status → `alp_sent`. Guard against
   double-send: only send if `alp_send_txid` is null (compare-and-set in DB).
7. **Burn the received SLP:** spend the deposited SLP UTXO(s) with no matching SLP
   output (SLP Type-1 burn). Record `slp_burn_txid`, status → `burned` → `done`.
   The burn is **not** a value-delivery step, so it can lag/retry independently of
   the ALP send without risk.
8. Return `{ status, alp_send_txid, new_atoms }` for the client to show.

**Ordering note:** ALP send (step 6) is the promise to the user and happens first;
the burn (step 7) is bookkeeping and is allowed to trail. A crash between 6 and 7
leaves a `alp_sent` row whose SLP the reconciler burns later — never a lost swap
or a double-mint.

---

## 6. Client swap page — `/pow-swap` (a static explainer, not a tracker)

**Decision:** the page's job is to explain the swap and hand over the deposit
address. It does **not** need to launch Cashtab or track progress — the user's own
wallet is the proof. The ALP simply arrives back in the sending wallet within
seconds (the server worker in §5 does the work regardless of the page). This keeps
Phase 1 small and avoids depending on a Cashtab token-send *deep link*, which
doesn't reliably pre-fill on the web today (only the extension `sendToken` path or
a manual token-page send does — a Phase 2 concern, not needed here).

**What the page shows (all static / read-only):**
- What the migration is and why (gratitude token → durable ALP version), and that
  it's founder-run and safe to use.
- The **rate** (1 old POW → 1,000 new POW), both **token IDs**, and the **deposit
  address** with a **QR code** to scan from any eCash wallet.
- **Instructions:** "Send your original POW to this address from any eCash wallet.
  Your new POW arrives back in the *same* wallet within seconds. Your old tokens are
  burned in the process — no deadline, swap anytime."
- **Safety copy:** swap from a wallet you control (e.g. Cashtab), never an exchange;
  the ALP returns to the address the POW came from.

**Optional enhancement — logged-in status strip (fast-follow, not blocking):**
For a signed-in viewer only, show a small "your recent swaps" list. It works by
matching a deposit's `sender_address` against the account's proven addresses
([lib/accountUnlockAddresses.js](../lib/accountUnlockAddresses.js) — the same
all-addresses set used for unlock gates, incl. the Pocket), so no address entry is
needed. Anonymous users see none of this and just watch their wallet. This is the
*only* place `pow_swaps` is ever surfaced to a user; for everyone else the table is
purely the server's idempotency ledger (§4).

Expected wall-clock the user sees in their wallet: ws detect (~1s) + finality
(~2–3s) + ALP send (~1s) ≈ **4–6s**.

---

## 7. Reconciler — cron backstop

A cron entry (same shape as [lib/mintReconcile.ts](../lib/mintReconcile.ts), wired
into the existing feed-reconcile cron) that makes the swap crash-safe and covers
holders who closed the tab before delivery:

- **Find late-final deposits:** any `pow_swaps` in `detected`/`verified` whose
  deposit is now final → resume at step 6.
- **Complete half-done swaps:** `alp_sent` rows with no `slp_burn_txid` → burn.
- **Sweep the address:** scan the swap address for POW SLP UTXOs with **no**
  `pow_swaps` row (a holder who sent tokens without the page open) → create the
  row and process. This is what makes "no deadline" real — a deposit from years
  later still gets picked up and paid.
- **Retry-until-delivered**, never double-send (DB compare-and-set on the txid
  fields). Same guarantees as the mint reconciler.

---

# Part B — POW demand & the growth-incentive program

The 600M only drives growth if POW is *wanted*. So Part B has two halves: first
give POW **real utility** (things you spend it on), then **emit it to reward real
new users**. The design is a **circulating utility token, not a deflationary one**:
POW is earned for growth, spent on boosts + handle mints, and that spend **recycles
back into the reward pool** to be earned again. No burn-to-zero, no buyback, no
scarcity pump — value is anchored to what POW *does*. Start emission conservative;
the recycling loop then extends the runway without minting anything new.

## 8. The demand side — why anyone wants POW

Demand comes from **utility, not scarcity**: POW *does things you'd otherwise pay
XEC for* — it promotes your writing and mints your handle. That intrinsic use is a
healthier, more durable, and legally safer basis than a "number-go-up" story.
Tradability (the Cashtab **ALP AMM**) is just the *venue* that lets earners who
won't use their POW sell it to people who want to use it.

**Recycle, not burn (the core model).** Spent POW is **not destroyed** — it flows
back into the reward pool and is re-distributed. Earn POW (grow the community) →
spend POW (get seen / claim a handle) → it **refills the pool** → someone else
earns it → … A closed loop: POW circulates forever, its velocity *is* platform
activity, and it never depletes. Burning-on-use would be self-defeating here — a
fixed supply burned as it's spent means success consumes the token, and deflation
makes people *hoard* rather than spend the very sinks you want used. (An optional
*small* burn fraction — say 5–10% of spend — is fine for a mild scarcity tilt; the
default is recycle.)

Two utility sinks feed that loop:

### 8.1 Boost sink — "spend POW to promote a post"
Grounded in the existing ranker ([lib/feedRanking.js](../lib/feedRanking.js)): the
whole feed score is expressed in **"equivalent hours newer than it really is"** —
`score = breadthBoost + convoBoost + exploreBoost − ageHours`, every term **bounded
and saturating** so nothing dominates. The boost lives in that same currency:

- Add a **`boostBoost`** term:
  `BOOST_MAX_HOURS × saturate(powSpent, BOOST_K) × decay(boostAgeHours)`.
  - `saturate()` (the repo's existing log/diminishing helper) → a whale **can't buy
    unlimited rank**; matches the anti-whale philosophy of the other terms.
  - `decay()` over the purchased window (e.g. 24–72h) → you buy a **window** of
    elevated placement, not permanence.
- `BOOST_MAX_HOURS` is bounded like the other ceilings, so a boosted post **rises
  but can't bury the organic feed or pin forever**, and it's still subject to
  `spreadAuthors` (no single author dominates).
- **Label the card "Boosted"** — honest paid placement. Hidden paid ranking erodes
  trust; a visible label is the classy version and keeps the organic feed credible.
- **Front page:** optionally ONE labeled "Promoted" slot (the premium inventory).
  Keep it to a single slot so it stays tasteful.
- **Storage:** a `pow_boosts` table (post txid, account, `pow_atoms`, `boost_txid`,
  `started_at`, `expires_at`). The ranker reads *active* boosts for the window in
  one lookup (same shape as the engagement-signal RPC) and folds `boostBoost` in.
- **Pricing:** start **flat tiered** (Bronze/Silver/Gold = higher ceiling + longer
  window), priced in POW. No auctions in v1 (complexity); revisit once POW's value
  settles.
- **Spent POW is RECYCLED** into the reward pool (§9.2), not burned — so promoting
  a post funds the next wave of growth rewards instead of shrinking the supply.
  (Optionally burn a small fraction for a mild scarcity tilt; recycle the rest.)
- **Anti-abuse:** boosting buys *placement only*, never organic rank — self-dealing
  engagement still fails the cluster filter. Boosting your own post to farm rewards
  doesn't pay, because rewards are tied to *others'* real activity (§9.1), not to
  reach you bought.

### 8.2 Handle-mint sink — "mint your handle with POW"
The second use: let POW pay for handle NFT mints (which today cost XEC). This gives
POW a concrete second reason to exist and ties it to the identity system.

- **Keep the XEC path — add POW as an alternative or a discount**, not a full
  replacement. Handle-mint XEC is real platform revenue; going POW-only forfeits
  it. Options: pay in XEC *or* POW; a POW discount on the XEC price; or POW unlocks
  a special tier. Decide consciously (§13) — this trades cash revenue for token
  utility.
- **Spent POW recycles** into the reward pool, same as boosts.
- Reuses the existing mint pipeline ([lib/mintProcessor.ts](../lib/mintProcessor.ts))
  — only the *payment* leg changes (accept a POW send instead of / alongside XEC).

### 8.3 The recycling loop — why it's sustainable (not deflationary)
POW spent on boosts (§8.1) and handle mints (§8.2) returns to the **reward pool**
that funds the growth incentive (§9.2). So the token is a **circulating internal
economy**, not a shrinking asset:

> **Earn POW by growing the community; spend it to get seen and to claim a handle;
> it refills the pool and is earned again.**

This is deliberately **not** a buyback/value-accrual design. An earlier draft
proposed buying POW with fee revenue and burning it — dropped, because that
optimizes *holder price* (a store-of-value / investment framing), which is not the
goal and is the piece most likely to draw securities scrutiny. POW's value is
anchored to **what it does** (≈ the XEC it saves you to boost/mint), which the AMM
prices naturally. Two benefits of recycling over emitting-only: the pool is
**self-sustaining** (spending refills it) and the incentive **runway extends past
the initial 600M** without minting anything new (supply stays fixed at 1B).

---

## 9. The growth-incentive engine (spending the 600M)

Goal (stated): **real new users, pure growth — not one person with 1000 accounts.**

### 9.1 Referral engine — sybil-resistant by construction
- **Link:** `/?ref=<handle|code>`; on a new account's first login, record
  referrer↔referee once (immutable).
- **Reward on the referee's real ECONOMIC ACTIVITY, not their existence.** The
  referrer earns POW proportional to value the referee genuinely generates — a cut
  of platform fees from the referee's unlocks/posts, or POW scaled to XEC the
  referee actually spent — and only after the referee crosses a **qualification
  threshold** (real spend / got paid-read by others / held N days).
- **Why it's sybil-proof:** 1000 empty alts generate zero activity → zero reward.
  1000 *active* alts must spend real XEC (mostly flowing to authors + your 6% fee)
  to qualify → farming is unprofitable, or it actually funds the platform. No
  proof-of-personhood needed — pay-to-act makes faking a real user cost about as
  much as being one.
- **Reuse the anti-gaming infra:** `account_links` clusters +
  [sql/feed_engagement_signal.sql](../sql/feed_engagement_signal.sql)'s "filter
  before the tally." A referee in the **same cluster** as the referrer (an alt) is
  filtered exactly like a self-tip — self-referral earns nothing. Already built.
- **Caps:** per-referrer per-quarter cap; exclude `is_ai` accounts.

### 9.2 Quarterly emission + claim
- **The reward pool** is the `incentive` wallet's balance: seeded by the 600M, then
  **topped up by recycled POW** from boosts + handle mints (§8.3). Early quarters
  draw mostly on the 600M; as usage grows, recycling carries more of the load, so
  the program can outlast the initial pool without minting anything new.
- **Fixed budget per quarter** (~100M, or "pool balance ÷ remaining quarters"),
  split **pro-rata by each participant's referral+activity score that quarter**,
  weighted heavily toward qualified referrals (the growth goal).
- **Self-balancing flywheel:** fewer participants → bigger per-person rewards
  (front-loads early adopters); auto-scales down as the crowd grows.
- **Per-account cap** (e.g. ≤2–3% of the quarter's budget) so **newcomers can win
  and whales can't vacuum it** — essential, or new users conclude they can't win
  and don't play. (Your data: top-5 accounts = 63% of unlock spend, so an uncapped
  spend-weighted split would be whale-dominated.)
- **Claim page each quarter** ("claim your Qn POW"). For a *recurring growth*
  incentive the claim IS the mechanism — it pulls people back to the site every
  quarter, which is the whole point. (Contrast the one-time-gratitude case, where a
  silent push was better.) Unclaimed rolls forward.
- **Snapshot** the quarter's *realized* activity; announce criteria in advance,
  reward on real (not promised) activity → can't be farmed ahead of the reveal.
- **Data:** `pow_reward_epochs` (quarter, budget, status) + `pow_reward_claims`
  (epoch, account_id, allocation, status, send_txid, to_address). Same idempotent
  deliver + reconciler as the swap.

### 9.3 Framing & risk — read before launch
- Keep the public framing **utility + gratitude** ("use POW to get seen and to mint
  a handle; earn it by growing the community"), **not** "buy POW and profit."
  Recycling (vs. buyback/burn) keeps the design on the utility side of that line —
  there's no mechanism engineered to enrich holders. *Not legal advice* — a quick
  lawyer check on the token framing before public launch is still worth it.
- **Seed AMM liquidity** (POW+XEC) or the market is unusably thin/volatile early.
- **Don't over-engineer for ~200 users.** The MVP that creates real pull is just
  boost-to-promote (§8.1) + handle-mint-with-POW (§8.2) + the referral emission
  (§9.1–9.2), all feeding the recycling loop (§8.3). Perks/governance later, if ever.

---

## 10. Security & edge cases

- **Wrong token / XEC / dust sent to the swap address:** validated out in step 2
  (only the exact old POW tokenId credits). Decide a policy for non-POW arrivals:
  ignore (default) or manual refund. Document it on the page.
- **Sender is an exchange / multi-party wallet:** ALP returns to the first-input
  address, which may not be theirs. Page copy: "swap from a wallet you control
  (Cashtab), not an exchange."
- **Partial sends:** fully supported — ALP is proportional to atoms received.
- **Replay / double-report:** `deposit_txid` PK + compare-and-set on send/burn
  fields make every step idempotent.
- **Finality never reached (stuck/orphaned deposit):** row stays pre-`alp_sent`;
  never pays out. Reconciler keeps re-checking; add an alert if a deposit sits
  non-final beyond N minutes.
- **Swap reserve exhaustion:** impossible if the founder's 600K were burned and
  only 400K remain outstanding (≤ 400M payout). Monitor the swap wallet balance
  anyway and alert well before empty.
- **Hot-wallet compromise:** biggest real risk. Keep keys server-side only,
  per-tx caps, balance monitoring/alerts, and consider keeping only a working
  float in the swap wallet with periodic top-ups rather than all 400M hot at once.

**Part B additions:**
- **Referral farming:** neutralized by rewarding on referee *activity* + cluster
  filtering (§9.1); still cap per-referrer per-quarter and alert on anomalies.
- **Boost gaming:** boosting buys placement, not organic rank; self-engagement
  still fails the cluster filter (§8.1). Always render the "Boosted" label.
- **Recycle accounting:** spent-POW must actually land back in the `incentive`
  pool (§8.3); track recycled-in vs. rewarded-out so the loop is auditable and the
  pool can't silently drain. If you keep a small burn fraction, publish those txids.
- **Pool runway:** watch pool balance vs. remaining planned quarters; recycling
  should carry more of the load over time, but hold emission back if it lags.

---

## 11. Reuse map (what's already here)

| Need | Existing primitive |
|---|---|
| Detect an on-chain deposit fast | `lib/ecash/watchPaymentAddress.ts` |
| Avalanche finality gate | `lib/ecash/finality.ts` (`isTxFinal`) |
| Extract sender address from a tx | `lib/verifyPaymentUnlock.js` (`encodeOutputScript`) |
| Build + broadcast token txs | `ecash-wallet` `action().build()`, per `lib/mintProcessor.ts` |
| ALP genesis/mint/send + SLP parse/burn | `ecash-lib` `token/alp`, `token/*` |
| Idempotent deliver + retry reconciler | `lib/mintProcessor.ts` + `lib/mintReconcile.ts` |
| Cashtab pay UX (extension + web fallback) | `lib/ecash/cashtabPay.ts` |
| Service DB (service-role only) | `lib/db.ts` `adminDb` |
| Logged-in account + primary address | `lib/authHelpers.ts` `getAuthedAccount` |

---

## 12. Build phases

**Part A — migration (ship first, self-contained):**
1. **Token:** genesis 1B ALP (2 dec, no baton); burn the founder's 600K old SLP;
   fund XEC; record both tokenIds. *(On-chain, one-time.)*
2. **Swap core (the essential part):** `sql/pow_migration.sql`; the
   verify→finality→send→burn logic; a **server-side ws watcher** on the swap
   address + the reconciler entry (§5, §7) so swaps complete with no page open;
   `/api/pow-swap` as the shared handler + optional logged-in accelerant. Test on a
   tiny amount end-to-end.
3. **Explainer page:** static `/pow-swap` — rate, token IDs, deposit address + QR,
   instructions, safety copy (§6). Optional logged-in "recent swaps" strip as a
   fast-follow.
4. **Ops:** balance/finality monitoring + alerts; a public migration page at the
   genesis `url` explaining the 1:1000 swap.

**Part B — demand + growth (follows):**
5. **Demand MVP:** boost-to-promote (§8.1) — `pow_boosts` table, the `boostBoost`
   ranker term + "Boosted" label, a Cashtab pay-in-POW flow whose POW lands in the
   `incentive` pool (recycle). Seed AMM liquidity.
6. **Handle-mint-with-POW (§8.2):** accept a POW send as payment (or discount) on
   the existing mint path; recycled to the pool. *(Decide XEC-or-POW first, §13.)*
7. **Referral + emission (§9):** `/?ref=` capture; `pow_reward_epochs` /
   `pow_reward_claims`; quarterly scoring (cluster-filtered, capped); the
   per-quarter claim page; recycled-POW top-up accounting. Reuse the deliver+reconciler.

---

## 13. Open decisions (before build)

- **Boost pricing & tiers** (§8.1): flat tiers vs. later auction; exact
  `BOOST_MAX_HOURS` / window / POW prices (tune with the other ranker weights).
- **Handle-mint-with-POW** (§8.2): XEC-or-POW vs. a POW discount vs. a POW-only
  tier — how much XEC revenue you're willing to trade for token utility.
- **Recycle vs. small burn** (§8.3): recycle 100% of spend, or burn a small
  fraction (5–10%) for a mild scarcity tilt.
- **Referral reward basis** (§9.1): a cut of referee platform fees vs. POW scaled
  to referee spend; the qualification threshold; per-referrer cap.
- **Emission schedule** (§9.2): per-quarter budget, number of quarters, per-account
  cap %.
- **One wallet with DB buckets vs. separate wallets** (swap reserve / incentive).
  *(Rec: separate.)*
- **Where it lives:** a route set in this repo vs. a sibling app importing the libs.
- **What gives POW lasting value beyond the MVP sinks** (perks, governance) — later.
- **Exact ALP metadata** (tokenName, ticker casing, url target).
- **Legal review** of the token framing before public launch (lighter now that
  there's no buyback, but still worth a quick check).
