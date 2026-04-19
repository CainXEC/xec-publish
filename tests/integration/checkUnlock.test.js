import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => {
  const maybeSingle = vi.fn()
  const limit = vi.fn(() => ({ maybeSingle }))
  const eq2 = vi.fn(() => ({ limit }))
  const eq1 = vi.fn(() => ({ eq: eq2 }))
  const select = vi.fn(() => ({ eq: eq1 }))
  const from = vi.fn(() => ({ select }))
  const createServerSupabase = vi.fn(() => ({ from }))
  return { maybeSingle, limit, eq2, eq1, select, from, createServerSupabase }
})

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabase: db.createServerSupabase,
}))

const verifyCookieValue = vi.fn(() => ({ valid: false, txid: '' }))
const signCookieValue = vi.fn(() => 'txid.signature')

vi.mock('@/lib/cookieSigner', () => ({
  verifyCookieValue,
  signCookieValue,
}))

describe('/api/check-unlock/[postId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns unlocked false without wallet address and no valid cookie', async () => {
    const { GET } = await import('@/app/api/check-unlock/[postId]/route')

    const req = {
      headers: { get: vi.fn(() => null) },
      cookies: { get: vi.fn(() => null) },
      nextUrl: new URL('http://localhost/api/check-unlock/abc'),
    }

    const res = await GET(req, { params: Promise.resolve({ postId: 'abc' }) })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ unlocked: false })
  })

  it('returns unlocked true when cookie verifies', async () => {
    verifyCookieValue.mockReturnValueOnce({ valid: true, txid: 'x' })
    const { GET } = await import('@/app/api/check-unlock/[postId]/route')

    const req = {
      headers: { get: vi.fn(() => null) },
      cookies: { get: vi.fn(() => ({ value: 'signed-cookie' })) },
      nextUrl: new URL('http://localhost/api/check-unlock/abc'),
    }

    const res = await GET(req, { params: Promise.resolve({ postId: 'abc' }) })
    await expect(res.json()).resolves.toEqual({ unlocked: true })
  })

  it('returns unlocked true when unlock exists for wallet', async () => {
    db.maybeSingle.mockResolvedValueOnce({
      data: { id: 'u1', txid: 'tx1' },
      error: null,
    })

    const { GET } = await import('@/app/api/check-unlock/[postId]/route')
    const req = {
      headers: { get: vi.fn(() => null) },
      cookies: { get: vi.fn(() => null) },
      nextUrl: new URL('http://localhost/api/check-unlock/abc?walletAddress=ecash:qxyz'),
    }

    const res = await GET(req, { params: Promise.resolve({ postId: 'abc' }) })
    await expect(res.json()).resolves.toEqual({ unlocked: true })
    expect(signCookieValue).toHaveBeenCalledWith('abc', 'tx1')
  })
})
