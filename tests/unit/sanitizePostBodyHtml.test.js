import { describe, it, expect } from 'vitest'
import { sanitizePostBodyHtml } from '@/lib/sanitizePostBodyHtml'

describe('sanitizePostBodyHtml', () => {
  it('keeps allowed formatting tags', () => {
    expect(sanitizePostBodyHtml('<p>hi</p>')).toBe('<p>hi</p>')
    expect(sanitizePostBodyHtml('<strong>bold</strong>')).toBe('<strong>bold</strong>')
    expect(sanitizePostBodyHtml('<ul><li>a</li></ul>')).toBe('<ul><li>a</li></ul>')
  })

  it('strips <script> and its payload', () => {
    const out = sanitizePostBodyHtml('<p>hi</p><script>alert(1)</script>')
    expect(out).toContain('<p>hi</p>')
    expect(out.toLowerCase()).not.toContain('script')
    expect(out).not.toContain('alert(1)')
  })

  it('removes event-handler attributes', () => {
    const out = sanitizePostBodyHtml('<p onclick="steal()">hi</p>')
    expect(out).toBe('<p>hi</p>')
    expect(out).not.toContain('onclick')
  })

  it('drops disallowed tags like <img>', () => {
    const out = sanitizePostBodyHtml('<img src=x onerror="alert(1)">')
    expect(out).not.toContain('<img')
    expect(out).not.toContain('onerror')
  })

  it('keeps a safe text-align style but strips other styles', () => {
    const aligned = sanitizePostBodyHtml('<p style="text-align: center">hi</p>')
    expect(aligned).toContain('text-align')

    const colored = sanitizePostBodyHtml('<p style="color: red">hi</p>')
    expect(colored).not.toContain('color')
    expect(colored).toContain('hi')
  })

  it('returns an empty string for non-string input', () => {
    expect(sanitizePostBodyHtml(null)).toBe('')
    expect(sanitizePostBodyHtml(undefined)).toBe('')
    expect(sanitizePostBodyHtml(123)).toBe('')
  })

  describe('anchor policy', () => {
    it('keeps a marked on-site (data-pow) link to a live path', () => {
      const out = sanitizePostBodyHtml('<a data-pow href="/posts/hello">read</a>')
      expect(out).toContain('href="/posts/hello"')
      expect(out).toContain('>read<')
      expect(out).not.toContain('target')
    })

    it('keeps a marked external (data-pow-ext) link and forces safe new-tab attrs', () => {
      const out = sanitizePostBodyHtml(
        '<a data-pow-ext href="https://explorer.e.cash/tx/abc">tx</a>',
      )
      expect(out).toContain('href="https://explorer.e.cash/tx/abc"')
      expect(out).toContain('target="_blank"')
      expect(out).toMatch(/rel="[^"]*noopener[^"]*noreferrer[^"]*"/)
    })

    it('strips the href from a data-pow-ext anchor pointing at a NON-allowed host', () => {
      const out = sanitizePostBodyHtml('<a data-pow-ext href="https://evil.com/x">x</a>')
      expect(out).not.toContain('href')
      expect(out).not.toContain('target')
      expect(out).toContain('>x<')
    })

    it('strips the href from an UNMARKED anchor (a stale/pasted link is inert)', () => {
      const out = sanitizePostBodyHtml('<a href="https://explorer.e.cash/tx/abc">tx</a>')
      expect(out).not.toContain('href')
      expect(out).toContain('>tx<')
    })

    it('neutralizes a javascript: href even when mis-marked as external', () => {
      const out = sanitizePostBodyHtml('<a data-pow-ext href="javascript:alert(1)">x</a>')
      expect(out.toLowerCase()).not.toContain('javascript:')
      expect(out).not.toContain('href')
    })
  })

  describe('youtube embed', () => {
    it('keeps a validated youtube-nocookie iframe in a .ytembed wrapper', () => {
      const out = sanitizePostBodyHtml(
        '<div class="ytembed"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" allow="encrypted-media" allowfullscreen></iframe></div>',
      )
      expect(out).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"')
      expect(out).toContain('class="ytembed"')
    })

    it('drops a non-YouTube iframe entirely', () => {
      const out = sanitizePostBodyHtml('<div class="ytembed"><iframe src="https://evil.com/x"></iframe></div>')
      expect(out).not.toContain('<iframe')
      expect(out).not.toContain('evil.com')
    })

    it('drops a javascript: iframe src', () => {
      const out = sanitizePostBodyHtml('<iframe src="javascript:alert(1)"></iframe>')
      expect(out.toLowerCase()).not.toContain('javascript:')
      expect(out).not.toContain('<iframe')
    })

    it('strips a class that is not the embed wrapper', () => {
      const out = sanitizePostBodyHtml('<div class="sneaky">hi</div>')
      expect(out).not.toContain('sneaky')
      expect(out).toContain('hi')
    })
  })
})
