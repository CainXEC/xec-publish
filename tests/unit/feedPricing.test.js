import { describe, it, expect } from 'vitest'
import {
  FEED_MIN_XEC,
  FEED_MAX_CHARS,
  FEED_YOUTUBE_SURCHARGE_XEC,
  FEED_X_EMBED_SURCHARGE_XEC,
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
    expect(priceFeedPost('hi')).toEqual({ ok: true, chars: 2, pollChars: 0, costXec: FEED_MIN_XEC, youtube: false, xEmbed: false })
  })

  it('charges 1 XEC per character above the floor', () => {
    const content = 'x'.repeat(150)
    expect(priceFeedPost(content)).toEqual({ ok: true, chars: 150, pollChars: 0, costXec: 150, youtube: false, xEmbed: false })
  })

  it('accepts a post exactly at the cap', () => {
    const atCap = 'x'.repeat(FEED_MAX_CHARS)
    expect(priceFeedPost(atCap)).toEqual({
      ok: true,
      chars: FEED_MAX_CHARS,
      pollChars: 0,
      costXec: FEED_MAX_CHARS,
      youtube: false,
      xEmbed: false,
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

describe('priceFeedPost — poll choices', () => {
  it('bills the poll choices on top of the question (accepts strings or {text})', () => {
    const q = 'x'.repeat(120) // above the 100 floor so additions are visible
    const opts = ['Yes', 'Nope', 'Maybe'] // 3 + 4 + 5 = 12 chars
    expect(priceFeedPost(q, { action: 'post', pollOptions: opts }).costXec).toBe(120 + 12)
    // Same total whether options are plain strings or the stored {text} shape.
    const objOpts = opts.map((text) => ({ text }))
    expect(priceFeedPost(q, { action: 'post', pollOptions: objOpts }).costXec).toBe(120 + 12)
  })

  it('reports pollChars and leaves the body `chars` (counter) unchanged', () => {
    const r = priceFeedPost('x'.repeat(120), { action: 'post', pollOptions: ['ab', 'cde'] })
    expect(r.chars).toBe(120) // body only — the composer counter
    expect(r.pollChars).toBe(5) // 2 + 3
    expect(r.costXec).toBe(125)
  })

  it('counts poll characters toward the 100 XEC floor', () => {
    // Short question + short options still stays at the floor.
    expect(priceFeedPost('Best?', { action: 'post', pollOptions: ['A', 'B'] }).costXec).toBe(FEED_MIN_XEC)
  })

  it('is a no-op when no poll options are passed (pollChars 0)', () => {
    expect(priceFeedPost('x'.repeat(150), { action: 'post' }).pollChars).toBe(0)
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

  it('surcharges a REPLY that embeds YouTube (string + numeric action)', () => {
    expect(priceFeedPost(base, { action: 'reply' }).youtube).toBe(true)
    expect(priceFeedPost(base, { action: 2 }).youtube).toBe(true)
    expect(priceFeedPost(base, { action: 'reply' }).costXec).toBe(
      FEED_MIN_XEC + FEED_YOUTUBE_SURCHARGE_XEC,
    )
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

describe('priceFeedPost — X post embed surcharge', () => {
  const X = 'https://x.com/jack/status/20'
  const base = `So true ${X}`

  it('adds the flat surcharge to a post / quote / reply that embeds an X post', () => {
    for (const action of ['post', 'quote', 'reply', 1, 2, 3]) {
      const r = priceFeedPost(base, { action })
      expect(r.xEmbed).toBe(true)
      expect(r.costXec).toBe(FEED_MIN_XEC + FEED_X_EMBED_SURCHARGE_XEC)
    }
  })

  it('does NOT surcharge a comment, a non-post X link, or a lookalike host', () => {
    expect(priceFeedPost(base).xEmbed).toBe(false) // article comment: no action
    expect(priceFeedPost('follow https://x.com/jack', { action: 'post' }).xEmbed).toBe(false)
    expect(priceFeedPost('https://fox.com/a/status/20', { action: 'post' }).xEmbed).toBe(false)
  })

  it('charges both surcharges when a post embeds YouTube AND an X post', () => {
    const r = priceFeedPost(`${base} https://youtu.be/dQw4w9WgXcQ`, { action: 'post' })
    expect(r.youtube).toBe(true)
    expect(r.xEmbed).toBe(true)
    expect(r.costXec).toBe(FEED_MIN_XEC + FEED_YOUTUBE_SURCHARGE_XEC + FEED_X_EMBED_SURCHARGE_XEC)
  })
})
