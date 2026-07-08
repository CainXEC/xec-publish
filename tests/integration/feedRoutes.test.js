import { beforeEach, describe, expect, it, vi } from 'vitest'

// The money path for likes/reposts/quotes/replies. We mock the boundaries
// (Chronik payment scan, Supabase, wallet-account resolution, session signing)
// but let the pure pricing/hashing/OP_RETURN builders run for real so the tests
// exercise the routes' actual validation and wiring.

const mocks = vi.hoisted(() => ({
  createServerSupabase: vi.fn(),
  rateLimit: vi.fn(async () => true),
  findFeedPayment: vi.fn(async () => null),
  verifyFeedTxid: vi.fn(async () => null),
  resolveOrCreateAccount: vi.fn(async () => ({ accountId: 'acct-1', handle: 'alice' })),
  verifySession: vi.fn(() => null),
  signSession: vi.fn(() => 'signed.session'),
}))

// The routes read the platform address from the environment at request time;
// vitest doesn't load .env.local, so pin a valid ecash address here.
process.env.PLATFORM_XEC_ADDRESS =
  process.env.PLATFORM_XEC_ADDRESS || 'ecash:qrw35trzq7hagejru2h3eqf5eyhxxmg4cul69u7am3'

// next/cache needs Next's request/render store, which a bare route call lacks.
// The feed routes only use it to invalidate the shared feed cache, so stub it.
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  unstable_cache: (fn) => fn,
}))
vi.mock('@/lib/supabase-server', () => ({ createServerSupabase: mocks.createServerSupabase }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: mocks.rateLimit, getClientIp: () => 'test-ip' }))
vi.mock('@/lib/verifyFeedPost', () => ({
  findFeedPayment: mocks.findFeedPayment,
  verifyFeedTxid: mocks.verifyFeedTxid,
}))
vi.mock('@/lib/walletAuth', () => ({ resolveOrCreateAccount: mocks.resolveOrCreateAccount }))
vi.mock('@/lib/session', () => ({
  verifySession: mocks.verifySession,
  signSession: mocks.signSession,
  SESSION_COOKIE: 'pow_session',
  SESSION_MAX_AGE_DAYS: 30,
}))

const TXID_A = 'a'.repeat(64)
const PAY_TXID = 'c'.repeat(64)

// A tiny Supabase test double. `resolver(state, term)` inspects the accumulated
// query (`state.table`, `state.op`, `state.columns`, `state.filters`) and the
// terminal call (`maybeSingle` | `single` | `list`) and returns `{ data, error }`.
function makeSupabase(resolver) {
  return {
    from(table) {
      const state = { table, op: 'select', columns: null, filters: {}, insertRow: null }
      const b = {
        select(cols) {
          state.columns = cols
          return b
        },
        insert(row) {
          state.op = 'insert'
          state.insertRow = row
          return b
        },
        eq(col, val) {
          state.filters[col] = val
          return b
        },
        maybeSingle() {
          return Promise.resolve(resolver(state, 'maybeSingle'))
        },
        single() {
          return Promise.resolve(resolver(state, 'single'))
        },
        // Awaiting the builder directly (a filter-only list query).
        then(onFulfilled, onRejected) {
          return Promise.resolve(resolver(state, 'list')).then(onFulfilled, onRejected)
        },
      }
      return b
    },
  }
}

function useSupabase(resolver) {
  mocks.createServerSupabase.mockReturnValue(makeSupabase(resolver))
}

function makeReq(body, { cookie } = {}) {
  return {
    headers: { get: () => null },
    json: async () => body,
    cookies: { get: () => (cookie ? { value: cookie } : undefined) },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rateLimit.mockResolvedValue(true)
  mocks.findFeedPayment.mockResolvedValue(null)
  mocks.verifyFeedTxid.mockResolvedValue(null)
  mocks.resolveOrCreateAccount.mockResolvedValue({ accountId: 'acct-1', handle: 'alice' })
  mocks.verifySession.mockReturnValue(null)
  mocks.signSession.mockReturnValue('signed.session')
  useSupabase(() => ({ data: null, error: null }))
})

