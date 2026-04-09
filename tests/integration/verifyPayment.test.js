import { beforeEach, describe, expect, it, vi } from 'vitest'

const maybeSingle = vi.fn()
const eq = vi.fn(() => ({ maybeSingle }))
const select = vi.fn(() => ({ eq }))
const from = vi.fn(() => ({ select }))

vi.mock('@/lib/supabase', () => ({
  supabase: { from },
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
    const req = { json: vi.fn(async () => ({ txid: '', postId: '' })) }

    const res = await POST(req)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Missing txid or postId' })
  })

  it('returns unlocked true for valid verification flow', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: {
        id: 'p1',
        price_xec: 100,
        author_id: 'a1',
        authors: { xec_address: 'ecash:qauthor' },
      },
      error: null,
    })
    verifyAndRecordUnlock.mockResolvedValueOnce({ ok: true, txid: 'abc123' })

    const { POST } = await import('@/app/api/verify-payment/route')
    const req = { json: vi.fn(async () => ({ txid: 'abc123', postId: 'p1' })) }
    const res = await POST(req)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ unlocked: true })
    expect(verifyAndRecordUnlock).toHaveBeenCalled()
    expect(signCookieValue).toHaveBeenCalledWith('p1', 'abc123')
  })
})
