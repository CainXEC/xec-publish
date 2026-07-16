import { beforeEach, describe, expect, it, vi } from 'vitest'

// The pay gateway's routing brain: pocket-eligible → local sign; everything
// else (and every failure) → the exact Cashtab path. Store, cashtabPay, and
// the signer are mocked; the routing logic runs for real.

const mocks = vi.hoisted(() => ({
  snapshot: { status: 'ready', registered: true, balanceSats: 1_000_000, accountId: 'acct-1' },
  spendContext: { skHex: 'ab'.repeat(32), address: 'ecash:qpocket' },
  pocketSpend: vi.fn(async () => ({ ok: true, txid: 'f'.repeat(64) })),
  refreshPocketBalance: vi.fn(),
  extensionAvailable: false,
  payWithCashtab: vi.fn(async () => ({ ok: true, via: 'extension', txid: 'e'.repeat(64) })),
  beginCashtabPayment: vi.fn(() => ({ hasExtension: false, placeholderWindow: null })),
  completeCashtabPayment: vi.fn(async () => ({ ok: true, via: 'tab' })),
  abortCashtabPayment: vi.fn(),
}))

vi.mock('@/lib/pocket/store', () => ({
  POCKET_ENABLED: true,
  getPocketSnapshot: () => mocks.snapshot,
  getPocketSpendContext: () => mocks.spendContext,
  refreshPocketBalance: mocks.refreshPocketBalance,
}))
vi.mock('@/lib/pocket/wallet', () => ({ pocketSpend: mocks.pocketSpend }))
vi.mock('@/lib/ecash/cashtabPay', () => ({
  payWithCashtab: mocks.payWithCashtab,
  beginCashtabPayment: mocks.beginCashtabPayment,
  completeCashtabPayment: mocks.completeCashtabPayment,
  abortCashtabPayment: mocks.abortCashtabPayment,
  isCashtabExtensionAvailable: () => mocks.extensionAvailable,
}))

const PAY = { bip21: 'ecash:qq?amount=1', cashtabUrl: 'https://cashtab.com/#/send?bip21=x' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.snapshot = { status: 'ready', registered: true, balanceSats: 1_000_000, accountId: 'acct-1' }
  mocks.spendContext = { skHex: 'ab'.repeat(32), address: 'ecash:qpocket' }
  mocks.extensionAvailable = false
  mocks.pocketSpend.mockResolvedValue({ ok: true, txid: 'f'.repeat(64) })
})

describe('spendEligibility', () => {
  it('accepts an allowlisted, affordable, under-cap action', async () => {
    const { spendEligibility } = await import('@/lib/pocket/payGateway')
    expect(spendEligibility('like', 100).eligible).toBe(true)
    expect(spendEligibility('unlock', 1000).eligible).toBe(true)
  })

  it('routes big-ticket kinds to Cashtab regardless of balance (tier by value)', async () => {
    const { spendEligibility } = await import('@/lib/pocket/payGateway')
    for (const kind of ['publish', 'mint', 'login', 'change-address', 'anything-else']) {
      expect(spendEligibility(kind, 100)).toEqual({ eligible: false, reason: 'kind' })
    }
  })

  it('enforces the per-tx ceiling and the fee margin', async () => {
    const { spendEligibility, POCKET_MAX_PER_TX_XEC } = await import('@/lib/pocket/payGateway')
    expect(spendEligibility('tip', POCKET_MAX_PER_TX_XEC + 1)).toEqual({ eligible: false, reason: 'over_max' })
    // 100 XEC = 10_000 sats; balance of exactly 10_000 leaves no fee headroom.
    mocks.snapshot = { ...mocks.snapshot, balanceSats: 10_000 }
    expect(spendEligibility('like', 100)).toEqual({ eligible: false, reason: 'balance' })
  })

  it('requires a ready, registered pocket', async () => {
    const { spendEligibility } = await import('@/lib/pocket/payGateway')
    mocks.snapshot = { ...mocks.snapshot, registered: false }
    expect(spendEligibility('like', 100)).toEqual({ eligible: false, reason: 'no_pocket' })
    mocks.snapshot = { ...mocks.snapshot, status: 'none', registered: true }
    expect(spendEligibility('like', 100)).toEqual({ eligible: false, reason: 'no_pocket' })
  })
})

