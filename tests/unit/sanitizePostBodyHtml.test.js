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
  describe('tables', () => {
    // What the editor's getHTML() emits for a 2×2 table with a header row.
    const EDITOR_TABLE =
      '<table style="min-width: 50px"><colgroup><col style="min-width: 25px"><col style="min-width: 25px"></colgroup>' +
      '<tbody><tr><th colspan="1" rowspan="1"><p>Name</p></th><th colspan="1" rowspan="1"><p>Price</p></th></tr>' +
      '<tr><td colspan="1" rowspan="1"><p>Handle</p></td><td colspan="1" rowspan="1"><p style="text-align: right">10,000 XEC</p></td></tr></tbody></table>'

    it('keeps the table, header and cells, dropping editor-only widths', () => {
      const out = sanitizePostBodyHtml(EDITOR_TABLE)
      expect(out).toContain('<table><tbody><tr><th colspan="1" rowspan="1"><p>Name</p></th>')
      expect(out).toContain('<td colspan="1" rowspan="1"><p style="text-align: right">10,000 XEC</p></td>')
      expect(out).not.toContain('colgroup')
      expect(out).not.toContain('<col')
      expect(out).not.toContain('min-width')
    })

    it('keeps thead/tbody from pasted tables', () => {
      const out = sanitizePostBodyHtml(
        '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>',
      )
      expect(out).toBe('<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>')
    })

    it('keeps only small whole-number spans', () => {
      const out = sanitizePostBodyHtml(
        '<table><tbody><tr><td colspan="2" rowspan="999">a</td><td colspan="x" rowspan="3">b</td></tr></tbody></table>',
      )
      expect(out).toContain('<td colspan="2">a</td>')
      expect(out).toContain('<td rowspan="3">b</td>')
    })

    it('still strips scripts, handlers and unsafe styles inside cells', () => {
      const out = sanitizePostBodyHtml(
        '<table><tbody><tr><td onclick="steal()" style="background:url(x)"><p>hi</p><script>alert(1)</script></td></tr></tbody></table>',
      )
      expect(out).toBe('<table><tbody><tr><td><p>hi</p></td></tr></tbody></table>')
    })
  })
})
