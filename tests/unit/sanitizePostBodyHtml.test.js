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
})
