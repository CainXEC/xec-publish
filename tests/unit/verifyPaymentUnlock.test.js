import { describe, it, expect } from 'vitest'
import { toSatsFromXec } from '@/lib/verifyPaymentUnlock'

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
