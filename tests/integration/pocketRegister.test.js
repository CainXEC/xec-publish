import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sha256 } from 'ecash-lib'

// The pocket-register money path. Session, rate-limit, and Supabase are mocked
// at the boundary; the CRYPTO runs for real — address decoding, pubkey↔address
// binding, and the signMsg possession proof are exactly what production runs.

const mocks = vi.hoisted(() => ({
  getChallengeSession: vi.fn(async () => null),
  primaryAddressForAccount: vi.fn(async () => 'ecash:qprimary'),
  rateLimit: vi.fn(async () => true),
  maybeSingle: vi.fn(async () => ({ data: null, error: null })),
  rpc: vi.fn(async () => ({ data: { ok: true, already: false, absorbed: false }, error: null })),
}))

vi.mock('@/lib/session', () => ({ getChallengeSession: mocks.getChallengeSession }))
vi.mock('@/lib/walletAuth', () => ({ primaryAddressForAccount: mocks.primaryAddressForAccount }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: mocks.rateLimit, getClientIp: () => 'test-ip' }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }),
    }),
    rpc: mocks.rpc,
  }),
}))

// A REAL pocket keypair, derived exactly like the client does (golden wallet
// from pocketDerivation.test.js). The possession proof must verify for real.
import { parsePastedSignature, derivePocketFromSignature, buildRegisterProofString, signRegisterProof, POCKET_SENTENCE_V1 } from '@/lib/pocket/derive'
import { signMsg } from 'ecash-lib'

const WALLET_SK = sha256(new TextEncoder().encode('pow-pocket-golden-wallet'))
const SIG = signMsg(POCKET_SENTENCE_V1, WALLET_SK)
const POCKET = derivePocketFromSignature(parsePastedSignature(SIG).sigBytes)
const ACCOUNT_ID = 'acct-1'
const PROOF = signRegisterProof(POCKET.skHex, buildRegisterProofString(ACCOUNT_ID, POCKET.address))

function makeReq(body) {
  return {
    headers: { get: () => null },
    json: async () => body,
  }
}

const goodBody = () => ({ address: POCKET.address, pubkey: POCKET.pkHex, proofSig: PROOF })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rateLimit.mockResolvedValue(true)
  mocks.getChallengeSession.mockResolvedValue({ accountId: ACCOUNT_ID, address: 'ecash:qprimary', via: 'challenge' })
  mocks.primaryAddressForAccount.mockResolvedValue('ecash:qprimary')
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
  mocks.rpc.mockResolvedValue({ data: { ok: true, already: false, absorbed: false }, error: null })
})

describe('POST /api/pocket/register', () => {
  it('requires a challenge-scope session (pay scope is not enough)', async () => {
    mocks.getChallengeSession.mockResolvedValue(null)
    const { POST } = await import('@/app/api/pocket/register/route')
    const res = await POST(makeReq(goodBody()))
    expect(res.status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('links a valid pocket: real proof verifies, RPC called with normalized args', async () => {
    const { POST } = await import('@/app/api/pocket/register/route')
    const res = await POST(makeReq(goodBody()))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.pocket.address).toBe(POCKET.address)
    expect(mocks.rpc).toHaveBeenCalledWith('link_pocket_address', {
      p_account_id: ACCOUNT_ID,
      p_address: POCKET.address,
      p_pubkey: POCKET.pkHex,
      p_replace: false,
    })
  })

  it('rejects a pubkey that does not match the address (400, no RPC)', async () => {
    const { POST } = await import('@/app/api/pocket/register/route')
    const res = await POST(makeReq({ ...goodBody(), pubkey: '02' + 'ab'.repeat(32) }))
    expect(res.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rejects a possession proof made for a DIFFERENT account (403, no RPC)', async () => {
    const wrongProof = signRegisterProof(POCKET.skHex, buildRegisterProofString('acct-999', POCKET.address))
    const { POST } = await import('@/app/api/pocket/register/route')
    const res = await POST(makeReq({ ...goodBody(), proofSig: wrongProof }))
    expect(res.status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rejects garbage proof signatures (403)', async () => {
    const { POST } = await import('@/app/api/pocket/register/route')
    const res = await POST(makeReq({ ...goodBody(), proofSig: 'AAAA' }))
    expect(res.status).toBe(403)
  })

  it('refuses to mark the account primary as a pocket (400)', async () => {
    mocks.primaryAddressForAccount.mockResolvedValue(POCKET.address)
    const { POST } = await import('@/app/api/pocket/register/route')
    const res = await POST(makeReq(goodBody()))
    expect(res.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('409s with the current pocket when a DIFFERENT one exists and replace is not set', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { address: 'ecash:qqolderpocketaddress', pubkey: '02' + 'cd'.repeat(32) },
      error: null,
    })
    const { POST } = await import('@/app/api/pocket/register/route')
    const res = await POST(makeReq(goodBody()))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('pocket_conflict')
    expect(json.currentPocket.address).toBe('ecash:qqolderpocketaddress')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('passes replace=true through to the RPC', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { address: 'ecash:qqolderpocketaddress', pubkey: '02' + 'cd'.repeat(32) },
      error: null,
    })
    const { POST } = await import('@/app/api/pocket/register/route')
    const res = await POST(makeReq({ ...goodBody(), replace: true }))
    expect(res.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('link_pocket_address', expect.objectContaining({ p_replace: true }))
  })

  it('is idempotent when the same pocket is re-registered (restore path)', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, already: true, absorbed: false }, error: null })
    const { POST } = await import('@/app/api/pocket/register/route')
    const res = await POST(makeReq(goodBody()))
    expect(res.status).toBe(200)
    expect((await res.json()).already).toBe(true)
  })

  it('maps RPC pocket_has_account to a 409 with support copy', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'pocket_has_account' } })
    const { POST } = await import('@/app/api/pocket/register/route')
    const res = await POST(makeReq(goodBody()))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/account activity/i)
  })
})
