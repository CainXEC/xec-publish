import { describe, it, expect } from 'vitest'
import {
  FEED_MIN_XEC,
  FEED_MAX_CHARS,
  FEED_YOUTUBE_SURCHARGE_XEC,
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
    expect(priceFeedPost('hi')).toEqual({ ok: true, chars: 2, costXec: FEED_MIN_XEC, youtube: false })
  })

  it('charges 1 XEC per character above the floor', () => {
    const content = 'x'.repeat(150)
    expect(priceFeedPost(content)).toEqual({ ok: true, chars: 150, costXec: 150, youtube: false })
  })

  it('accepts a post exactly at the cap', () => {
    const atCap = 'x'.repeat(FEED_MAX_CHARS)
    expect(priceFeedPost(atCap)).toEqual({
      ok: true,
      chars: FEED_MAX_CHARS,
      costXec: FEED_MAX_CHARS,
      youtube: false,
    })
  })

  it('rejects a post one character over the cap', () => {
    const over = 'x'.repeat(FEED_MAX_CHARS + 1)
    const res = priceFeedPost(over)
    expect(res.ok).toBe(false)
    expect(res.chars).toBe(FEED_MAX_CHARS + 1)
    expect(res.error).toMatch(/exceeds/i)
  })
})

describe('priceFeedPost — YouTube surcharge', () => {
  const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  const base = `Watch this ${YT}` // short, so the char floor (100) applies

  it('adds the flat surcharge to a POST that embeds YouTube', () => {
    const post = priceFeedPost(base, { action: 'post' })
    expect(post.youtube).toBe(true)
    expect(post.costXec).toBe(FEED_MIN_XEC + FEED_YOUTUBE_SURCHARGE_XEC)
  })

  it('adds the surcharge to a QUOTE and to the server FEED_ACTION numbers (1/3)', () => {
    expect(priceFeedPost(base, { action: 'quote' }).costXec).toBe(FEED_MIN_XEC + FEED_YOUTUBE_SURCHARGE_XEC)
    expect(priceFeedPost(base, { action: 1 }).costXec).toBe(FEED_MIN_XEC + FEED_YOUTUBE_SURCHARGE_XEC) // POST
    expect(priceFeedPost(base, { action: 3 }).costXec).toBe(FEED_MIN_XEC + FEED_YOUTUBE_SURCHARGE_XEC) // QUOTE
  })

  it('does NOT surcharge a REPLY (no embed there)', () => {
    expect(priceFeedPost(base, { action: 'reply' }).youtube).toBe(false)
    expect(priceFeedPost(base, { action: 2 }).youtube).toBe(false)
    expect(priceFeedPost(base, { action: 'reply' }).costXec).toBe(FEED_MIN_XEC)
  })

  it('does NOT surcharge a comment (no action passed) or a post without a YouTube link', () => {
    expect(priceFeedPost(base).youtube).toBe(false) // comment path passes no action
    expect(priceFeedPost('just text, no video', { action: 'post' }).youtube).toBe(false)
  })

  it('stacks the surcharge on top of the per-character price', () => {
    const long = 'x'.repeat(300) + ` ${YT}`
    const r = priceFeedPost(long, { action: 'post' })
    expect(r.youtube).toBe(true)
    expect(r.costXec).toBe(r.chars + FEED_YOUTUBE_SURCHARGE_XEC)
  })
})
