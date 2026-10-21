import { describe, it, expect } from 'vitest'
import { pastPayWindow, pendingPollPlan, taggedPaymentPlan } from '@/lib/mintLatePayment'

// -----------------------------------------------------------------------------
// Late mint payments: a correctly TAGGED XEC payment that lands after its
// intent's 15-minute pay window.
//
// The status poll used to flip a 'pending' row to 'expired' on its first tick
// past expires_at, before it looked for the payment, and the reconciler only
// claimed rows still 'pending'. A buyer who hit send at minute 15 (or whose
// payment was still finalizing when the window closed) ended up with an
// 'expired' row and their XEC parked at the mint wallet: no NFT, no refund.
// These pin the fix: past the window, a tagged payment still counts, and the
// reconciler reopens an expired row that has one.
// -----------------------------------------------------------------------------

const PRICE = 1_000_000 // 10,000 XEC
const CREATED = '2026-10-21T00:51:03Z'
const EXPIRES = '2026-10-21T01:06:03Z'
const at = (iso) => new Date(iso).getTime()

const xec = (over = {}) => ({ status: 'pending', pay_token: 'xec', expected_sats: PRICE, created_at: CREATED, expires_at: EXPIRES, ...over })
const pow = (over = {}) => xec({ pay_token: 'pow', ...over })

describe('pastPayWindow', () => {
  it('is open up to and including expires_at, closed after', () => {
    expect(pastPayWindow(EXPIRES, at('2026-10-21T01:05:59Z'))).toBe(false)
    expect(pastPayWindow(EXPIRES, at(EXPIRES))).toBe(false)
    expect(pastPayWindow(EXPIRES, at(EXPIRES) + 1)).toBe(true)
  })
})

describe('pendingPollPlan (status poll on a pending row)', () => {
  const inWindow = at('2026-10-21T01:00:00Z')
  const minute16 = at('2026-10-21T01:07:03Z')

  it('inside the window: normal matching, XEC or POW', () => {
    expect(pendingPollPlan(xec(), inWindow)).toBe('match')
    expect(pendingPollPlan(pow(), inWindow)).toBe('match')
  })

  it('window closed, XEC: look for a tagged payment before expiring (the regression)', () => {
    expect(pendingPollPlan(xec(), minute16)).toBe('tagged')
  })

  it('treats a legacy row with no pay_token as XEC', () => {
    expect(pendingPollPlan(xec({ pay_token: null }), minute16)).toBe('tagged')
    expect(pendingPollPlan(xec({ pay_token: undefined }), minute16)).toBe('tagged')
  })

  it('window closed, POW: no tag to go on, so it expires as before', () => {
    expect(pendingPollPlan(pow(), minute16)).toBe('expire')
  })
})

describe('taggedPaymentPlan (reconciler, final tagged payment → its row)', () => {
  it('claims a still-pending row (unchanged)', () => {
    expect(taggedPaymentPlan(xec(), PRICE)).toBe('claim')
  })

  it('reopens an EXPIRED row whose tagged payment is on chain (the regression)', () => {
    expect(taggedPaymentPlan(xec({ status: 'expired' }), PRICE)).toBe('reopen')
    expect(taggedPaymentPlan(xec({ status: 'expired', pay_token: null }), PRICE)).toBe('reopen')
  })

  it('accepts an overpayment, skips an underpayment either way', () => {
    expect(taggedPaymentPlan(xec({ status: 'expired' }), PRICE + 1)).toBe('reopen')
    expect(taggedPaymentPlan(xec({ status: 'expired' }), PRICE - 1)).toBe('skip')
    expect(taggedPaymentPlan(xec(), PRICE - 1)).toBe('skip')
  })

  it('reads expected_sats whether it comes back as a number or a string', () => {
    expect(taggedPaymentPlan(xec({ status: 'expired', expected_sats: String(PRICE) }), PRICE)).toBe('reopen')
    expect(taggedPaymentPlan(xec({ status: 'expired', expected_sats: String(PRICE) }), PRICE - 1)).toBe('skip')
  })

  it('never reopens an expired POW intent', () => {
    expect(taggedPaymentPlan(pow({ status: 'expired' }), PRICE)).toBe('skip')
  })

  it('leaves paid rows to pass A and terminal rows alone', () => {
    for (const status of ['paid', 'stuck', 'minted', 'refunded', 'failed', 'contended']) {
      expect(taggedPaymentPlan(xec({ status }), PRICE)).toBe('skip')
    }
  })

  it('skips a tag that matches no row (foreign / deleted intent)', () => {
    expect(taggedPaymentPlan(null, PRICE)).toBe('skip')
    expect(taggedPaymentPlan(undefined, PRICE)).toBe('skip')
  })
})
