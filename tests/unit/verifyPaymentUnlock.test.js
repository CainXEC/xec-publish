import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getOutputScriptFromAddress } from 'ecashaddrjs'
import { toSatsFromXec, verifyAndRecordUnlock } from '@/lib/verifyPaymentUnlock'
import { encodeFeedOpReturnRaw, FEED_ACTION } from '@/lib/feedProtocol'

describe('toSatsFromXec', () => {
  it('converts 1 XEC to 100 satoshis', () => {
    expect(toSatsFromXec(1)).toBe(100n)
  })

  it('converts 100 XEC to 10000 satoshis', () => {
    expect(toSatsFromXec(100)).toBe(10000n)
  })

  it('returns null for invalid values', () => {
    expect(toSatsFromXec(-1)).toBeNull()
    expect(toSatsFromXec('abc')).toBeNull()
    expect(toSatsFromXec(null)).toBe(0n)
  })

  it('handles decimal XEC amounts', () => {
    expect(toSatsFromXec(1.5)).toBe(150n)
  })
})

// -----------------------------------------------------------------------------
// Recipient-binding regression tests for verifyAndRecordUnlock.
//
// The paywall bypass these guard against: the unlock check must confirm the
// payment's outputs actually pay the AUTHOR and PLATFORM addresses — not merely
// that *some* output meets each amount threshold. Amount-only matching would let
// anyone build a tx paying their own change outputs (≥ thresholds) with a valid
// POWR unlock marker and unlock any article for network fees, author/platform
// receiving nothing.
// -----------------------------------------------------------------------------
describe('verifyAndRecordUnlock — recipient binding', () => {
  // Three real, decodable addresses so getOutputScriptFromAddress works on both
  // sides of the comparison (matching how the lib derives the expected script).
  const PLATFORM_ADDR = 'ecash:qrw35trzq7hagejru2h3eqf5eyhxxmg4cul69u7am3'
  const AUTHOR_ADDR = 'ecash:qq703jnu09lw47vzp2xny4yh06twye8q65najumgcy'
  // A well-formed P2PKH script that belongs to neither party — the attacker's
  // own change output.
  const ATTACKER_SCRIPT = `76a914${'11'.repeat(20)}88ac`
  const BIG = 1_000_000_000 // sats, comfortably above any split threshold

  // A valid POWR unlock OP_RETURN so the tx clears the marker gate and reaches
  // the recipient check (the leading 0x6a is re-added; Cashtab strips it).
  const unlockOpReturn = {
    sats: 0,
    outputScript: `6a${encodeFeedOpReturnRaw({ action: FEED_ACTION.UNLOCK })}`,
  }

  const payTo = (addr, sats) => ({ sats, outputScript: getOutputScriptFromAddress(addr) })

  const fakeChronik = (outputs, { isFinal = false } = {}) => ({
    tx: async () => ({ outputs, isFinal, inputs: [] }),
  })

  const run = (outputs, opts) =>
    verifyAndRecordUnlock({
      chronik: fakeChronik(outputs, opts),
      txid: 'a'.repeat(64),
      postId: 'post-123',
      authorXecAddress: AUTHOR_ADDR,
      priceXec: 100,
      options: { verbose: false },
    })

  let prevPlatform
  beforeAll(() => {
    prevPlatform = process.env.PLATFORM_XEC_ADDRESS
    process.env.PLATFORM_XEC_ADDRESS = PLATFORM_ADDR
  })
  afterAll(() => {
    if (prevPlatform === undefined) delete process.env.PLATFORM_XEC_ADDRESS
    else process.env.PLATFORM_XEC_ADDRESS = prevPlatform
  })

  it('rejects a tx that pays the attacker instead of the author/platform', async () => {
    const res = await run([
      unlockOpReturn,
      { sats: BIG, outputScript: ATTACKER_SCRIPT },
      { sats: BIG, outputScript: ATTACKER_SCRIPT },
    ])
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/author output/i)
  })

  it('rejects a tx paying the author but not the platform', async () => {
    const res = await run([
      unlockOpReturn,
      payTo(AUTHOR_ADDR, BIG),
      { sats: BIG, outputScript: ATTACKER_SCRIPT },
    ])
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/platform output/i)
  })

  it('accepts correct author + platform outputs (reaches the finality gate)', async () => {
    // isFinal:false makes the recipient check pass and stop at the finality
    // gate — proving the money check accepted the correctly-addressed payment
    // without needing to mock Supabase.
    const res = await run(
      [unlockOpReturn, payTo(AUTHOR_ADDR, BIG), payTo(PLATFORM_ADDR, BIG)],
      { isFinal: false },
    )
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('finalizing')
  })
})
