import { describe, it, expect } from 'vitest'
import { transformArticleBodyLinks, restoreArticleBodyForEditing } from '@/lib/articleBodyLinks'
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

  it('marks an X (non-post) anchor as an external new-tab link', () => {
    // An X POST link embeds instead (see the X embed tests below); any other X
    // URL — a profile, a search — stays an outbound link.
    const out = transformArticleBodyLinks('<p><a href="https://x.com/jack">t</a></p>')
    expect(out).toContain('data-pow-ext')
    expect(out).toContain('href="https://x.com/jack"')
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

  it('linkifies a BARE (scheme-less) on-site URL in a text node, not just "https://" ones', () => {
    // Regression: the walker's "cheap pre-filter" used to require "https://" or
    // "@", so a bare "www.proofofwriting.com/26" (no scheme) never even reached
    // tokenizeContent and stayed permanently plain text.
    const out = transformArticleBodyLinks('<p>see www.proofofwriting.com/26 here</p>')
    expect(out).toContain('data-pow')
    expect(out).toContain('href="/26"')
    expect(sanitizePostBodyHtml(out)).toContain('href="/26"')
  })

  it('marks a link to a legacy root permalink (bare /<slug>) as data-pow', () => {
    // Imported archive posts live at bare "/26" (app/[slug]/page.js), not
    // "/posts/26" — the editor auto-links it while composing, and it must
    // survive publish (and the read-time sanitizer) as a real link.
    const out = transformArticleBodyLinks('<p><a href="https://www.proofofwriting.com/26">x</a></p>')
    expect(out).toContain('data-pow')
    expect(out).toContain('href="/26"')
    expect(sanitizePostBodyHtml(out)).toContain('href="/26"')
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

  it('leaves a YouTube URL inside a table cell as text (no player in a cell)', () => {
    const out = transformArticleBodyLinks(
      '<table><tbody><tr><td><p>https://youtu.be/dQw4w9WgXcQ</p></td></tr></tbody></table>',
    )
    expect(out).not.toContain('ytembed')
    expect(out).toContain('<td><p>https://youtu.be/dQw4w9WgXcQ</p></td>')
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

  it('embeds an own-line X post URL as an empty id placeholder', () => {
    const out = transformArticleBodyLinks('<p>https://x.com/jack/status/20</p>')
    expect(out).toBe('<div class="xembed-slot" data-x-id="20"></div>')
  })

  it('embeds an inline X post URL, keeping the prose and its spacing', () => {
    const out = transformArticleBodyLinks(
      '<p>As <strong>he</strong> said https://x.com/jack/status/20 back then</p>',
    )
    expect(out).toContain('data-x-id="20"')
    expect(out).toContain('<strong>he</strong> said ') // no words glued together
    expect(out).toContain('back then')
    expect(out).not.toContain('x.com/jack')
  })

  it('embeds a TipTap autolinked X anchor; a worded anchor keeps its words', () => {
    const auto = transformArticleBodyLinks(
      '<p><a href="https://x.com/jack/status/20">https://x.com/jack/status/20</a></p>',
    )
    expect(auto).toBe('<div class="xembed-slot" data-x-id="20"></div>')
    const worded = transformArticleBodyLinks('<p>read <a href="https://x.com/jack/status/20">this post</a></p>')
    expect(worded).toContain('read this post')
    expect(worded).toContain('data-x-id="20"')
  })

  it('leaves an X post URL inside a table cell as a link (no card in a cell)', () => {
    const out = transformArticleBodyLinks(
      '<table><tbody><tr><td><p>https://x.com/jack/status/20</p></td></tr></tbody></table>',
    )
    expect(out).not.toContain('xembed-slot')
    expect(out).toContain('data-pow-ext')
  })

  it('round-trips an X embed through the editor restore and re-publish', () => {
    const stored = transformArticleBodyLinks('<p>https://x.com/jack/status/20</p>')
    const editable = restoreArticleBodyForEditing(stored)
    expect(editable).toBe('<p>https://x.com/i/status/20</p>')
    expect(transformArticleBodyLinks(editable)).toBe(stored)
  })

  it('keeps the X placeholder through the read-time sanitizer', () => {
    const rendered = sanitizePostBodyHtml(transformArticleBodyLinks('<p>https://x.com/jack/status/20</p>'))
    expect(rendered).toBe('<div class="xembed-slot" data-x-id="20"></div>')
  })

  it('returns blank/whitespace input unchanged', () => {
    expect(transformArticleBodyLinks('')).toBe('')
    expect(transformArticleBodyLinks('   ')).toBe('   ')
  })
})
