import { describe, it, expect } from 'vitest'
import { rankFeedCandidates, weaveMintRows } from '@/lib/feedRanking'

// Build a post row `ageHours` old with optional denormalized conversation counts.
function post(id, ageHours, extra = {}) {
  const created = new Date(Date.now() - ageHours * 3.6e6).toISOString()
  return {
    txid: id,
    id,
    author_account_id: extra.author ?? id,
    created_at: created,
    reply_count: extra.reply_count ?? 0,
    quote_count: extra.quote_count ?? 0,
  }
}

function ids(list) {
  return list.map((p) => p.txid)
}

describe('rankFeedCandidates', () => {
  it('returns the list unchanged when there is nothing to reorder', () => {
    expect(rankFeedCandidates([])).toEqual([])
    const single = [post('a', 1)]
    expect(rankFeedCandidates(single)).toEqual(single)
  })

  it('orders by recency when there is no engagement signal', () => {
    const posts = [post('new', 1), post('mid', 5), post('old', 20)]
    // Shuffle input to prove it sorts rather than preserving input order.
    const ranked = rankFeedCandidates([posts[2], posts[0], posts[1]])
    expect(ids(ranked)).toEqual(['new', 'mid', 'old'])
  })

  it('lets distinct paying supporters float an older post above a newer quiet one', () => {
    const newer = post('newer', 2, { author: 'A' })
    const older = post('older', 8, { author: 'B' })
    const signals = new Map([
      ['older', { distinctSupporters: 12, totalAmountSats: 0 }],
    ])
    const ranked = rankFeedCandidates([newer, older], signals)
    expect(ids(ranked)[0]).toBe('older')
  })

  it('weights breadth (many distinct payers) over a single whale tip', () => {
    const broad = post('broad', 5, { author: 'A' })
    const whale = post('whale', 5, { author: 'B' })
    const signals = new Map([
      // Ten people paid 100 XEC each vs. one wallet paying 1,000,000 XEC.
      ['broad', { distinctSupporters: 10, totalAmountSats: 10 * 100 * 100 }],
      ['whale', { distinctSupporters: 1, totalAmountSats: 1_000_000 * 100 }],
    ])
    const ranked = rankFeedCandidates([broad, whale], signals)
    expect(ids(ranked)[0]).toBe('broad')
  })

  it('saturates amount so a whale cannot out-rank a much newer post', () => {
    const fresh = post('fresh', 0.5, { author: 'A' })
    const bought = post('bought', 30, { author: 'B' })
    const signals = new Map([
      ['bought', { distinctSupporters: 1, totalAmountSats: 1_000_000 * 100 }],
    ])
    const ranked = rankFeedCandidates([fresh, bought], signals)
    // A single huge tip on a day-old post can't teleport it over a 30-min-old post.
    expect(ids(ranked)[0]).toBe('fresh')
  })

  it('gives brand-new posts an exploration boost over slightly older quiet ones', () => {
    const brandNew = post('brandNew', 0.1, { author: 'A' })
    const slightlyOlder = post('older', 4, { author: 'B' })
    const ranked = rankFeedCandidates([slightlyOlder, brandNew])
    expect(ids(ranked)[0]).toBe('brandNew')
  })

  it('spreads authors so one account cannot occupy consecutive slots', () => {
    // Author A holds the two highest-scored posts (both heavily supported); the
    // spread pass must lift a lower-scored other-author post between them rather
    // than serving A back-to-back.
    const a1 = post('a1', 1, { author: 'A' })
    const a2 = post('a2', 2, { author: 'A' })
    const b1 = post('b1', 8, { author: 'B' })
    const c1 = post('c1', 9, { author: 'C' })
    const d1 = post('d1', 10, { author: 'D' })
    const signals = new Map([
      ['a1', { distinctSupporters: 20, totalAmountSats: 0 }],
      ['a2', { distinctSupporters: 20, totalAmountSats: 0 }],
    ])
    const ranked = rankFeedCandidates([a1, a2, b1, c1, d1], signals)
    for (let i = 1; i < ranked.length; i++) {
      const sameAuthorRun =
        ranked[i].author_account_id === ranked[i - 1].author_account_id
      expect(sameAuthorRun).toBe(false)
    }
  })

  it('never adds or drops rows (stays a permutation for cursor safety)', () => {
    const posts = [
      post('a', 1, { author: 'A' }),
      post('b', 2, { author: 'B' }),
      post('c', 3, { author: 'A' }),
      post('d', 4, { author: 'C' }),
    ]
    const ranked = rankFeedCandidates(posts)
    expect(ids(ranked).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(ranked).toHaveLength(posts.length)
  })

  it('does not mutate the caller array', () => {
    const posts = [post('a', 5), post('b', 1), post('c', 10)]
    const before = ids(posts)
    rankFeedCandidates(posts)
    expect(ids(posts)).toEqual(before)
  })
})

// A mint entry `ageHours` old (mirrors the fetched handle_mint row / digest).
function mint(id, ageHours) {
  return { txid: id, created_at: new Date(Date.now() - ageHours * 3.6e6).toISOString() }
}

describe('weaveMintRows', () => {
  it('drops mints older than the freshness cap (the reported 22h / days-ago rows)', () => {
    const posts = [post('p1', 1), post('p2', 30)]
    const woven = weaveMintRows(posts, [mint('m-22h', 22), mint('m-3d', 72)])
    expect(ids(woven)).toEqual(['p1', 'p2']) // both stale mints dropped
  })

  it('weaves a FRESH mint in by recency', () => {
    const posts = [post('p1', 1), post('p2', 6)]
    const woven = weaveMintRows(posts, [mint('m-3h', 3)])
    // 3h mint sits between the 1h and 6h posts
    expect(ids(woven)).toEqual(['p1', 'm-3h', 'p2'])
  })

  it('never lets a mint take the very first slot — the feed leads with real content', () => {
    // A brand-new mint outscores an older quiet post on pure recency, but must not
    // lead: the real post keeps slot 0, the mint slots right after it.
    const posts = [post('p1', 5)]
    const woven = weaveMintRows(posts, [mint('m-fresh', 0.1)])
    expect(ids(woven)).toEqual(['p1', 'm-fresh'])
  })

  it('leaves the feed untouched when every mint is stale', () => {
    const posts = [post('p1', 2), post('p2', 4)]
    expect(weaveMintRows(posts, [mint('old', 48)])).toEqual(posts)
  })
})
