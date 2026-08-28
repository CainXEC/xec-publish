import { describe, it, expect } from 'vitest'
import { transformArticleBodyLinks } from '@/lib/articleBodyLinks'
import { sanitizePostBodyHtml } from '@/lib/sanitizePostBodyHtml'

describe('transformArticleBodyLinks — feed link parity in article bodies', () => {
  it('marks an on-site anchor as data-pow with a normalized path', () => {
    const out = transformArticleBodyLinks('<p><a href="https://proofofwriting.com/posts/hello">x</a></p>')
    expect(out).toContain('data-pow')
    expect(out).toContain('href="/posts/hello"')
  })

  it('marks an e.cash anchor as an external new-tab link', () => {
    const out = transformArticleBodyLinks('<p><a href="https://explorer.e.cash/tx/abc">tx</a></p>')
    expect(out).toContain('data-pow-ext')
    expect(out).toContain('href="https://explorer.e.cash/tx/abc"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('noopener')
  })

  it('marks an X anchor as an external new-tab link', () => {
    const out = transformArticleBodyLinks('<p><a href="https://x.com/jack/status/20">t</a></p>')
    expect(out).toContain('data-pow-ext')
    expect(out).toContain('href="https://x.com/jack/status/20"')
  })

  it('unwraps a disallowed external anchor to inert text', () => {
    const out = transformArticleBodyLinks('<p><a href="https://evil.com/x">click</a></p>')
    expect(out).not.toContain('href')
    expect(out).toContain('click')
  })

  it('linkifies a bare-text e.cash URL, on-site URL, and @mention', () => {
    const out = transformArticleBodyLinks(
      '<p>see https://explorer.e.cash/tx/abc and https://proofofwriting.com/feed/' +
        'a'.repeat(64) +
        ' by @alice</p>',
    )
    // external e.cash → new-tab marker
    expect(out).toContain('data-pow-ext')
    expect(out).toContain('href="https://explorer.e.cash/tx/abc"')
    // on-site feed link → internal marker
    expect(out).toContain(`href="/feed/${'a'.repeat(64)}"`)
    // @mention → internal profile link
    expect(out).toContain('href="/@alice"')
  })

  it('does not double-linkify text already inside an anchor', () => {
    const out = transformArticleBodyLinks('<a href="https://x.com/a">@alice</a>')
    // the @alice inside the (now external) anchor stays its text, not a nested link
    expect(out).not.toContain('href="/@alice"')
  })

  it('survives the read-time sanitizer end-to-end (external link stays live)', () => {
    const stored = transformArticleBodyLinks('<p><a href="https://explorer.e.cash/tx/abc">tx</a></p>')
    const rendered = sanitizePostBodyHtml(stored)
    expect(rendered).toContain('href="https://explorer.e.cash/tx/abc"')
    expect(rendered).toContain('target="_blank"')
    expect(rendered).toMatch(/rel="[^"]*noopener[^"]*"/)
  })

  it('embeds a YouTube URL that is on its own line', () => {
    const out = transformArticleBodyLinks('<p>https://youtu.be/dQw4w9WgXcQ</p>')
    expect(out).toContain('class="ytembed"')
    expect(out).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"')
    expect(out).not.toContain('<p>') // the paragraph was replaced by the embed
  })

  it('embeds an inline YouTube URL, keeping the surrounding prose', () => {
    const out = transformArticleBodyLinks('<p>Watch https://youtu.be/dQw4w9WgXcQ — great</p>')
    expect(out).toContain('ytembed')
    expect(out).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"')
    expect(out).toContain('Watch') // the prose stays…
    expect(out).toContain('great') // …on both sides of the removed URL
  })

  it('embeds a TipTap autolinked YouTube anchor', () => {
    const out = transformArticleBodyLinks(
      '<p><a href="https://youtu.be/dQw4w9WgXcQ">https://youtu.be/dQw4w9WgXcQ</a></p>',
    )
    expect(out).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"')
  })

  it('embeds a watch?v= URL through the sanitizer end-to-end', () => {
    const stored = transformArticleBodyLinks('<p>https://www.youtube.com/watch?v=dQw4w9WgXcQ</p>')
    const rendered = sanitizePostBodyHtml(stored)
    expect(rendered).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"')
    expect(rendered).toContain('class="ytembed"')
  })

  it('returns blank/whitespace input unchanged', () => {
    expect(transformArticleBodyLinks('')).toBe('')
    expect(transformArticleBodyLinks('   ')).toBe('   ')
  })
})
