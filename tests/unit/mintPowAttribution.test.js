import { describe, it, expect } from 'vitest'
import {
  attributePowPayment,
  powIntentsOpenedAfter,
  POW_LATE_GRACE_SEC,
  POW_SKEW_SEC,
} from '@/lib/mintPowAttribution'

// -----------------------------------------------------------------------------
// Which handle a POW payment is for.
//
// A POW (SLP) send can't carry the mintId tag, so the old matcher took "any POW
// send from this wallet since the quote opened". Two ways that went wrong:
//   • the reconciler could hand an ABANDONED quote (still 'pending', no tab left
//     to expire it) the payment the buyer later made for a different name;
//   • a payment that landed after the 15-minute window found its row 'expired',
//     and nothing ever looked at it again — no NFT, no refund.
// These pin the rule the status poll and the reconciler now share.
// -----------------------------------------------------------------------------

const MIN = 60_000
const T0 = Date.parse('2026-10-20T10:00:00Z')
const iso = (ms) => new Date(ms).toISOString()
const sec = (ms) => Math.floor(ms / 1000)

/** A POW quote opened `openedMin` minutes after T0, with the usual 15-minute window. */
const quote = (id, openedMin, over = {}) => ({
  id,
  status: 'pending',
  created_at: iso(T0 + openedMin * MIN),
  expires_at: iso(T0 + (openedMin + 15) * MIN),
  expected_atoms: 10,
  payment_txid: null,
  ...over,
})
/** A payment of `atoms` POW first seen `atMin` minutes after T0. */
const pay = (atMin, atoms = 10n) => ({ seenAt: sec(T0 + atMin * MIN), powAtoms: atoms })

describe('one quote', () => {
  it('a payment inside the window is that quote’s', () => {
    expect(attributePowPayment(pay(3), [quote('A', 0)])).toBe('A')
  })

  it('a LATE payment still counts — even after the row expired (the stranded case)', () => {
    expect(attributePowPayment(pay(16), [quote('A', 0, { status: 'expired' })])).toBe('A')
  })

  it('counts up to the late grace after the window, not beyond (then a person decides)', () => {
    const closes = 15 + POW_LATE_GRACE_SEC / 60
    expect(attributePowPayment(pay(closes), [quote('A', 0, { status: 'expired' })])).toBe('A')
    expect(attributePowPayment(pay(closes + 1), [quote('A', 0, { status: 'expired' })])).toBeNull()
  })

  it('never counts a payment sent before the quote was opened (beyond clock skew)', () => {
    expect(attributePowPayment(pay(-(POW_SKEW_SEC / 60)), [quote('A', 0)])).toBe('A')
    expect(attributePowPayment(pay(-(POW_SKEW_SEC / 60) - 1), [quote('A', 0)])).toBeNull()
  })

  it('needs the price covered; an overpayment still counts', () => {
    expect(attributePowPayment(pay(3, 9n), [quote('A', 0)])).toBeNull()
    expect(attributePowPayment(pay(3, 25n), [quote('A', 0)])).toBe('A')
  })

  it('only open quotes: never paid / minted / failed ones', () => {
    for (const status of ['paid', 'minted', 'stuck', 'failed', 'refunded', 'contended']) {
      expect(attributePowPayment(pay(3), [quote('A', 0, { status })])).toBeNull()
    }
    expect(attributePowPayment(pay(3), [quote('A', 0, { payment_txid: 'f'.repeat(64) })])).toBeNull()
  })

  it('ignores a payment with no timestamp or no POW', () => {
    expect(attributePowPayment({ seenAt: 0, powAtoms: 10n }, [quote('A', 0)])).toBeNull()
    expect(attributePowPayment(pay(3, 0n), [quote('A', 0)])).toBeNull()
  })
})

describe('several quotes from the same wallet (the wrong-handle bug)', () => {
  it('changed their mind: abandoned A, then paid for B — B gets it, never A', () => {
    const quotes = [quote('A', 0), quote('B', 5)]
    expect(attributePowPayment(pay(6), quotes)).toBe('B')
    // Order of the rows doesn't matter (the old reconciler read them unordered).
    expect(attributePowPayment(pay(6), [...quotes].reverse())).toBe('B')
  })

  it('a quote opened AFTER the payment never takes it — even inside the clock-skew allowance', () => {
    expect(attributePowPayment(pay(4), [quote('A', 0), quote('B', 5)])).toBe('A')
    expect(attributePowPayment(pay(4), [quote('A', 0), quote('B', 30)])).toBe('A')
  })

  it('bought two names in a row: each payment goes to its own quote', () => {
    const aPaid = quote('A', 0, { status: 'minted', payment_txid: 'a'.repeat(64) })
    expect(attributePowPayment(pay(1), [quote('A', 0), quote('B', 3)])).toBe('A')
    expect(attributePowPayment(pay(4), [aPaid, quote('B', 3)])).toBe('B')
  })

  it('opened A then B, paid B, then went back and paid A — the second payment goes to A', () => {
    const bPaid = quote('B', 5, { status: 'minted', payment_txid: 'b'.repeat(64) })
    expect(attributePowPayment(pay(8), [quote('A', 0), bPaid])).toBe('A')
  })

  it('different prices: the amount settles it', () => {
    const cheapThenPricey = [quote('A', 0, { expected_atoms: 10 }), quote('B', 5, { expected_atoms: 1000 })]
    expect(attributePowPayment(pay(6, 10n), cheapThenPricey)).toBe('A') // B not covered
    const priceyThenCheap = [quote('A', 0, { expected_atoms: 1000 }), quote('B', 5, { expected_atoms: 10 })]
    expect(attributePowPayment(pay(6, 1000n), priceyThenCheap)).toBe('A') // exact beats a 990-POW overpay of B
  })

  it('covers several, matches none exactly: nobody guesses', () => {
    const quotes = [quote('A', 0, { expected_atoms: 10 }), quote('B', 5, { expected_atoms: 100 })]
    expect(attributePowPayment(pay(6, 500n), quotes)).toBeNull()
  })

  it('an expired quote and a newer open one at the same price: the newer one (what the tab shows)', () => {
    expect(attributePowPayment(pay(20), [quote('A', 0, { status: 'expired' }), quote('B', 18)])).toBe('B')
  })
})

describe('powIntentsOpenedAfter', () => {
  it('reaches back one window + the late grace + skew', () => {
    const seen = sec(T0)
    expect(powIntentsOpenedAfter(seen)).toBe(iso((seen - 15 * 60 - POW_LATE_GRACE_SEC - POW_SKEW_SEC) * 1000))
  })
})
