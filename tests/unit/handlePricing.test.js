import { describe, it, expect } from 'vitest'
import { priceForHandle } from '@/lib/handlePricing'

// Flat three-tier pricing keyed on handle LENGTH. These tests pin the tier
// boundaries and the sats derivation so a boundary-off-by-one can't overcharge
// or undercharge a mint.
describe('priceForHandle', () => {
  it('prices 1–5 chars as the short tier (1,000,000 XEC)', () => {
    for (const h of ['a', 'ab', 'abcde']) {
      const p = priceForHandle(h)
      expect(p.tier).toBe('short')
      expect(p.priceXec).toBe(1_000_000)
    }
  })

  it('prices 6–10 chars as the mid tier (100,000 XEC)', () => {
    for (const h of ['abcdef', 'abcdefghij']) {
      const p = priceForHandle(h)
      expect(p.tier).toBe('mid')
      expect(p.priceXec).toBe(100_000)
    }
  })

  it('prices 11+ chars as the base tier (10,000 XEC)', () => {
    for (const h of ['abcdefghijk', 'a'.repeat(30)]) {
      const p = priceForHandle(h)
      expect(p.tier).toBe('base')
      expect(p.priceXec).toBe(10_000)
    }
  })

  it('has exact tier boundaries at 5/6 and 10/11', () => {
    expect(priceForHandle('abcde').tier).toBe('short') // 5
    expect(priceForHandle('abcdef').tier).toBe('mid') // 6
    expect(priceForHandle('abcdefghij').tier).toBe('mid') // 10
    expect(priceForHandle('abcdefghijk').tier).toBe('base') // 11
  })

  it('derives priceSats as priceXec * 100 and is never auction-only', () => {
    for (const h of ['ab', 'abcdef', 'abcdefghijk']) {
      const p = priceForHandle(h)
      expect(p.priceSats).toBe(p.priceXec * 100)
      expect(p.auctionOnly).toBe(false)
    }
  })
})
