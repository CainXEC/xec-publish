import { describe, it, expect } from 'vitest'
import { tokenizeContent, xUrlHref } from '@/lib/contentLinks'

describe('xUrlHref', () => {
  it('accepts X / Twitter hosts (incl. www/mobile/m), returns the absolute URL', () => {
    expect(xUrlHref('https://x.com/jack/status/20')).toBe('https://x.com/jack/status/20')
    expect(xUrlHref('https://twitter.com/jack/status/20')).toBe('https://twitter.com/jack/status/20')
    expect(xUrlHref('https://mobile.twitter.com/jack')).toBe('https://mobile.twitter.com/jack')
    expect(xUrlHref('https://www.x.com/jack')).toBe('https://www.x.com/jack')
  })

  it('rejects other hosts, non-http schemes, and junk', () => {
    expect(xUrlHref('https://example.com/x.com')).toBeNull()
    expect(xUrlHref('https://notx.com/a')).toBeNull()
    expect(xUrlHref('javascript:alert(1)')).toBeNull()
    expect(xUrlHref('not a url')).toBeNull()
    // A lookalike subdomain of another site must NOT match.
    expect(xUrlHref('https://x.com.evil.com/a')).toBeNull()
  })
})

describe('tokenizeContent — X links go live, other externals stay inert', () => {
  it('emits an xlink token for an X URL', () => {
    const toks = tokenizeContent('look at this https://x.com/jack/status/20 wild')
    const x = toks.find((t) => t.type === 'xlink')
    expect(x).toBeTruthy()
    expect(x.href).toBe('https://x.com/jack/status/20')
    expect(x.value).toBe('https://x.com/jack/status/20')
  })

  it('leaves a NON-X external URL as inert text (no live link)', () => {
    const toks = tokenizeContent('see https://youtube.com/watch?v=abc and https://example.com/x')
    expect(toks.some((t) => t.type === 'xlink' || t.type === 'link')).toBe(false)
    expect(toks.every((t) => t.type === 'text')).toBe(true)
  })

  it('trims trailing punctuation out of the X link', () => {
    const toks = tokenizeContent('read https://x.com/jack/status/20.')
    const x = toks.find((t) => t.type === 'xlink')
    expect(x.href).toBe('https://x.com/jack/status/20')
    // the period survives as its own text token
    expect(toks.some((t) => t.type === 'text' && t.value === '.')).toBe(true)
  })

  it('still linkifies on-site URLs and @mentions alongside an X link', () => {
    const toks = tokenizeContent(
      '@alice shared https://x.com/jack and https://proofofwriting.com/posts/hello',
    )
    expect(toks.some((t) => t.type === 'mention' && t.handle === 'alice')).toBe(true)
    expect(toks.some((t) => t.type === 'xlink')).toBe(true)
    // the absolute on-site URL becomes an internal link (href = relative path)
    expect(toks.some((t) => t.type === 'link' && t.href === '/posts/hello')).toBe(true)
  })
})
