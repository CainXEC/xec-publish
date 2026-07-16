import { describe, it, expect } from 'vitest'
import { parseEcashBip21, xecToSats } from '@/lib/pocket/bip21'
import { buildPaywallBip21, buildPublishFeeBip21 } from '@/lib/paymentSplit'

const AUTHOR = 'qp5kphz2sq69fsaw6su5gn3fpsa5wp6j7yw8rpf3fd'
const PLATFORM = 'qrw35trzq7hagejru2h3eqf5eyhxxmg4cul69u7am3'
const OPRET = '04504f57520055' + '20' + 'a'.repeat(64)

describe('xecToSats', () => {
  it('does string math, never floats', () => {
    expect(xecToSats('100')).toBe(10000n)
    expect(xecToSats('5.50')).toBe(550n)
    expect(xecToSats('5.5')).toBe(550n)
    expect(xecToSats('0.01')).toBe(1n)
    // The classic float trap: 0.1 + 0.2. String math is exact.
    expect(xecToSats('0.30')).toBe(30n)
    // Beyond Number.MAX_SAFE_INTEGER-in-sats stays exact.
    expect(xecToSats('92233720368547758')).toBe(9223372036854775800n)
  })

  it('rejects anything but a plain non-negative ≤2dp decimal', () => {
    expect(xecToSats('')).toBeNull()
    expect(xecToSats('1.234')).toBeNull()
    expect(xecToSats('-5')).toBeNull()
    expect(xecToSats('1e3')).toBeNull()
    expect(xecToSats('.5')).toBeNull()
    expect(xecToSats('5.')).toBeNull()
    expect(xecToSats('0x10')).toBeNull()
  })
})

describe('parseEcashBip21', () => {
  it('parses the 94/6 paywall shape our prepare endpoints emit', () => {
    const bip21 = buildPaywallBip21(AUTHOR, PLATFORM, 94, 6, OPRET)
    const parsed = parseEcashBip21(bip21)
    expect(parsed).not.toBeNull()
    expect(parsed.outputs).toEqual([
      { address: `ecash:${AUTHOR}`, sats: 9400n },
      { address: `ecash:${PLATFORM}`, sats: 600n },
    ])
    expect(parsed.opReturnRaw).toBe(OPRET)
    expect(parsed.totalSats).toBe(10000n)
  })

  it('parses the single-output platform shape (post / publish fee)', () => {
    const bip21 = buildPublishFeeBip21(PLATFORM, 100, OPRET)
    const parsed = parseEcashBip21(bip21)
    expect(parsed.outputs).toEqual([{ address: `ecash:${PLATFORM}`, sats: 10000n }])
    expect(parsed.opReturnRaw).toBe(OPRET)
  })

  it('parses without an op_return_raw and with decimal amounts', () => {
    const parsed = parseEcashBip21(`ecash:${AUTHOR}?amount=5.50`)
    expect(parsed.outputs).toEqual([{ address: `ecash:${AUTHOR}`, sats: 550n }])
    expect(parsed.opReturnRaw).toBeNull()
  })

  it('binds each amount to the most recent address (order matters)', () => {
    const parsed = parseEcashBip21(
      `ecash:${AUTHOR}?amount=1&addr=${PLATFORM}&amount=2&addr=${AUTHOR}&amount=3`,
    )
    expect(parsed.outputs.map((o) => o.sats)).toEqual([100n, 200n, 300n])
  })

  it('returns null on any unknown param (Cashtab handles those, not the pocket)', () => {
    expect(parseEcashBip21(`ecash:${AUTHOR}?amount=1&label=hi`)).toBeNull()
    expect(parseEcashBip21(`ecash:${AUTHOR}?amount=1&token_id=abc`)).toBeNull()
    expect(parseEcashBip21(`ecash:${AUTHOR}?amount=1&message=x`)).toBeNull()
  })

  it('returns null on malformed money or structure', () => {
    expect(parseEcashBip21('')).toBeNull()
    expect(parseEcashBip21('ecash:?amount=1')).toBeNull()
    expect(parseEcashBip21(`ecash:${AUTHOR}`)).toBeNull() // no amount at all
    expect(parseEcashBip21(`ecash:${AUTHOR}?amount=`)).toBeNull()
    expect(parseEcashBip21(`ecash:${AUTHOR}?amount=1.234`)).toBeNull()
    expect(parseEcashBip21(`ecash:${AUTHOR}?amount=0`)).toBeNull()
    expect(parseEcashBip21(`ecash:${AUTHOR}?amount=1&amount=2`)).toBeNull() // two amounts, one address
    expect(parseEcashBip21(`ecash:${AUTHOR}?amount=1&addr=${PLATFORM}`)).toBeNull() // addr missing its amount
    expect(parseEcashBip21(`ecash:${AUTHOR}?amount=1&op_return_raw=zz`)).toBeNull()
    expect(parseEcashBip21(`ecash:${AUTHOR}?amount=1&op_return_raw=${OPRET}&op_return_raw=${OPRET}`)).toBeNull()
  })

  it('normalizes addresses to the prefixed lowercase form', () => {
    const parsed = parseEcashBip21(`ECASH:${AUTHOR.toUpperCase()}?amount=1`)
    expect(parsed.outputs[0].address).toBe(`ecash:${AUTHOR}`)
  })
})
