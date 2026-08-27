import { describe, it, expect } from 'vitest'
import { rankFeedCandidates, weaveMintRows } from '@/lib/feedRanking'

// Fixed "now" for deterministic ages; helpers express ages in hours-ago.
const NOW = Date.parse('2026-07-11T20:00:00.000Z')
const hoursAgo = (h) => new Date(NOW - h * 3.6e6).toISOString()

let seq = 0
const post = (agoHours, extra = {}) => ({
  txid: `post-${seq}`,
  id: `id-${seq++}`,
  author_account_id: extra.author ?? `author-${seq}`,
  created_at: hoursAgo(agoHours),
  reply_count: 0,
  quote_count: 0,
  ...extra,
})
const mint = (agoHours, handle) => ({
  txid: `mint-${handle}`,
  card_kind: 'handle_mint',
  card_meta: { handle },
  created_at: hoursAgo(agoHours),
})

describe('weaveMintRows', () => {
  it('returns the ranked list untouched when there are no mint entries', () => {
    const posts = rankFeedCandidates([post(1), post(2)], undefined, NOW)
    expect(weaveMintRows(posts, [], undefined, NOW)).toEqual(posts)
    expect(weaveMintRows(posts, null, undefined, NOW)).toEqual(posts)
  })

  it('slots a mint by recency among unloved posts, but never in the first slot', () => {
    // Old posts (past the exploration window) score ≈ -age; a 1h-old mint would
    // outscore both by pure recency, but a mint never LEADS the feed — the top
    // stays real content, so the mint slots at index 1 (above the 5h post).
    const ranked = rankFeedCandidates([post(3), post(5)], undefined, NOW)
    const woven = weaveMintRows(ranked, [mint(1, 'alice')], undefined, NOW)
    expect(woven.map((p) => p.txid)).toEqual([ranked[0].txid, 'mint-alice', ranked[1].txid])
  })

  it('never outranks a post with real paid signal, even a much older one', () => {
    // A 4h-old post with 5 distinct supporters scores well above zero
    // (breadth ≈ +10h vs -4h age); a brand-new mint (score ≈ 0) stays below.
    const supported = post(4)
    const signals = new Map([
      [supported.txid, { distinctSupporters: 5 }],
    ])
    const ranked = rankFeedCandidates([supported, post(6)], signals, NOW)
    const woven = weaveMintRows(ranked, [mint(0.01, 'bob')], signals, NOW)
    expect(woven.map((p) => p.txid)).toEqual([supported.txid, 'mint-bob', woven[2].txid])
  })

  it('gets no exploration boost: a fresh real post beats an equally fresh mint', () => {
    // Both are 6 minutes old. The real post carries the ~+4h explore debut
    // boost; the mint scores pure recency and lands after it.
    const fresh = post(0.1)
    const ranked = rankFeedCandidates([fresh, post(8)], undefined, NOW)
    const woven = weaveMintRows(ranked, [mint(0.1, 'carol')], undefined, NOW)
    expect(woven[0].txid).toBe(fresh.txid)
    expect(woven[1].txid).toBe('mint-carol')
  })

  it('keeps multiple mints newest-first when they land together (under the lead post)', () => {
    // All three mints outscore the lone 10h post on recency, but the post keeps
    // the lead slot; the mints follow it newest-first.
    const ranked = rankFeedCandidates([post(10)], undefined, NOW)
    const woven = weaveMintRows(
      ranked,
      [mint(3, 'old'), mint(1, 'new'), mint(2, 'mid')],
      undefined,
      NOW,
    )
    expect(woven.map((p) => p.txid)).toEqual([ranked[0].txid, 'mint-new', 'mint-mid', 'mint-old'])
  })

  it('weaves a synthetic digest entry by its stamped time like any mint', () => {
    const ranked = rankFeedCandidates([post(1), post(4)], undefined, NOW)
    const digest = {
      txid: 'mint-digest-x',
      mintDigest: true,
      count: 7,
      created_at: hoursAgo(2),
    }
    const woven = weaveMintRows(ranked, [digest], undefined, NOW)
    expect(woven.map((p) => p.txid)).toEqual([ranked[0].txid, 'mint-digest-x', ranked[1].txid])
  })

  it('never drops or reorders the ranked posts themselves', () => {
    const posts = [post(0.5), post(2), post(3, { reply_count: 4 }), post(7), post(9)]
    const signals = new Map([[posts[3].txid, { distinctSupporters: 3 }]])
    const ranked = rankFeedCandidates(posts, signals, NOW)
    const woven = weaveMintRows(ranked, [mint(1, 'a'), mint(6, 'b')], signals, NOW)
    expect(woven).toHaveLength(ranked.length + 2)
    expect(woven.filter((p) => p.card_kind !== 'handle_mint')).toEqual(ranked)
  })

  it('ignores entries without a created_at instead of crashing', () => {
    const ranked = rankFeedCandidates([post(1)], undefined, NOW)
    const woven = weaveMintRows(ranked, [{ txid: 'broken' }], undefined, NOW)
    expect(woven).toEqual(ranked)
  })
})
