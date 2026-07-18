import { describe, it, expect } from 'vitest'
import {
  shortenIdentity,
  buildFeedOgImageUrl,
  feedOpenGraphMetadata,
} from '@/lib/feedOgMetadata'

// A handle-less account's byline falls back to its raw eCash address; keep a
// realistic long one around for the elision assertions.
const ADDR = 'ecash:qq703jnur3zvxcq3w2z5aaaaaaaaaaaaaaaaaaaa9x'

describe('shortenIdentity', () => {
  it('passes an @handle through untouched', () => {
    expect(shortenIdentity('@cain')).toBe('@cain')
  })

  it('elides a long eCash address to head…tail', () => {
    const out = shortenIdentity(ADDR)
    expect(out).toContain('…')
    expect(out.startsWith('ecash:qq703j')).toBe(true)
    expect(out.endsWith(ADDR.slice(-4))).toBe(true)
    expect(out.length).toBeLessThan(ADDR.length)
  })

  it('leaves short strings and empties alone', () => {
    expect(shortenIdentity('short')).toBe('short')
    expect(shortenIdentity('')).toBe('')
    expect(shortenIdentity(null)).toBe('')
    expect(shortenIdentity(undefined)).toBe('')
  })
})

describe('buildFeedOgImageUrl', () => {
  it('targets /api/og/feed with text/author/action/id params', () => {
    const u = new URL(
      buildFeedOgImageUrl({ text: 'hello world', author: '@cain', action: 1, id: 'abc123' }),
    )
    expect(u.pathname).toBe('/api/og/feed')
    expect(u.searchParams.get('text')).toBe('hello world')
    expect(u.searchParams.get('author')).toBe('@cain')
    expect(u.searchParams.get('action')).toBe('1')
    expect(u.searchParams.get('id')).toBe('abc123')
  })

  it('collapses runs of whitespace', () => {
    const u = new URL(buildFeedOgImageUrl({ text: 'hello    world  \n\n  foo' }))
    expect(u.searchParams.get('text')).toBe('hello world foo')
  })

  it('clips text to 280 chars', () => {
    const u = new URL(buildFeedOgImageUrl({ text: 'a'.repeat(500) }))
    expect(u.searchParams.get('text').length).toBe(280)
  })

  it('omits author/action/id when absent', () => {
    const u = new URL(buildFeedOgImageUrl({ text: 'hi' }))
    expect(u.searchParams.has('author')).toBe(false)
    expect(u.searchParams.has('action')).toBe(false)
    expect(u.searchParams.has('id')).toBe(false)
  })

  it('marks AI-operated posters with ai=1 and omits the param otherwise', () => {
    const ai = new URL(buildFeedOgImageUrl({ text: 'hi', ai: true }))
    expect(ai.searchParams.get('ai')).toBe('1')
    const human = new URL(buildFeedOgImageUrl({ text: 'hi' }))
    expect(human.searchParams.has('ai')).toBe(false)
  })
})

describe('feedOpenGraphMetadata', () => {
  const base = { txid: 'a'.repeat(64), action: 1 }

  it('uses the live @handle for title, byline, and image author', () => {
    const md = feedOpenGraphMetadata({
      post: { ...base, handle: 'cain', displayIdentity: '@cain', content: 'gm world' },
      pageUrl: 'https://www.proofofwriting.com/feed/abc',
    })
    expect(md.title).toBe('@cain on Proof Of Writing')
    expect(md.openGraph.title).toBe('@cain on Proof Of Writing')
    expect(md.openGraph.url).toBe('https://www.proofofwriting.com/feed/abc')
    expect(md.twitter.card).toBe('summary_large_image')

    const img = new URL(md.openGraph.images[0].url)
    expect(img.pathname).toBe('/api/og/feed')
    expect(img.searchParams.get('author')).toBe('@cain')
    expect(img.searchParams.get('text')).toBe('gm world')
    expect(img.searchParams.get('action')).toBe('1')
  })

  it('falls back to a shortened address when no handle is held', () => {
    const md = feedOpenGraphMetadata({
      post: { ...base, handle: null, displayIdentity: ADDR, content: 'hello' },
      pageUrl: 'p',
    })
    expect(md.title.endsWith(' on Proof Of Writing')).toBe(true)
    expect(md.title.startsWith('ecash:qq703j')).toBe(true)
    expect(md.title).toContain('…')
  })

  it('truncates the description to 200 chars', () => {
    const md = feedOpenGraphMetadata({
      post: { ...base, handle: 'cain', displayIdentity: '@cain', content: 'x'.repeat(500) },
      pageUrl: 'p',
    })
    expect(md.description.length).toBe(200)
  })

  it('uses a generic description for empty/deleted content', () => {
    const md = feedOpenGraphMetadata({
      post: { ...base, handle: 'cain', displayIdentity: '@cain', content: null },
      pageUrl: 'p',
    })
    expect(md.description).toBe('A post on Proof Of Writing.')
  })

  it('threads the AI label onto the image URL for AI-operated posters', () => {
    const md = feedOpenGraphMetadata({
      post: { ...base, handle: 'satoshi', displayIdentity: '@satoshi', content: 'gm', isAi: true },
      pageUrl: 'p',
    })
    const img = new URL(md.openGraph.images[0].url)
    expect(img.searchParams.get('ai')).toBe('1')

    const human = feedOpenGraphMetadata({
      post: { ...base, handle: 'cain', displayIdentity: '@cain', content: 'gm' },
      pageUrl: 'p',
    })
    expect(new URL(human.openGraph.images[0].url).searchParams.has('ai')).toBe(false)
  })
})
