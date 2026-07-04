import { describe, it, expect } from 'vitest'
import {
  FEED_MIN_XEC,
  FEED_MAX_CHARS,
  countChars,
  priceFeedPost,
} from '@/lib/feedPricing'

describe('countChars', () => {
  it('counts by Unicode code point, not UTF-16 units', () => {
    expect(countChars('abc')).toBe(3)
    expect(countChars('😀')).toBe(1) // one code point, two UTF-16 units
    expect(countChars('a😀b')).toBe(3)
  })

  it('returns 0 for non-strings', () => {
    expect(countChars(null)).toBe(0)
    expect(countChars(undefined)).toBe(0)
    expect(countChars(123)).toBe(0)
  })
})

describe('priceFeedPost', () => {
  it('rejects empty or whitespace-only content', () => {
    expect(priceFeedPost('')).toEqual({ ok: false, error: 'Post cannot be empty', chars: 0 })
    const spaces = priceFeedPost('   ')
    expect(spaces.ok).toBe(false)
    expect(spaces.chars).toBe(3)
  })

  it('charges the 100 XEC floor for short posts', () => {
    expect(priceFeedPost('hi')).toEqual({ ok: true, chars: 2, costXec: FEED_MIN_XEC })
  })

  it('charges 1 XEC per character above the floor', () => {
    const content = 'x'.repeat(150)
    expect(priceFeedPost(content)).toEqual({ ok: true, chars: 150, costXec: 150 })
  })

  it('accepts a post exactly at the cap', () => {
    const atCap = 'x'.repeat(FEED_MAX_CHARS)
    expect(priceFeedPost(atCap)).toEqual({ ok: true, chars: FEED_MAX_CHARS, costXec: FEED_MAX_CHARS })
  })

  it('rejects a post one character over the cap', () => {
    const over = 'x'.repeat(FEED_MAX_CHARS + 1)
    const res = priceFeedPost(over)
    expect(res.ok).toBe(false)
    expect(res.chars).toBe(FEED_MAX_CHARS + 1)
    expect(res.error).toMatch(/exceeds/i)
  })
})
