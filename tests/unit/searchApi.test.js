// =============================================================================
//  /api/search route tests. The DB truth (paywall-oracle invariant, fuzzy
//  matching, type filters) is proven against real Postgres in
//  tests/integration/searchDb.test.js — here we mock the RPC boundary and
//  test the route's own logic: the eCash-address short-circuit (which must
//  reuse the /@identifier resolver, never text search), param handling,
//  result shaping, and live-byline enrichment.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: [], error: null })),
  resolveProfileByIdentifier: vi.fn(async () => null),
  displayHandlesByAuthorId: vi.fn(async () => ({})),
  displayHandlesByAccountId: vi.fn(async () => ({})),
}))

// Route reads its client from lib/db (adminDb) — the single server entry point.
vi.mock('@/lib/db', () => ({
  adminDb: () => ({ rpc: mocks.rpc }),
}))
// Keep the REAL normalizeAddress (the address classifier under test) and mock
// only the resolver so no Chronik/Supabase call leaves the process.
vi.mock('@/lib/resolveProfile', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, resolveProfileByIdentifier: mocks.resolveProfileByIdentifier }
})
vi.mock('@/lib/authorDisplayHandles', () => ({
  displayHandlesByAuthorId: mocks.displayHandlesByAuthorId,
  displayHandlesByAccountId: mocks.displayHandlesByAccountId,
}))

import { GET } from '@/app/api/search/route'

const ADDRESS = 'ecash:qrw35trzq7hagejru2h3eqf5eyhxxmg4cul69u7am3'
const BARE = 'qrw35trzq7hagejru2h3eqf5eyhxxmg4cul69u7am3'

const get = async (query) => {
  const res = await GET(new Request(`http://test.local/api/search${query}`))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rpc.mockResolvedValue({ data: [], error: null })
  mocks.resolveProfileByIdentifier.mockResolvedValue(null)
  mocks.displayHandlesByAuthorId.mockResolvedValue({})
  mocks.displayHandlesByAccountId.mockResolvedValue({})
})

