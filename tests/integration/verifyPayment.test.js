import { beforeEach, describe, expect, it, vi } from 'vitest'

const maybeSingle = vi.fn()
const eq = vi.fn(() => ({ maybeSingle }))
const select = vi.fn(() => ({ eq }))
const from = vi.fn(() => ({ select }))

// Route reads its client from lib/db (adminDb) — the single server entry point.
vi.mock('@/lib/db', () => ({
  adminDb: () => ({ from }),
}))

const verifyAndRecordUnlock = vi.fn()
vi.mock('@/lib/verifyPaymentUnlock', () => ({
  verifyAndRecordUnlock,
}))

const signCookieValue = vi.fn(() => 'signed-cookie')
vi.mock('@/lib/cookieSigner', () => ({
  signCookieValue,
}))

vi.mock('chronik-client', () => ({
  ChronikClient: vi.fn(function ChronikClient() {
    return {}
  }),
}))

describe('/api/verify-payment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when txid or postId is missing', async () => {
    const { POST } = await import('@/app/api/verify-payment/route')
    const req = {
      headers: { get: vi.fn(() => null) },
      json: vi.fn(async () => ({ txid: '', postId: '' })),
    }

    const res = await POST(req)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Missing txid or postId' })
  })

  it('returns unlocked true AND the entitled body inline for a valid flow', async () => {
    maybeSingle
      // 1) post lookup (price / author)
      .mockResolvedValueOnce({
        data: {
          id: 'p1',
          price_xec: 100,
          author_id: 'a1',
          authors: { xec_address: 'ecash:qauthor' },
        },
        error: null,
      })
      // 2) body lookup — piggybacked onto the unlock response so the client can
      //    paint the story without a second round-trip.
      .mockResolvedValueOnce({
        data: { body: '<p>Secret unlocked.</p>' },
        error: null,
      })
    verifyAndRecordUnlock.mockResolvedValueOnce({ ok: true, txid: 'abc123' })

    const { POST } = await import('@/app/api/verify-payment/route')
    const req = {
      headers: { get: vi.fn(() => null) },
      json: vi.fn(async () => ({ txid: 'abc123', postId: 'p1' })),
    }
    const res = await POST(req)

    expect(res.status).toBe(200)
    const payload = await res.json()
    expect(payload.unlocked).toBe(true)
    // The full body comes back inline (sanitized), not a separate fetch.
    expect(typeof payload.bodyHtml).toBe('string')
    expect(payload.bodyHtml).toContain('Secret unlocked.')
    expect(verifyAndRecordUnlock).toHaveBeenCalled()
    expect(signCookieValue).toHaveBeenCalledWith('p1', 'abc123')
  })

  it('still unlocks with bodyHtml:null if the body fetch fails (client refetches)', async () => {
    maybeSingle
      .mockResolvedValueOnce({
        data: {
          id: 'p1',
          price_xec: 100,
          author_id: 'a1',
          authors: { xec_address: 'ecash:qauthor' },
        },
        error: null,
      })
      // body lookup rejects — the unlock must NOT fail; bodyHtml just comes back
      // null and the client falls back to the reader-route fetch.
      .mockRejectedValueOnce(new Error('db blip'))
    verifyAndRecordUnlock.mockResolvedValueOnce({ ok: true, txid: 'abc123' })

    const { POST } = await import('@/app/api/verify-payment/route')
    const req = {
      headers: { get: vi.fn(() => null) },
      json: vi.fn(async () => ({ txid: 'abc123', postId: 'p1' })),
    }
    const res = await POST(req)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ unlocked: true, bodyHtml: null })
    expect(signCookieValue).toHaveBeenCalledWith('p1', 'abc123')
  })

  it('returns 202 finalizing while the payment is not yet Avalanche-final', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: {
        id: 'p1',
        price_xec: 100,
        author_id: 'a1',
        authors: { xec_address: 'ecash:qauthor' },
      },
      error: null,
    })
    verifyAndRecordUnlock.mockResolvedValueOnce({
      ok: false,
      reason: 'finalizing',
      error: 'Payment is finalizing',
    })

    const { POST } = await import('@/app/api/verify-payment/route')
    const req = {
      headers: { get: vi.fn(() => null) },
      json: vi.fn(async () => ({ txid: 'abc123', postId: 'p1' })),
    }
    const res = await POST(req)

    expect(res.status).toBe(202)
    await expect(res.json()).resolves.toEqual({ finalizing: true })
    // No unlock cookie is set until the tx finalizes.
    expect(signCookieValue).not.toHaveBeenCalled()
  })
})
