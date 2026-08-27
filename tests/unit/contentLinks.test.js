import { describe, it, expect } from 'vitest'
import { tokenizeContent, tokenizeUrls, externalUrlHref } from '@/lib/contentLinks'

describe('externalUrlHref', () => {
  it('accepts X / Twitter hosts (incl. www/mobile/m), returns the absolute URL', () => {
    expect(externalUrlHref('https://x.com/jack/status/20')).toBe('https://x.com/jack/status/20')
    expect(externalUrlHref('https://twitter.com/jack/status/20')).toBe(
      'https://twitter.com/jack/status/20',
    )
    expect(externalUrlHref('https://mobile.twitter.com/jack')).toBe('https://mobile.twitter.com/jack')
    expect(externalUrlHref('https://www.x.com/jack')).toBe('https://www.x.com/jack')
  })

  it('accepts e.cash and ANY e.cash subdomain', () => {
    expect(externalUrlHref('https://e.cash/')).toBe('https://e.cash/')
    expect(externalUrlHref('https://explorer.e.cash/tx/abc')).toBe('https://explorer.e.cash/tx/abc')
    expect(externalUrlHref('https://avalanche.e.cash/')).toBe('https://avalanche.e.cash/')
    expect(externalUrlHref('http://explorer.e.cash/address/xyz')).toBe(
      'http://explorer.e.cash/address/xyz',
    )
  })

  it('accepts cashtab.com and its subdomains', () => {
    expect(externalUrlHref('https://cashtab.com/#/send')).toBe('https://cashtab.com/#/send')
    expect(externalUrlHref('https://www.cashtab.com/')).toBe('https://www.cashtab.com/')
  })

  it('rejects other hosts, e.cash lookalikes, non-http schemes, and junk', () => {
    expect(externalUrlHref('https://example.com/x.com')).toBeNull()
    expect(externalUrlHref('https://notx.com/a')).toBeNull()
    expect(externalUrlHref('javascript:alert(1)')).toBeNull()
    expect(externalUrlHref('not a url')).toBeNull()
    // Lookalikes of BOTH allowed hosts must NOT match.
    expect(externalUrlHref('https://x.com.evil.com/a')).toBeNull()
    expect(externalUrlHref('https://evile.cash/a')).toBeNull()
    expect(externalUrlHref('https://e.cash.evil.com/a')).toBeNull()
  })
})

describe('tokenizeContent — X + e.cash links go live, other externals stay inert', () => {
  it('emits an extlink token for an X URL', () => {
    const toks = tokenizeContent('look at this https://x.com/jack/status/20 wild')
    const x = toks.find((t) => t.type === 'extlink')
    expect(x).toBeTruthy()
    expect(x.href).toBe('https://x.com/jack/status/20')
    expect(x.value).toBe('https://x.com/jack/status/20')
  })

  it('emits an extlink token for an e.cash explorer URL', () => {
    const toks = tokenizeContent('proof: https://explorer.e.cash/tx/6f88208c here')
    const e = toks.find((t) => t.type === 'extlink')
    expect(e).toBeTruthy()
    expect(e.href).toBe('https://explorer.e.cash/tx/6f88208c')
  })

  it('leaves a NON-allowed external URL as inert text (no live link)', () => {
    const toks = tokenizeContent('see https://youtube.com/watch?v=abc and https://example.com/x')
    expect(toks.some((t) => t.type === 'extlink' || t.type === 'link')).toBe(false)
    expect(toks.every((t) => t.type === 'text')).toBe(true)
  })

  it('trims trailing punctuation out of an e.cash link', () => {
    const toks = tokenizeContent('read https://explorer.e.cash/tx/abc.')
    const e = toks.find((t) => t.type === 'extlink')
    expect(e.href).toBe('https://explorer.e.cash/tx/abc')
    // the period survives as its own text token
    expect(toks.some((t) => t.type === 'text' && t.value === '.')).toBe(true)
  })

  it('linkifies a BARE (scheme-less) on-site domain to its path', () => {
    // The reported case: "PROOFOFWRITING.com" with no https:// prefix.
    const toks = tokenizeContent('Try PROOFOFWRITING.com today')
    const link = toks.find((t) => t.type === 'link')
    expect(link).toBeTruthy()
    expect(link.href).toBe('/') // the homepage
    expect(link.value).toBe('PROOFOFWRITING.com') // displayed as written
  })

  it('linkifies a bare on-site path and a bare whitelisted external domain', () => {
    const a = tokenizeContent('read proofofwriting.com/posts/hello')
    expect(a.some((t) => t.type === 'link' && t.href === '/posts/hello')).toBe(true)

    const b = tokenizeContent('proof at explorer.e.cash/tx/abc')
    const ext = b.find((t) => t.type === 'extlink')
    expect(ext.href).toBe('https://explorer.e.cash/tx/abc')
    expect(ext.value).toBe('explorer.e.cash/tx/abc')
  })

  it('does NOT linkify a bare non-known domain, a glued fragment, or a look-alike', () => {
    expect(tokenizeUrls('see example.com here').every((t) => t.type === 'text')).toBe(true)
    // "proofofwriting.community" must not match the domain (negative lookahead).
    expect(tokenizeUrls('join the proofofwriting.community').every((t) => t.type === 'text')).toBe(true)
    // An email's domain is glued to "@" → not linkified by the URL tokenizer.
    expect(tokenizeUrls('me@proofofwriting.com').every((t) => t.type === 'text')).toBe(true)
  })

  it('linkifies on-site URLs, @mentions, and BOTH external kinds together', () => {
    const toks = tokenizeContent(
      '@alice shared https://x.com/jack and https://explorer.e.cash/tx/abc and https://proofofwriting.com/posts/hello',
    )
    expect(toks.some((t) => t.type === 'mention' && t.handle === 'alice')).toBe(true)
    expect(toks.filter((t) => t.type === 'extlink')).toHaveLength(2)
    // the absolute on-site URL becomes an internal link (href = relative path)
    expect(toks.some((t) => t.type === 'link' && t.href === '/posts/hello')).toBe(true)
  })
})
