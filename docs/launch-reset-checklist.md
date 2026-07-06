# Launch reset checklist

Coordinated "fresh start" to run **right before official launch**. Destructive by
intent (we do NOT keep test feed data). Nothing here should be run until launch day.

> **Golden rule: articles are never touched.** Articles live in `posts` (+ `comments`,
> `unlocks`, `authors`). None of the feed tables reference them. The feed wipe below
> is scoped to `feed_*` only — do not include `posts`/`comments`/`unlocks` in any
> `TRUNCATE`.

---

## 0. Pre-flight (do these first, in order)

- [ ] Cashtab PR for the **POWR** LOKAD merged and live in a Cashtab release (so real
      posts are recognized from post #1). See `docs/cashtab-powr-integration.md`.
- [ ] New NFT genesis group created and its mint address wired into prod env.
- [ ] **Back up the DB** (Supabase → project → Database → backup / `pg_dump`) before
      any destructive step. Truncates are irreversible.
- [ ] Decide the identity-reset scope (section 2) — this is the one real judgment call.

---

## 1. Feed wipe (destructive — test posts discarded)

All feed tables key off `accounts(id)`; there are **no FK links between feed tables**
and **no FK from feed → articles**, so order among them is safe. `feed_reaction_counts`
is NOT a table (it's trigger-maintained counter columns on `feed_posts`, cleared when
`feed_posts` is truncated).

Run in the Supabase SQL editor:

```sql
-- Feed content + engagement. RESTART IDENTITY resets any serial counters;
-- CASCADE is belt-and-suspenders (feed tables have no children, but harmless).
TRUNCATE TABLE
  public.feed_events,
  public.feed_posts,
  public.feed_follows,
  public.feed_blocks,
  public.feed_notifications
  RESTART IDENTITY CASCADE;
```

- [ ] Ran the feed truncate above.
- [ ] Verified `SELECT count(*) FROM public.feed_posts;` → 0 (and feed_events → 0).
- [ ] Spot-check the site: feed is empty, **articles still load** (open a known
      `/posts/<slug>`), author profiles still render.

> On-chain note: the old PROW-tagged test txs remain on eCash forever — truncating
> only clears the app's view of them. That's expected; they become invisible orphans.

---

## 2. Identity reset (tie to the NFT group decision)

The new NFT genesis group means old handle NFTs (and the rows pointing at them) are
dead. Decide whether launch starts with a clean identity slate. These tables are the
shared identity layer feed + articles + mint all hang off of, so reset them **together**
or not at all — a partial reset leaves dangling references.

Handle / mint tables (safe to wipe if starting NFTs fresh — they don't hold articles):

```sql
-- Only if starting the handle/NFT world fresh at launch.
TRUNCATE TABLE
  public.handles,
  public.pending_mints,
  public.claim_grants,
  public.reserved_handles
  RESTART IDENTITY CASCADE;
```

- [ ] Confirmed the new NFT group is live before wiping `handles` (else nobody can
      re-mint).
- [ ] Decided on `accounts` / `account_addresses` / `authors`:
  - **Keep** if any real author/article should survive launch (articles reference
    `authors`/`accounts` — do NOT truncate these if you're keeping articles for real
    authors).
  - **Wipe** only if launch is a total clean slate with no pre-existing real authors.
  - ⚠️ `authors`/`accounts` are referenced by `posts` (articles). Truncating them with
    articles present orphans the articles. Default: **keep** unless you're sure.

> This section is deliberately conservative. If in doubt, keep identity tables and only
> wipe feed + handle/mint tables.

---

## 3. Flip the LOKAD to POWR (production only)

The encoder (`lib/feedProtocol.js`) defaults to the **testing** tag PROW (`50524f57`).
POWR is turned on by explicitly setting the env in production — so this is a
deliberate switch, not an accident of deploying.

- [ ] Production env: `NEXT_PUBLIC_POW_LOKAD_HEX=504f5752` (**POWR** — this is the flip).
- [ ] Test/staging env: leave `NEXT_PUBLIC_POW_LOKAD_HEX` unset (stays on PROW default).
- [ ] Deploy prod.
- [ ] Post one real test post in prod, confirm it's tagged POWR (decode its OP_RETURN)
      and that Cashtab shows the "Proof of Writing" label + link.

---

## 4. Post-launch smoke test

- [ ] New post → appears in feed, verifies, tagged POWR.
- [ ] Reply/quote/like → recorded, Cashtab shows the correct label + "Replying to" link
      resolving to `proofofwriting.com/posts/<txid>`.
- [ ] Mint a handle on the new NFT group → card hosts + Cashtab icon registers.
- [ ] Articles unaffected throughout.

---

## Table reference (what's what)

| Purpose | Tables | Launch action |
|---|---|---|
| **Articles (protect!)** | `posts`, `comments`, `unlocks` | never touched |
| Feed content/engagement | `feed_posts`, `feed_events`, `feed_follows`, `feed_blocks`, `feed_notifications` | wipe |
| Handle / mint | `handles`, `pending_mints`, `claim_grants`, `reserved_handles` | wipe if new NFT group |
| Shared identity | `accounts`, `account_addresses`, `authors` | keep unless total clean slate |
