import { describe, it, expect } from 'vitest'
import { computePaymentSplit, buildPaywallBip21 } from '@/lib/paymentSplit'

describe('computePaymentSplit', () => {
  it('splits 100 XEC correctly (94/6)', () => {
    const split = computePaymentSplit(100)
    expect(split.authorAmount).toBe(94)
    expect(split.platformAmount).toBe(6)
    expect(split.authorAmount + split.platformAmount).toBe(100)
  })

  it('splits 1000 XEC correctly', () => {
    const split = computePaymentSplit(1000)
    expect(split.authorAmount).toBe(940)
    expect(split.platformAmount).toBe(60)
  })

  it('author always gets floor of 94%', () => {
    const split = computePaymentSplit(101)
    expect(split.authorAmount).toBe(Math.floor(101 * 0.94))
    expect(split.platformAmount).toBe(101 - split.authorAmount)
  })

  it('returns null for invalid price', () => {
    expect(computePaymentSplit(-1)).toBeNull()
    expect(computePaymentSplit('abc')).toBeNull()
  })

  it('total always equals original price', () => {
    ;[100, 150, 200, 999, 10000].forEach((price) => {
      const split = computePaymentSplit(price)
      expect(split.authorAmount + split.platformAmount).toBe(price)
    })
  })
})

describe('buildPaywallBip21', () => {
  it('builds a valid BIP21 URL', () => {
    const url = buildPaywallBip21(
      'ecash:qauthor123',
      'ecash:qplatform456',
      94,
      6,
    )
    expect(url).toContain('ecash:')
    expect(url).toContain('amount=94')
    expect(url).toContain('amount=6')
    expect(url).toContain('addr=')
  })

  it('returns empty string for missing addresses', () => {
    expect(buildPaywallBip21('', 'ecash:qplatform456', 94, 6)).toBe('')
    expect(buildPaywallBip21('ecash:qauthor123', '', 94, 6)).toBe('')
  })
})
