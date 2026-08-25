// =============================================================================
//  lib/feedRanking.js  —  the thin ranking seam (candidate → rank → serve)
//
//  The feed is fetched in two stages so ranking can grow without touching
//  pagination:
//    1. CANDIDATES — getFeed.js keyset-paginates a time-ordered window of posts
//       (stable cursor on created_at, id). This is the "what could we show" set.
//    2. RANK       — rankFeedCandidates reorders that window before it's served.
//
//  Keeping the cursor time-based (not score-based) is deliberate: paging stays
//  correct and duplicate-free even as the ranker reorders WITHIN each window,
//  because the boundary between windows is always a timestamp, never a score.
//
//  WHY THIS RANKER IS DIFFERENT FROM A FREE PLATFORM'S. On this platform every
//  like, repost, reply, quote and tip is a PAID on-chain action, so engagement
//  isn't a cheap click — it's money someone chose to spend. That flips the whole
//  design: we don't optimize dwell time (there are no ads to sell), we optimize
//  for paid interactions people are glad they made. Two consequences drive the
//  score below:
//    • Breadth beats volume. How many DISTINCT people paid to support a post is
//      the highest-quality signal in social software and is mostly immune to the
//      bot/engagement-farming that free platforms fight — funding alt wallets
//      costs real fees. So distinct paying supporters is the biggest lever; raw
//      XEC amount is only a small, HARD-SATURATED secondary boost, so a whale
//      can nudge a post up a few slots but can never buy the top of the page
//      (that would be the plutocratic version of rich-get-richer).
//    • Protect the supply side. The feed literally decides who earns, so a frozen
//      leaderboard would starve new authors and collapse the paid model. A
//      decaying exploration boost gives every new post a shot at its first paid
//      signal, and an author-spread pass stops any one account walling off a page.
//
//  The self/linked-wallet discount that defeats self-dealing is NOT here — it's
//  applied upstream in the get_feed_engagement_signal RPC (see
//  sql/feed_engagement_signal.sql), which excludes gamed reactions (self/alt-ring)
//  AND house/AI-agent reactions (authors.is_ai) before they're ever tallied — so a
//  house "herald" gives real users visible reach without buying rank. This file
//  only consumes the already-clean signal.
//
//  Every term below is expressed as an "age bonus" in HOURS over a recency spine
//  (negative age), and each is bounded, so ranking stays recognizably
//  chronological: a lively post floats up a few slots, it never teleports a stale
//  post to the very top. Deterministic — no randomness — so the same window
//  always ranks the same way and pagination stays duplicate-free.
// =============================================================================

// Per-term ceilings, in equivalent "hours newer than it really is". These are the
// tunable weights of the model; they will change a lot early, so they live as
// named constants rather than being threaded through config (yet).
const BREADTH_MAX_HOURS = 18 // distinct paying supporters — the biggest lever
const AMOUNT_MAX_HOURS = 3 //   total XEC paid — deliberately small; anti-whale
const CONVO_MAX_HOURS = 4 //    replies + quotes — active discussion
const EXPLORE_MAX_HOURS = 4 //  brand-new posts — a shot at first impressions

// Exploration decays to zero over this window (hours). Kept short so it only
// helps genuinely BRAND-NEW posts get a first look; once a post is a couple of
// hours old it competes on paid support alone.
const EXPLORE_WINDOW_HOURS = 2

// Saturation constants (larger = slower to saturate). log1p growth means the
// first few of anything matter most, then diminishing returns.
const BREADTH_K = 3
const AMOUNT_K = 10 // large, so 1M XEC is louder than 100 but nowhere near 10,000x
const CONVO_K = 4

// Author-spread pass: no more than this many of one author's posts in a row, and
// no single author may occupy more than this fraction of a window. Bounds the
// payoff of gaming (and plain prolific posting) no matter the score.
const MAX_CONSECUTIVE_PER_AUTHOR = 1
const MAX_AUTHOR_SHARE = 0.4

// Mint announcements ride the feed as "the pulse between the beats", but they're
// SYSTEM noise (a bot's post), not content someone paid to support — so they're
// only woven while genuinely FRESH. Past this age they're dropped from the weave
// entirely: a quiet feed shouldn't leave a day-old "X minted Y" sitting near the
// top, and days-old mints shouldn't sprinkle through the timeline. (The buyer's
// own quote of their mint is real content and competes on its own.)
const MINT_MAX_AGE_HOURS = 12

/** Saturating map to [0, 1): log1p(x) / (log1p(x) + k). Zero at x=0. */
function saturate(x, k) {
  const v = Number.isFinite(x) && x > 0 ? x : 0
  const l = Math.log1p(v)
  return l / (l + k)
}