describe('POST /api/feed/prepare', () => {
  it('prices a top-level post as 100% platform fee', async () => {
    const { POST } = await import('@/app/api/feed/prepare/route')
    const res = await POST(makeReq({ action: 'post', content: 'Hello world' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.action).toBe(1)
    expect(json.costXec).toBe(100)
    expect(json.parentTxid).toBeNull()
    expect(json.quotedTxid).toBeNull()
    expect(json.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(json.bip21Url).toContain('amount=')
  })

  it('builds a reply against a known parent', async () => {
    useSupabase((state) => {
      if (state.table === 'feed_posts' && state.filters.txid === TXID_A) {
        return { data: { payout_address: 'ecash:qparentauthor' }, error: null }
      }
      return { data: null, error: null }
    })
    const { POST } = await import('@/app/api/feed/prepare/route')
    const res = await POST(makeReq({ action: 'reply', content: 'nice', parentTxid: TXID_A }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.action).toBe(2)
    expect(json.parentTxid).toBe(TXID_A)
  })

  it('404s a reply when the parent post is missing', async () => {
    useSupabase(() => ({ data: null, error: null }))
    const { POST } = await import('@/app/api/feed/prepare/route')
    const res = await POST(makeReq({ action: 'reply', content: 'nice', parentTxid: TXID_A }))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Parent post not found')
  })

  it('400s a reply with a malformed parent txid', async () => {
    const { POST } = await import('@/app/api/feed/prepare/route')
    const res = await POST(makeReq({ action: 'reply', content: 'nice', parentTxid: 'not-hex' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid parent post')
  })

  it('builds a quote against a live quoted post', async () => {
    useSupabase((state) => {
      if (state.table === 'feed_posts' && state.filters.txid === TXID_A) {
        return { data: { txid: TXID_A, deleted_at: null }, error: null }
      }
      return { data: null, error: null }
    })
    const { POST } = await import('@/app/api/feed/prepare/route')
    const res = await POST(makeReq({ action: 'quote', content: 'look at this', quotedTxid: TXID_A }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.action).toBe(3)
    expect(json.quotedTxid).toBe(TXID_A)
  })

  it('404s a quote of a deleted post', async () => {
    useSupabase(() => ({ data: { txid: TXID_A, deleted_at: '2026-01-01' }, error: null }))
    const { POST } = await import('@/app/api/feed/prepare/route')
    const res = await POST(makeReq({ action: 'quote', content: 'x', quotedTxid: TXID_A }))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Quoted post not found')
  })

  it('400s an unsupported action', async () => {
    const { POST } = await import('@/app/api/feed/prepare/route')
    const res = await POST(makeReq({ action: 'zap', content: 'x' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Unsupported action')
  })

  it('400s empty content before touching the DB', async () => {
    const { POST } = await import('@/app/api/feed/prepare/route')
    const res = await POST(makeReq({ action: 'post', content: '   ' }))
    expect(res.status).toBe(400)
    expect(mocks.createServerSupabase).not.toHaveBeenCalled()
  })

  it('429s when the rate limiter trips', async () => {
    mocks.rateLimit.mockResolvedValue(false)
    const { POST } = await import('@/app/api/feed/prepare/route')
    const res = await POST(makeReq({ action: 'post', content: 'Hello' }))
    expect(res.status).toBe(429)
  })
})

describe('POST /api/feed/confirm', () => {
  it('reports awaiting_payment when no matching tx is found', async () => {
    useSupabase((state, term) => {
      if (state.table === 'feed_posts' && term === 'list') return { data: [], error: null }
      return { data: null, error: null }
    })
    const { POST } = await import('@/app/api/feed/confirm/route')
    const res = await POST(makeReq({ action: 'post', content: 'Hello world' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'awaiting_payment' })
    expect(mocks.resolveOrCreateAccount).not.toHaveBeenCalled()
  })

  it('publishes a not-yet-final post at 0-conf as provisional (finalized_at null)', async () => {
    mocks.verifyFeedTxid.mockResolvedValue({
      txid: PAY_TXID,
      payerAddress: 'ecash:qpayer',
      sats: 10000,
      isFinal: false,
    })
    let insertedRow = null
    useSupabase((state, term) => {
      if (state.op === 'insert') {
        insertedRow = state.insertRow
        return { data: { id: 'post-1', txid: PAY_TXID, action: 1, content: 'Hello world' }, error: null }
      }
      if (term === 'list') return { data: [], error: null }
      return { data: null, error: null }
    })
    const { POST } = await import('@/app/api/feed/confirm/route')
    const res = await POST(makeReq({ action: 'post', content: 'Hello world', txid: PAY_TXID }))
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('posted')
    // The 0-conf row is recorded provisionally; the reconcile sweep finalizes it.
    expect(insertedRow.finalized_at).toBeNull()
    expect(mocks.resolveOrCreateAccount).toHaveBeenCalledWith('ecash:qpayer')
  })

  it('records a final paid post (finalized_at stamped) and mints a pay session', async () => {
    mocks.verifyFeedTxid.mockResolvedValue({
      txid: PAY_TXID,
      payerAddress: 'ecash:qpayer',
      sats: 10000,
      isFinal: true,
    })
    const insertedRow = {
      id: 'post-1',
      txid: PAY_TXID,
      action: 1,
      parent_txid: null,
      quoted_txid: null,
      content: 'Hello world',
      payer_address: 'ecash:qpayer',
    }
    let captured = null
    useSupabase((state, term) => {
      if (state.op === 'insert') {
        captured = state.insertRow
        return { data: insertedRow, error: null }
      }
      if (term === 'list') return { data: [], error: null } // exclude-by-content-hash
      return { data: null, error: null } // idempotent lookup: not yet recorded
    })
    const { POST } = await import('@/app/api/feed/confirm/route')
    const res = await POST(makeReq({ action: 'post', content: 'Hello world', txid: PAY_TXID }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('posted')
    expect(json.post.txid).toBe(PAY_TXID)
    expect(json.post.replyCount).toBe(0)
    // Already final at detection → born final, so the sweep never touches it.
    expect(captured.finalized_at).not.toBeNull()
    expect(mocks.resolveOrCreateAccount).toHaveBeenCalledWith('ecash:qpayer')
    expect(res.cookies.get('pow_session')?.value).toBe('signed.session')
  })

  it('is idempotent: returns the existing row without re-inserting', async () => {
    mocks.verifyFeedTxid.mockResolvedValue({
      txid: PAY_TXID,
      payerAddress: 'ecash:qpayer',
      sats: 10000,
      isFinal: true,
    })
    const existing = { id: 'post-1', txid: PAY_TXID, action: 1, content: 'Hello world' }
    useSupabase((state, term) => {
      if (state.op === 'insert') throw new Error('should not insert on idempotent path')
      if (term === 'list') return { data: [], error: null }
      return { data: existing, error: null } // idempotent lookup hits
    })
    const { POST } = await import('@/app/api/feed/confirm/route')
    const res = await POST(makeReq({ action: 'post', content: 'Hello world', txid: PAY_TXID }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('posted')
    expect(json.post).toMatchObject(existing)
    expect(mocks.resolveOrCreateAccount).not.toHaveBeenCalled()
  })
})

describe('POST /api/feed/react/prepare', () => {
  it('builds a 94/6 split like against a live post', async () => {
    useSupabase(() => ({
      data: { payout_address: 'ecash:qauthor', deleted_at: null },
      error: null,
    }))
    const { POST } = await import('@/app/api/feed/react/prepare/route')
    const res = await POST(makeReq({ action: 'like', targetTxid: TXID_A }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.action).toBe(5)
    expect(json.costXec).toBe(100)
    expect(json.targetTxid).toBe(TXID_A)
    expect(json.bip21Url).toContain('amount=')
  })

  it('404s a reaction on a missing or deleted post', async () => {
    useSupabase(() => ({ data: { payout_address: 'ecash:qauthor', deleted_at: '2026-01-01' }, error: null }))
    const { POST } = await import('@/app/api/feed/react/prepare/route')
    const res = await POST(makeReq({ action: 'repost', targetTxid: TXID_A }))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Post not found')
  })

  it('400s an unsupported reaction', async () => {
    const { POST } = await import('@/app/api/feed/react/prepare/route')
    const res = await POST(makeReq({ action: 'boost', targetTxid: TXID_A }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Unsupported reaction')
  })

  it('400s a malformed target txid', async () => {
    const { POST } = await import('@/app/api/feed/react/prepare/route')
    const res = await POST(makeReq({ action: 'like', targetTxid: 'nope' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid target post')
  })
})

describe('POST /api/feed/react/confirm', () => {
  const liveTarget = { payout_address: 'ecash:qauthor', deleted_at: null }

  it('reports awaiting_payment when no reaction tx is found', async () => {
    useSupabase((state, term) => {
      if (state.table === 'feed_posts') return { data: liveTarget, error: null }
      if (state.table === 'feed_events' && term === 'list') return { data: [], error: null }
      return { data: null, error: null }
    })
    const { POST } = await import('@/app/api/feed/react/confirm/route')
    const res = await POST(makeReq({ action: 'like', targetTxid: TXID_A }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'awaiting_payment' })
    expect(mocks.resolveOrCreateAccount).not.toHaveBeenCalled()
  })

  it('publishes a not-yet-final reaction at 0-conf as provisional (finalized_at null)', async () => {
    mocks.verifyFeedTxid.mockResolvedValue({
      txid: PAY_TXID,
      payerAddress: 'ecash:qfan',
      sats: 10000,
      isFinal: false,
    })
    let insertedRow = null
    useSupabase((state, term) => {
      if (state.op === 'insert') {
        insertedRow = state.insertRow
        return {
          data: { id: 'evt-1', txid: PAY_TXID, action: 5, target_txid: TXID_A },
          error: null,
        }
      }
      if (state.table === 'feed_posts') return { data: liveTarget, error: null }
      if (state.table === 'feed_events' && term === 'list') return { data: [], error: null }
      return { data: null, error: null }
    })
    const { POST } = await import('@/app/api/feed/react/confirm/route')
    const res = await POST(makeReq({ action: 'like', targetTxid: TXID_A, txid: PAY_TXID }))
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('reacted')
    // The 0-conf reaction is recorded provisionally; the reconcile sweep finalizes it.
    expect(insertedRow.finalized_at).toBeNull()
    expect(mocks.resolveOrCreateAccount).toHaveBeenCalledWith('ecash:qfan')
  })

  it('records a final paid reaction (finalized_at stamped)', async () => {
    mocks.verifyFeedTxid.mockResolvedValue({
      txid: PAY_TXID,
      payerAddress: 'ecash:qfan',
      sats: 10000,
      isFinal: true,
    })
    const event = {
      id: 'evt-1',
      txid: PAY_TXID,
      action: 5,
      target_txid: TXID_A,
      payer_address: 'ecash:qfan',
    }
    let captured = null
    useSupabase((state, term) => {
      if (state.op === 'insert') {
        captured = state.insertRow
        return { data: event, error: null }
      }
      if (state.table === 'feed_posts') return { data: liveTarget, error: null }
      if (state.table === 'feed_events' && term === 'list') return { data: [], error: null }
      return { data: null, error: null } // idempotent lookup: not yet recorded
    })
    const { POST } = await import('@/app/api/feed/react/confirm/route')
    const res = await POST(makeReq({ action: 'like', targetTxid: TXID_A, txid: PAY_TXID }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('reacted')
    expect(json.event.txid).toBe(PAY_TXID)
    // Already final at detection → born final, so the sweep never touches it.
    expect(captured.finalized_at).not.toBeNull()
    expect(mocks.resolveOrCreateAccount).toHaveBeenCalledWith('ecash:qfan')
  })

  it('is idempotent on an already-recorded reaction txid', async () => {
    mocks.verifyFeedTxid.mockResolvedValue({
      txid: PAY_TXID,
      payerAddress: 'ecash:qfan',
      sats: 10000,
      isFinal: true,
    })
    const existing = { id: 'evt-1', txid: PAY_TXID, action: 5, target_txid: TXID_A }
    useSupabase((state, term) => {
      if (state.op === 'insert') throw new Error('should not insert on idempotent path')
      if (state.table === 'feed_posts') return { data: liveTarget, error: null }
      if (state.table === 'feed_events' && term === 'list') return { data: [], error: null }
      return { data: existing, error: null } // idempotent lookup hits
    })
    const { POST } = await import('@/app/api/feed/react/confirm/route')
    const res = await POST(makeReq({ action: 'like', targetTxid: TXID_A, txid: PAY_TXID }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('reacted')
    expect(json.event).toMatchObject(existing)
    expect(mocks.resolveOrCreateAccount).not.toHaveBeenCalled()
  })
})
