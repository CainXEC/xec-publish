import { beforeEach, describe, expect, it, vi } from 'vitest'
import { contentHashHex } from '@/lib/feedProtocol'

// The agent REST surface: POST /api/agent/article (draft insert through
// savePostCore — the same transform chain as the dashboard editor) and
// POST /api/agent/article/publish (owner + publish_paid gate, then the
// published/published_at flip). Boundaries (Supabase, auth, rate limit) are
// mocked; the transform chain runs for real so storedBody proves the contract
// the external agent relies on: what comes back IS what the DB holds, and
// sha256 over it predicts the publish contentHash.
const db = vi.hoisted(() => {
  const state = {
    lastInsertPayload: null,
    lastUpdatePayload: null,
    existingRow: null,
    updateResult: null,
  }
  const from = vi.fn(() => ({
    // draft insert: .insert(payload).select('id').single()
    insert: vi.fn((payload) => {
      state.lastInsertPayload = payload
      return {
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: { id: 'post-new' }, error: null })),
        })),
      }
    }),
    // publish-gate lookup: .select(...).eq('id').maybeSingle()
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({ data: state.existingRow, error: null })),
      })),
    })),
    // publish flip: .update(payload).eq('id').eq('author_id').select(...).maybeSingle()
    update: vi.fn((payload) => {
      state.lastUpdatePayload = payload
      return {
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn(async () => state.updateResult),
            })),
          })),
        })),
      }
    }),
  }))
  return { from, state }
})

vi.mock('@/lib/supabase-admin', () => ({
  createSupabaseAdminClient: vi.fn(() => ({ from: db.from })),
}))

const getAuthedAccount = vi.fn(async () => ({ authorId: 'author-1', accountId: 'acct-1' }))
vi.mock('@/lib/authHelpers', () => ({ getAuthedAccount }))

const rateLimitMock = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: rateLimitMock,
  getClientIp: () => 'test-ip',
}))

function makeReq(body) {
  return {
    headers: { get: () => null },
    json: async () => body,
  }
}

const RAW_BODY =
  '<p>Intro paragraph with <a href="https://example.com/x">an external link</a> inside</p>' +
  '<div data-paywall-break="true"></div>' +
  '<p>locked conclusion</p>'

beforeEach(() => {
  vi.clearAllMocks()
  db.state.lastInsertPayload = null
  db.state.lastUpdatePayload = null
  db.state.existingRow = {
    id: 'post-1',
    author_id: 'author-1',
    slug: 'my-slug',
    publish_paid: true,
    published_at: null,
  }
  db.state.updateResult = { data: { id: 'post-1', slug: 'my-slug' }, error: null }
})

describe('POST /api/agent/article (draft creation)', () => {
  it('stores a published:false draft through the real transform chain and echoes the stored bytes', async () => {
    const { POST } = await import('@/app/api/agent/article/route')
    const res = await POST(
      makeReq({ title: 'Hello Agent World', body: RAW_BODY, priceXec: 55 }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.id).toBe('post-new')

    const inserted = db.state.lastInsertPayload
    expect(inserted).not.toBeNull()
    expect(inserted.author_id).toBe('author-1')
    expect(inserted.published).toBe(false)
    expect(inserted.price_xec).toBe(55)
    expect(inserted.slug).toBe(json.finalSlug)
    expect(json.finalSlug.length).toBeGreaterThan(0)
    expect(typeof inserted.reading_time_minutes).toBe('number')

    // The link policy ran at write time: the external anchor is unwrapped to
    // inert text in what got stored.
    expect(inserted.body).toContain('an external link')
    expect(inserted.body).not.toContain('https://example.com')

    // Teaser comes only from above the paywall marker.
    expect(inserted.teaser).toContain('Intro paragraph')
    expect(inserted.teaser).not.toContain('locked conclusion')

    // THE agent contract: storedBody is byte-for-byte what the DB holds, so
    // sha256 over it predicts the on-chain publish contentHash.
    expect(json.storedBody).toBe(inserted.body)
    expect(contentHashHex(json.storedBody)).toBe(contentHashHex(inserted.body))
  })

  it('honors a caller-provided url-safe slug', async () => {
    const { POST } = await import('@/app/api/agent/article/route')
    const res = await POST(
      makeReq({ title: 'T', slug: 'my-custom-slug', body: RAW_BODY, priceXec: 100 }),
    )
    const json = await res.json()
    expect(json.finalSlug).toBe('my-custom-slug')
    expect(db.state.lastInsertPayload.slug).toBe('my-custom-slug')
  })

  it('rejects a signed-out caller with 401 before touching the database', async () => {
    getAuthedAccount.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/agent/article/route')
    const res = await POST(makeReq({ title: 'T', body: RAW_BODY, priceXec: 100 }))
    expect(res.status).toBe(401)
    expect(db.from).not.toHaveBeenCalled()
  })

  it('rejects missing title/body with 400', async () => {
    const { POST } = await import('@/app/api/agent/article/route')
    const res = await POST(makeReq({ title: '  ', body: RAW_BODY }))
    expect(res.status).toBe(400)
    const res2 = await POST(makeReq({ title: 'T' }))
    expect(res2.status).toBe(400)
    expect(db.from).not.toHaveBeenCalled()
  })

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockResolvedValueOnce(false)
    const { POST } = await import('@/app/api/agent/article/route')
    const res = await POST(makeReq({ title: 'T', body: RAW_BODY }))
    expect(res.status).toBe(429)
  })
})

describe('POST /api/agent/article/publish (flip live)', () => {
  it('publishes a paid draft and stamps published_at once', async () => {
    const { POST } = await import('@/app/api/agent/article/publish/route')
    const res = await POST(makeReq({ postId: 'post-1' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true, slug: 'my-slug' })
    expect(db.state.lastUpdatePayload.published).toBe(true)
    expect(typeof db.state.lastUpdatePayload.published_at).toBe('string')
  })

  it('does not overwrite an existing published_at stamp', async () => {
    db.state.existingRow.published_at = '2026-01-01T00:00:00.000Z'
    const { POST } = await import('@/app/api/agent/article/publish/route')
    const res = await POST(makeReq({ postId: 'post-1' }))
    expect(res.status).toBe(200)
    expect(db.state.lastUpdatePayload.published).toBe(true)
    expect('published_at' in db.state.lastUpdatePayload).toBe(false)
  })

  it('unpaid draft is NOT published — 402 needsPayment, no write', async () => {
    db.state.existingRow.publish_paid = false
    const { POST } = await import('@/app/api/agent/article/publish/route')
    const res = await POST(makeReq({ postId: 'post-1' }))
    expect(res.status).toBe(402)
    const json = await res.json()
    expect(json.needsPayment).toBe(true)
    expect(db.state.lastUpdatePayload).toBeNull()
  })

  it("another author's post reads as not found — 404, no write", async () => {
    db.state.existingRow.author_id = 'author-2'
    const { POST } = await import('@/app/api/agent/article/publish/route')
    const res = await POST(makeReq({ postId: 'post-1' }))
    expect(res.status).toBe(404)
    expect(db.state.lastUpdatePayload).toBeNull()
  })

  it('rejects a signed-out caller with 401 before touching the database', async () => {
    getAuthedAccount.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/agent/article/publish/route')
    const res = await POST(makeReq({ postId: 'post-1' }))
    expect(res.status).toBe(401)
    expect(db.from).not.toHaveBeenCalled()
  })
})