function toCount(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * A post's display score, higher = shown earlier. Recency is the spine (negative
 * age in hours); the paid-engagement terms add bounded, saturating bonuses.
 *
 * @param {object} post   A candidate row (carries created_at + denormalized
 *   reply_count/quote_count used for the conversation term).
 * @param {{distinctSupporters:number, totalAmountSats:number}} [signal]  The
 *   already-clean paid-engagement signal for this post (self/linked reactions
 *   already excluded by the RPC). Absent → breadth/amount contribute nothing and
 *   the score degrades gracefully to recency + conversation.
 * @param {number} nowMs
 */
function scorePost(post, signal, nowMs) {
  // Recency is keyed off the post's SURFACING time: for a resurfaced repost
  // rank_ts is the repost's timestamp (so it floats up as if new), otherwise it's
  // the post's own created_at.
  const created = new Date(post?.rank_ts ?? post?.created_at ?? 0).getTime()
  const ageHours = Number.isFinite(created) ? Math.max(0, (nowMs - created) / 3.6e6) : 0

  const distinctSupporters = toCount(signal?.distinctSupporters)
  const amountXec = toCount(signal?.totalAmountSats) / 100 // sats → XEC
  const conversation = toCount(post?.reply_count) + toCount(post?.quote_count)

  // Breadth: how many distinct paying supporters — the primary lever.
  const breadthBoost = BREADTH_MAX_HOURS * saturate(distinctSupporters, BREADTH_K)

  // Amount: total XEC, hard-saturated. A big tip is louder than a small one but
  // the ceiling (AMOUNT_MAX_HOURS) and large AMOUNT_K keep a whale from owning
  // the page — this is the anti-pay-to-win knob.
  const amountBoost = AMOUNT_MAX_HOURS * saturate(amountXec, AMOUNT_K)

  // Conversation: replies + quotes (paid discussion). Deliberately overlaps the
  // breadth tally — a reply is both support and a discussion signal.
  const convoBoost = CONVO_MAX_HOURS * saturate(conversation, CONVO_K)

  // Exploration: a brand-new post has no paid signal simply because no one's seen
  // it yet. Give it a decaying boost so it can earn a first reaction — but damp
  // it as soon as real supporters arrive (it no longer NEEDS impressions), and to
  // zero once it's older than the exploration window.
  const freshness = Math.max(0, 1 - ageHours / EXPLORE_WINDOW_HOURS)
  const exploreBoost = (EXPLORE_MAX_HOURS * freshness) / (1 + distinctSupporters)

  return breadthBoost + amountBoost + convoBoost + exploreBoost - ageHours
}

/**
 * Reorder a scored list so no author dominates: cap consecutive posts by the same
 * author and cap any author's share of the window. Greedy and deterministic —
 * walks the score-sorted list and, when the next-best post would break a cap,
 * defers it and takes the best-scored post from a different author instead;
 * deferred posts are re-slotted as soon as a cap allows. A permutation of the
 * input (never adds/drops rows), so the keyset cursor stays valid.
 */
function spreadAuthors(sorted) {
  const n = sorted.length
  if (n < 3) return sorted

  // At least 2 per author in tiny windows, so the cap never degenerates into
  // "one post per author" on a short page; on real ~25-post windows it's the
  // 40% ceiling that bites.
  const shareCap = Math.max(2, Math.floor(n * MAX_AUTHOR_SHARE))
  const authorOf = (p) => p?.author_account_id ?? '∅'

  const remaining = [...sorted] // already score-desc
  const out = []
  const placedByAuthor = new Map()
  let lastAuthor = null
  let consecutive = 0

  while (remaining.length > 0) {
    // Prefer the highest-scored remaining post that breaks no cap. Fall back to
    // the plain best (index 0) if every candidate is capped — a cap is a soft
    // preference, never a reason to drop a row.
    let pick = 0
    for (let i = 0; i < remaining.length; i++) {
      const a = authorOf(remaining[i])
      const placed = placedByAuthor.get(a) ?? 0
      const wouldRepeat = a === lastAuthor && consecutive >= MAX_CONSECUTIVE_PER_AUTHOR
      if (!wouldRepeat && placed < shareCap) {
        pick = i
        break
      }
    }

    const [post] = remaining.splice(pick, 1)
    const a = authorOf(post)
    out.push(post)
    placedByAuthor.set(a, (placedByAuthor.get(a) ?? 0) + 1)
    consecutive = a === lastAuthor ? consecutive + 1 : 1
    lastAuthor = a
  }

  return out
}

