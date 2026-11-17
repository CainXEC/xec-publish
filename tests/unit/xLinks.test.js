import { describe, it, expect } from 'vitest'
import { extractXPostId, stripXPostLink, xPostIdForPost, xPostUrl } from '@/lib/xLinks'

const ID = '1585341984679469056'

describe('extractXPostId', () => {
  it('pulls the id from the common share forms', () => {
    expect(extractXPostId(`look https://x.com/elonmusk/status/${ID} wow`)).toBe(ID)
    expect(extractXPostId(`https://twitter.com/elonmusk/status/${ID}?s=20&t=abc`)).toBe(ID)
    expect(extractXPostId(`https://www.x.com/a_b/status/${ID}/photo/1`)).toBe(ID)
    expect(extractXPostId(`https://mobile.twitter.com/someone/status/${ID}`)).toBe(ID)
    expect(extractXPostId(`https://x.com/i/status/${ID}`)).toBe(ID)
    expect(extractXPostId(`https://x.com/i/web/status/${ID}`)).toBe(ID)
    expect(extractXPostId(`https://twitter.com/jack/statuses/20`)).toBe('20')
    expect(extractXPostId(`x.com/jack/status/20`)).toBe('20') // bare, no scheme
    expect(extractXPostId(`(https://x.com/jack/status/20)`)).toBe('20')
  })

  it('ignores lookalike hosts and links buried in another URL', () => {
    expect(extractXPostId(`https://fox.com/news/status/${ID}`)).toBeNull()
    expect(extractXPostId(`https://x.com.evil.com/a/status/${ID}`)).toBeNull()
    expect(extractXPostId(`https://evil.com/x.com/a/status/${ID}`)).toBeNull()
    expect(extractXPostId(`https://evil.com/r?u=https://x.com/a/status/${ID}`)).toBeNull()
    expect(extractXPostId(`notx.com/a/status/${ID}`)).toBeNull()
  })

  it('ignores X links that are not a post', () => {
    expect(extractXPostId('https://x.com/elonmusk')).toBeNull()
    expect(extractXPostId('https://x.com/elonmusk/status/')).toBeNull()
    expect(extractXPostId('https://x.com/home')).toBeNull()
    expect(extractXPostId('')).toBeNull()
    expect(extractXPostId(null)).toBeNull()
  })
})

describe('stripXPostLink', () => {
  it('removes the URL token (with its query/path tail) and tidies', () => {
    expect(stripXPostLink(`https://x.com/jack/status/20`)).toBe('')
    expect(stripXPostLink(`so true https://x.com/jack/status/20?s=46&t=xyz`)).toBe('so true')
    expect(stripXPostLink(`so true\n\nhttps://x.com/jack/status/20/photo/1`)).toBe('so true')
  })

  it('keeps trailing sentence punctuation in the text', () => {
    expect(stripXPostLink(`see (https://x.com/jack/status/20).`)).toBe('see ().')
  })

  it('only removes the FIRST post link (later ones stay live links)', () => {
    const out = stripXPostLink('a https://x.com/a/status/1 b https://x.com/b/status/2')
    expect(out).toContain('https://x.com/b/status/2')
    expect(out).not.toContain('status/1')
  })

  it('tidy:false leaves surrounding whitespace alone (article text nodes)', () => {
    expect(stripXPostLink(' https://x.com/jack/status/20 now', { tidy: false })).toBe('  now')
  })

  it('leaves text without a post link unchanged', () => {
    expect(stripXPostLink('hello world')).toBe('hello world')
  })
})

describe('xPostIdForPost', () => {
  it('embeds for any action, never for a deleted post', () => {
    expect(xPostIdForPost({ action: 1, content: `x https://x.com/a/status/${ID}` })).toBe(ID)
    expect(xPostIdForPost({ action: 2, content: `x https://x.com/a/status/${ID}` })).toBe(ID)
    expect(xPostIdForPost({ action: 1, content: `https://x.com/a/status/${ID}`, deleted: true })).toBeNull()
    expect(xPostIdForPost({ action: 1, content: 'no link' })).toBeNull()
    expect(xPostIdForPost(null)).toBeNull()
  })
})

describe('xPostUrl', () => {
  it('builds the canonical i/status URL', () => {
    expect(xPostUrl('20')).toBe('https://x.com/i/status/20')
  })
})
