import { describe, it, expect, vi, beforeEach } from 'vitest'

// GET /api/feed/new-count powers the "N new posts" banner. It can't rely on a
// plain DB-side count any more — a blocked account's posts get dropped from the
// feed the instant it loads, so they must never inflate this count either, or
// the banner promises posts that never actually appear when clicked. These
// tests exercise the route's OWN post-fetch filtering (own-account exclusion +
// blocked exclusion + the display cap), not Postgres query construction — the
// fake Supabase below just tracks which `.neq()` filter was applied (mirroring
// the real DB-side own-post exclusion) and returns a fixed candidate set.

const mocks = vi.hoisted(() => ({
  getAuthedAccount: vi.fn(),
  blockedAccountIds: vi.fn(),
}))

vi.mock('@/lib/authHelpers', () => ({ getAuthedAccount: mocks.getAuthedAccount }))
vi.mock('@/lib/feedBlocks', () => ({ blockedAccountIds: mocks.blockedAccountIds }))

let candidateRows = []

function makeSupabase() {
  let neqFilter = null
  const chain = {
    select: () => chain,
    in: () => chain,
    is: () => chain,
    or: () => chain,
    limit: () => chain,
    neq: (col, val) => {
      neqFilter = { col, val }
      return chain
    },
    then(resolve) {
      const rows = neqFilter ? candidateRows.filter((r) => r[neqFilter.col] !== neqFilter.val) : candidateRows
      resolve({ data: rows, error: null })
    },
  }
  return { from: () => chain }
}

vi.mock('@/lib/db', () => ({ adminDb: () => makeSupabase() }))

const { GET } = await import('@/app/api/feed/new-count/route')

function req(t = '2026-01-01T00:00:00.000Z', i = 'boundary-id') {
  return { url: `http://x/api/feed/new-count?t=${encodeURIComponent(t)}&i=${encodeURIComponent(i)}` }
}

describe('GET /api/feed/new-count', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    candidateRows = []
  })

  it('excludes posts from blocked accounts (either direction) out of the count', async () => {
    mocks.getAuthedAccount.mockResolvedValue({ accountId: 'viewer-1' })
    mocks.blockedAccountIds.mockResolvedValue(new Set(['blocked-author']))
    candidateRows = [
      { author_account_id: 'author-a' },
      { author_account_id: 'blocked-author' },
      { author_account_id: 'blocked-author' },
      { author_account_id: 'author-b' },
    ]

    const res = await GET(req())
    const body = await res.json()

    expect(body.count).toBe(2)
    expect(mocks.blockedAccountIds).toHaveBeenCalledWith(expect.anything(), 'viewer-1')
  })

  it('still excludes the viewer\'s own posts (unchanged behavior)', async () => {
    mocks.getAuthedAccount.mockResolvedValue({ accountId: 'viewer-1' })
    mocks.blockedAccountIds.mockResolvedValue(new Set())
    candidateRows = [
      { author_account_id: 'viewer-1' },
      { author_account_id: 'viewer-1' },
      { author_account_id: 'author-b' },
    ]

    const res = await GET(req())
    const body = await res.json()

    expect(body.count).toBe(1)
  })

  it('applies both exclusions together', async () => {
    mocks.getAuthedAccount.mockResolvedValue({ accountId: 'viewer-1' })
    mocks.blockedAccountIds.mockResolvedValue(new Set(['blocked-author']))
    candidateRows = [
      { author_account_id: 'viewer-1' }, // excluded: own post
      { author_account_id: 'blocked-author' }, // excluded: blocked
      { author_account_id: 'author-b' }, // counted
      { author_account_id: 'author-c' }, // counted
    ]

    const res = await GET(req())
    const body = await res.json()

    expect(body.count).toBe(2)
  })

  it('anonymous viewer counts everything (no session -> no block set to resolve)', async () => {
    mocks.getAuthedAccount.mockResolvedValue(null)
    candidateRows = [{ author_account_id: 'a' }, { author_account_id: 'b' }]

    const res = await GET(req())
    const body = await res.json()

    expect(body.count).toBe(2)
    expect(mocks.blockedAccountIds).not.toHaveBeenCalled()
  })

  it('clamps the displayed count to the cap once real (non-blocked) posts exceed it', async () => {
    mocks.getAuthedAccount.mockResolvedValue({ accountId: 'viewer-1' })
    mocks.blockedAccountIds.mockResolvedValue(new Set())
    candidateRows = Array.from({ length: 60 }, (_, i) => ({ author_account_id: `author-${i}` }))

    const res = await GET(req())
    const body = await res.json()

    expect(body.count).toBe(50)
    expect(body.capped).toBe(true)
  })

  it('400s when the boundary params are missing', async () => {
    const res = await GET({ url: 'http://x/api/feed/new-count' })
    expect(res.status).toBe(400)
  })
})