/**
 * Order a fetched window of candidate posts for display.
 *
 * @param {object[]} posts  Candidate rows, already newest-first from the DB.
 * @param {Map<string, {distinctSupporters:number, totalAmountSats:number}>} [signals]
 *   Per-post paid-engagement signal keyed by txid (from get_feed_engagement_signal).
 *   Omit it and the ranker degrades gracefully to recency + conversation.
 * @param {number} [nowMs]  Scoring timestamp. Callers that also weave mint rows
 *   pass one shared timestamp so both passes score against the same clock.
 * @returns {object[]} The posts in display order. A permutation of the input —
 *   never adds or drops rows, so the caller's keyset cursor (derived from the raw
 *   time order, before ranking) stays valid.
 */
export function rankFeedCandidates(posts, signals, nowMs = Date.now()) {
  const list = posts ?? []
  if (list.length < 2) return list

  const signalFor = (p) =>
    signals && p?.txid ? signals.get(p.txid) : undefined

  // Sort a COPY (never mutate the caller's array). Score desc; ties fall back to
  // created_at desc so ordering stays stable and newest-first among equals.
  const tsOf = (p) => new Date(p?.rank_ts ?? p?.created_at ?? 0).getTime()
  const scored = [...list].sort((a, b) => {
    const diff = scorePost(b, signalFor(b), nowMs) - scorePost(a, signalFor(a), nowMs)
    if (diff !== 0) return diff
    return tsOf(b) - tsOf(a)
  })

  return spreadAuthors(scored)
}

/**
 * Weave system mint-card rows into an already-ranked window. Mint announcements
 * don't COMPETE in the attention market — they're excluded from the candidate
 * window upstream and ride alongside as "the pulse between the beats": each
 * entry scores as pure recency (-age in hours) with NO engagement terms and NO
 * exploration boost (a bot post doesn't need a debut; the buyer's own quote of
 * it is the content that competes). A fresh mint therefore slots high the way
 * any brand-new unloved post would, then sinks — it can never outrank a post
 * with real paid signal, and it never consumes one of the window's ranked slots.
 * Two guards keep mints from becoming clutter: entries older than
 * MINT_MAX_AGE_HOURS are dropped (no stale/day-old mints), and a mint never takes
 * the very first slot (the feed always leads with real content).
 *
 * @param {object[]} posts  The ranked window (output of rankFeedCandidates —
 *   scored + author-spread). NOT mutated.
 * @param {object[]} mintEntries  Rows to weave, each carrying created_at (a full
 *   mint feed_posts row, or one synthetic digest object for a collapsed run).
 * @param {Map} [signals]  The SAME signal map the window was ranked with, so
 *   posts re-score to identical numbers here.
 * @param {number} [nowMs]  The SAME timestamp the window was ranked with.
 * @returns {object[]} One display list, posts' relative order untouched.
 */
export function weaveMintRows(posts, mintEntries, signals, nowMs = Date.now()) {
  const base = posts ?? []
  // Only weave FRESH mints — drop anything older than MINT_MAX_AGE_HOURS so a
  // quiet feed never surfaces a stale "X minted Y" (the reported 22h-old row) and
  // days-old mints don't sprinkle through the timeline.
  const entries = (mintEntries ?? []).filter((e) => {
    if (!e?.created_at) return false
    const created = new Date(e.created_at).getTime()
    if (!Number.isFinite(created)) return false
    return (nowMs - created) / 3.6e6 <= MINT_MAX_AGE_HOURS
  })
  if (entries.length === 0) return base

  const signalFor = (p) => (signals && p?.txid ? signals.get(p.txid) : undefined)
  const recencyScore = (e) => {
    const created = new Date(e.created_at).getTime()
    return Number.isFinite(created) ? -Math.max(0, (nowMs - created) / 3.6e6) : -Infinity
  }

  // The merged list of { item, score }. Post scores are recomputed with the same
  // inputs the ranker used, so they match the order-defining numbers exactly.
  const merged = base.map((p) => ({ item: p, score: scorePost(p, signalFor(p), nowMs) }))

  // Newest entry first; each inserts before the first element it outscores.
  // Equal scores keep the existing element first (older mints land after newer
  // ones), so the weave is stable and deterministic — cache-safe.
  // A mint never LEADS the feed — the first thing a viewer sees should be real
  // content, not a system announcement. So the earliest a mint can slot is index
  // 1 whenever there's ≥1 real post; the search starts there, which also keeps
  // mints correctly ordered among THEMSELVES (a plain clamp-to-1 would reverse a
  // batch that all outscores the top post).
  const minAt = base.length > 0 ? 1 : 0
  const sorted = [...entries].sort((a, b) => recencyScore(b) - recencyScore(a))
  for (const entry of sorted) {
    const score = recencyScore(entry)
    let at = merged.length
    for (let i = minAt; i < merged.length; i++) {
      if (score > merged[i].score) {
        at = i
        break
      }
    }
    merged.splice(at, 0, { item: entry, score })
  }

  return merged.map((m) => m.item)
}