describe('beginPayment / completePayment', () => {
  it('pocket mode opens nothing and pays locally, feeding back the txid', async () => {
    const { beginPayment, completePayment } = await import('@/lib/pocket/payGateway')
    const handle = beginPayment({ kind: 'like', amountXec: 100 })
    expect(handle).toEqual({ mode: 'pocket' })
    expect(mocks.beginCashtabPayment).not.toHaveBeenCalled()

    const r = await completePayment(handle, PAY)
    expect(r).toEqual({ ok: true, via: 'pocket', txid: 'f'.repeat(64) })
    expect(mocks.pocketSpend).toHaveBeenCalledWith({ skHex: mocks.spendContext.skHex, bip21: PAY.bip21 })
    expect(mocks.refreshPocketBalance).toHaveBeenCalled()
    expect(mocks.completeCashtabPayment).not.toHaveBeenCalled()
  })

  it('ineligible actions take the untouched Cashtab path', async () => {
    const { beginPayment, completePayment, abortPayment } = await import('@/lib/pocket/payGateway')
    mocks.snapshot = { ...mocks.snapshot, balanceSats: 0 }
    const handle = beginPayment({ kind: 'like', amountXec: 100 })
    expect(handle.mode).toBe('cashtab')
    expect(mocks.beginCashtabPayment).toHaveBeenCalled()

    await completePayment(handle, PAY)
    expect(mocks.completeCashtabPayment).toHaveBeenCalledWith(handle.gesture, PAY)
    expect(mocks.pocketSpend).not.toHaveBeenCalled()

    abortPayment(handle)
    expect(mocks.abortCashtabPayment).toHaveBeenCalledWith(handle.gesture)
  })

  it('a failed pocket spend WITHOUT the extension reports pocket_error (pending UI carries it)', async () => {
    const { completePayment } = await import('@/lib/pocket/payGateway')
    mocks.pocketSpend.mockResolvedValue({ ok: false, error: 'Pocket balance is too low for this payment.' })
    const r = await completePayment({ mode: 'pocket' }, PAY)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('pocket_error')
    expect(r.message).toMatch(/balance/i)
    expect(mocks.payWithCashtab).not.toHaveBeenCalled()
  })

  it('a failed pocket spend WITH the extension silently retries via the extension popup', async () => {
    const { completePayment } = await import('@/lib/pocket/payGateway')
    mocks.pocketSpend.mockResolvedValue({ ok: false, error: 'boom' })
    mocks.extensionAvailable = true
    const r = await completePayment({ mode: 'pocket' }, PAY)
    expect(mocks.payWithCashtab).toHaveBeenCalledWith(PAY)
    expect(r.via).toBe('extension')
  })

  it('a vanished pocket record falls back gracefully', async () => {
    const { completePayment } = await import('@/lib/pocket/payGateway')
    mocks.spendContext = null
    const r = await completePayment({ mode: 'pocket' }, PAY)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('pocket_error')
  })

  it('abortPayment is a no-op for pocket handles', async () => {
    const { abortPayment } = await import('@/lib/pocket/payGateway')
    abortPayment({ mode: 'pocket' })
    expect(mocks.abortCashtabPayment).not.toHaveBeenCalled()
  })
})

describe('payDirect (known-bip21 flows: unlock)', () => {
  it('pays from the pocket when eligible', async () => {
    const { payDirect } = await import('@/lib/pocket/payGateway')
    const r = await payDirect({ kind: 'unlock', amountXec: 500, ...PAY })
    expect(r.via).toBe('pocket')
    expect(mocks.pocketSpend).toHaveBeenCalled()
  })

  it('falls through to payWithCashtab when not', async () => {
    const { payDirect } = await import('@/lib/pocket/payGateway')
    const r = await payDirect({ kind: 'unlock', amountXec: 999999, ...PAY })
    expect(mocks.payWithCashtab).toHaveBeenCalledWith(PAY)
    expect(mocks.pocketSpend).not.toHaveBeenCalled()
    expect(r.via).toBe('extension')
  })
})

describe('flag off — literal pass-throughs', () => {
  it('beginPayment always routes to Cashtab when POCKET_ENABLED is false', async () => {
    vi.resetModules()
    vi.doMock('@/lib/pocket/store', () => ({
      POCKET_ENABLED: false,
      getPocketSnapshot: () => mocks.snapshot,
      getPocketSpendContext: () => mocks.spendContext,
      refreshPocketBalance: mocks.refreshPocketBalance,
    }))
    const { beginPayment, spendEligibility } = await import('@/lib/pocket/payGateway')
    expect(spendEligibility('like', 100)).toEqual({ eligible: false, reason: 'disabled' })
    const handle = beginPayment({ kind: 'like', amountXec: 100 })
    expect(handle.mode).toBe('cashtab')
    expect(mocks.beginCashtabPayment).toHaveBeenCalled()
    vi.doUnmock('@/lib/pocket/store')
    vi.resetModules()
  })
})