describe('address paste short-circuit', () => {
  it('resolves a pasted address to the profile route and skips text search', async () => {
    mocks.resolveProfileByIdentifier.mockResolvedValue({
      kind: 'address',
      displayHandle: 'simon',
      handleColor: '#3df0ff',
      identity: '@simon',
    })
    const { status, body } = await get(`?q=${encodeURIComponent(ADDRESS)}`)
    expect(status).toBe(200)
    expect(body.addressQuery).toBe(true)
    expect(body.results.people).toEqual([
      {
        type: 'person',
        kind: 'address',
        id: BARE,
        handle: 'simon',
        handleColor: '#3df0ff',
        identity: '@simon',
        route: `/@${BARE}`,
      },
    ])
    expect(mocks.resolveProfileByIdentifier).toHaveBeenCalledWith(ADDRESS)
    expect(mocks.rpc).not.toHaveBeenCalled() // never falls through to text search
  })

  it('accepts the bare (prefixless) address form too', async () => {
    mocks.resolveProfileByIdentifier.mockResolvedValue({
      kind: 'address',
      displayHandle: null,
      handleColor: null,
      identity: BARE,
    })
    const { body } = await get(`?q=${BARE}`)
    expect(body.addressQuery).toBe(true)
    expect(body.results.people[0].route).toBe(`/@${BARE}`)
    expect(body.results.people[0].identity).toBe(BARE) // handle-less account
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('returns empty people when the address matches no account', async () => {
    const { body } = await get(`?q=${encodeURIComponent(ADDRESS)}`)
    expect(body.ok).toBe(true)
    expect(body.addressQuery).toBe(true)
    expect(body.results.people).toEqual([])
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('does not treat a normal word as an address', async () => {
    await get('?q=simon')
    expect(mocks.resolveProfileByIdentifier).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
})

describe('text search', () => {
  it('calls search_site with the query, no type filter, and the grouped limit', async () => {
    await get('?q=aurifex')
    expect(mocks.rpc).toHaveBeenCalledWith('search_site', {
      p_query: 'aurifex',
      p_type: null,
      p_limit: 8,
    })
  })

  it('passes a valid type filter through with the larger single-tab limit', async () => {
    await get('?q=aurifex&type=articles')
    expect(mocks.rpc).toHaveBeenCalledWith('search_site', {
      p_query: 'aurifex',
      p_type: 'articles',
      p_limit: 20,
    })
  })

  it('ignores an unknown type param', async () => {
    const { body } = await get('?q=aurifex&type=bogus')
    expect(body.type).toBe(null)
    expect(mocks.rpc).toHaveBeenCalledWith(
      'search_site',
      expect.objectContaining({ p_type: null }),
    )
  })

  it('returns empty groups without hitting the DB for an empty query', async () => {
    const { body } = await get('?q=%20%20')
    expect(body.ok).toBe(true)
    expect(body.results).toEqual({ articles: [], posts: [], people: [] })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('shapes RPC rows into grouped results with routes and locked flags', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          result_type: 'article', id: 'a1', title: 'The Aurifex Chronicle',
          slug: 'aurifex-chronicle', is_legacy: false, snippet: 'the ⟦aurifex⟧ canticle',
          locked: true, price_xec: 500, reading_time_minutes: 3,
          author_id: 'auth-1', created_at: '2026-07-17T00:00:00Z', rank: 0.9,
        },
        {
          result_type: 'article', id: 'a2', title: 'Old One', slug: '00',
          is_legacy: true, snippet: 's', locked: false, author_id: 'auth-2',
        },
        {
          result_type: 'post', id: 'txid1', snippet: '⟦aurifex⟧ essays',
          account_id: 'acct-1', author_identity: 'ecash:qqfallback',
          created_at: '2026-07-16T00:00:00Z',
        },
        { result_type: 'person', id: 'acct-2', title: 'aurifex', handle_color: '#3df0ff' },
      ],
      error: null,
    })
    const { body } = await get('?q=aurifex')
    expect(body.results.articles[0]).toMatchObject({
      route: '/posts/aurifex-chronicle', locked: true, priceXec: 500,
    })
    expect(body.results.articles[1].route).toBe('/00') // legacy root permalink
    expect(body.results.posts[0].route).toBe('/feed/txid1')
    expect(body.results.people[0].route).toBe('/@aurifex')
  })

  it('upgrades bylines to the LIVE handle and falls back to the stamped identity', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          result_type: 'article', id: 'a1', title: 'T', slug: 's', is_legacy: false,
          snippet: '', locked: false, author_id: 'auth-1',
        },
        {
          result_type: 'post', id: 'tx1', snippet: '', account_id: 'acct-live',
          author_identity: 'ecash:qqstamped1',
        },
        {
          result_type: 'post', id: 'tx2', snippet: '', account_id: 'acct-unbound',
          author_identity: 'ecash:qqstamped2',
        },
      ],
      error: null,
    })
    mocks.displayHandlesByAuthorId.mockResolvedValue({
      'auth-1': { handle: 'writer', color: '#00ff9c' },
    })
    mocks.displayHandlesByAccountId.mockResolvedValue({
      'acct-live': { handle: 'poster', color: null },
    })
    const { body } = await get('?q=x')
    expect(body.results.articles[0].byline).toEqual({ handle: 'writer', color: '#00ff9c' })
    expect(body.results.posts[0].identity).toBe('@poster') // live handle wins
    expect(body.results.posts[1].identity).toBe('ecash:qqstamped2') // no live handle -> snapshot
  })

  it('returns 503 when the RPC is missing/failing (migration not applied yet)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } })
    const { status, body } = await get('?q=aurifex')
    expect(status).toBe(503)
    expect(body.ok).toBe(false)
  })
})
