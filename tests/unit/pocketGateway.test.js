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
  it('accepts any affordable action — the balance is the only price limit', async () => {
    const { spendEligibility } = await import('@/lib/pocket/payGateway')
    expect(spendEligibility('like', 100).eligible).toBe(true)
    expect(spendEligibility('unlock', 1000).eligible).toBe(true)
    expect(spendEligibility('publish', 1000).eligible).toBe(true)
    // balanceSats is 1_000_000 (= 10,000 XEC): a 9,900 XEC tip fits...
    expect(spendEligibility('tip', 9900).eligible).toBe(true)
    // ...and a bigger balance affords a bigger tip. No per-payment ceiling.
    mocks.snapshot = { ...mocks.snapshot, balanceSats: 3_000_000 }
    expect(spendEligibility('tip', 25_000).eligible).toBe(true)
  })

  it('routes structural exclusions to Cashtab regardless of balance', async () => {
    const { spendEligibility } = await import('@/lib/pocket/payGateway')
    // Proof-of-keys flows and NFT deliveries never touch the pocket; unknown
    // kinds fall through as a backstop.
    for (const kind of ['mint', 'claim', 'login', 'change-address', 'anything-else']) {
      expect(spendEligibility(kind, 100)).toEqual({ eligible: false, reason: 'kind' })
    }
  })

  it('enforces the fee margin (affordable means price + network fee)', async () => {
    const { spendEligibility } = await import('@/lib/pocket/payGateway')
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

describe('payDirect (known-bip21 flows: unlock, publish)', () => {
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

  it('reads the price off the BIP21 when amountXec is omitted', async () => {
    const { payDirect } = await import('@/lib/pocket/payGateway')
    const addr = 'qp5kphz2sq69fsaw6su5gn3fpsa5wp6j7yw8rpf3fd'
    // 1,000 XEC — affordable on the 10,000 XEC balance → pocket.
    const cheap = { bip21: `ecash:${addr}?amount=1000`, cashtabUrl: 'https://cashtab.com/#/send?bip21=x' }
    const r1 = await payDirect({ kind: 'publish', ...cheap })
    expect(r1.via).toBe('pocket')
    // 50,000 XEC — beyond the balance → Cashtab, automatically.
    const pricey = { bip21: `ecash:${addr}?amount=50000`, cashtabUrl: 'https://cashtab.com/#/send?bip21=x' }
    const r2 = await payDirect({ kind: 'publish', ...pricey })
    expect(mocks.payWithCashtab).toHaveBeenCalledWith(pricey)
    expect(r2.via).toBe('extension')
    // Unparseable BIP21 → never the pocket.
    mocks.payWithCashtab.mockClear()
    await payDirect({ kind: 'publish', bip21: `ecash:${addr}?amount=1&mystery=1`, cashtabUrl: 'x' })
    expect(mocks.payWithCashtab).toHaveBeenCalled()
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
