import { beforeEach, describe, expect, it, vi } from 'vitest'

// Query chains the route uses now:
//   from('account_addresses').select('address').eq('account_id', …)   (linked wallets)
//   from('unlocks').select(...).eq('post_id', …).in('payer_address', forms).limit(1).maybeSingle()
// The first chain stops at .eq(...) and is awaited directly; the mock's plain
// object is fine there (await of a non-thenable → data undefined → no rows).
const db = vi.hoisted(() => {
  const maybeSingle = vi.fn()
  const limit = vi.fn(() => ({ maybeSingle }))
  const inFn = vi.fn(() => ({ limit }))
  const eq1 = vi.fn(() => ({ in: inFn }))
  const select = vi.fn(() => ({ eq: eq1 }))
  const from = vi.fn(() => ({ select }))
  const createServerSupabase = vi.fn(() => ({ from }))
  return { maybeSingle, limit, inFn, eq1, select, from, createServerSupabase }
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

// The unlock is now restored ONLY from the authenticated session's proven
// address — never a client-supplied ?walletAddress.
const getAuthedAccount = vi.fn(async () => null)
vi.mock('@/lib/authHelpers', () => ({
  getAuthedAccount,
}))

function makeReq(url, cookieValue = null) {
  return {
    headers: { get: vi.fn(() => null) },
    cookies: { get: vi.fn(() => (cookieValue ? { value: cookieValue } : null)) },
    nextUrl: new URL(url),
  }
}

describe('/api/check-unlock/[postId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAuthedAccount.mockResolvedValue(null)
  })

  it('returns unlocked false with no session and no valid cookie', async () => {
    const { GET } = await import('@/app/api/check-unlock/[postId]/route')
    const res = await GET(makeReq('http://localhost/api/check-unlock/abc'), {
      params: Promise.resolve({ postId: 'abc' }),
    })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ unlocked: false })
  })

  it('returns unlocked true when the signed cookie verifies', async () => {
    verifyCookieValue.mockReturnValueOnce({ valid: true, txid: 'x' })
    const { GET } = await import('@/app/api/check-unlock/[postId]/route')
    const res = await GET(makeReq('http://localhost/api/check-unlock/abc', 'signed-cookie'), {
      params: Promise.resolve({ postId: 'abc' }),
    })
    await expect(res.json()).resolves.toEqual({ unlocked: true })
  })

  it("returns unlocked true when the logged-in account's own address has an unlock", async () => {
    getAuthedAccount.mockResolvedValueOnce({ accountId: 'acct-1', address: 'ecash:qxyz' })
    db.maybeSingle.mockResolvedValueOnce({ data: { id: 'u1', txid: 'tx1' }, error: null })

    const { GET } = await import('@/app/api/check-unlock/[postId]/route')
    const res = await GET(makeReq('http://localhost/api/check-unlock/abc'), {
      params: Promise.resolve({ postId: 'abc' }),
    })

    await expect(res.json()).resolves.toEqual({ unlocked: true })
    expect(signCookieValue).toHaveBeenCalledWith('abc', 'tx1')
    // the lookup was scoped to the account's proven address forms (normalized
    // bare + prefixed), never a client input
    expect(db.inFn).toHaveBeenCalledWith('payer_address', ['qxyz', 'ecash:qxyz'])
  })

  it('does NOT unlock from a client-supplied ?walletAddress without a session (bypass closed)', async () => {
    // Even if an unlock row would match, no session => never queried, never unlocked.
    db.maybeSingle.mockResolvedValue({ data: { id: 'u1', txid: 'tx1' }, error: null })

    const { GET } = await import('@/app/api/check-unlock/[postId]/route')
    const res = await GET(
      makeReq('http://localhost/api/check-unlock/abc?walletAddress=ecash:qvictim'),
      { params: Promise.resolve({ postId: 'abc' }) },
    )

    await expect(res.json()).resolves.toEqual({ unlocked: false })
    expect(signCookieValue).not.toHaveBeenCalled()
    expect(db.from).not.toHaveBeenCalled()
  })
})
