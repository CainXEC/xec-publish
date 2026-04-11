import { beforeEach, describe, expect, it, vi } from 'vitest'

const history = vi.fn()
const address = vi.fn(() => ({ history }))

vi.mock('chronik-client', () => ({
  ChronikClient: vi.fn(function ChronikClient() {
    return { address }
  }),
}))

describe('/api/latest-tx/[address]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when address param missing', async () => {
    const { GET } = await import('@/app/api/latest-tx/[address]/route')
    const req = { headers: { get: vi.fn(() => null) } }
    const res = await GET(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Missing address' })
  })

  it('returns txid when history has txs', async () => {
    history.mockResolvedValueOnce({ txs: [{ txid: 'tx-1' }] })

    const { GET } = await import('@/app/api/latest-tx/[address]/route')
    const req = { headers: { get: vi.fn(() => null) } }
    const res = await GET(req, {
      params: Promise.resolve({ address: encodeURIComponent('ecash:qabc') }),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ txid: 'tx-1' })
  })
})
