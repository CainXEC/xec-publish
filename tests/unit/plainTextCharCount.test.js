import { describe, it, expect } from 'vitest'
import { countPlainTextCharsFromHtml } from '@/lib/plainTextCharCount'

describe('countPlainTextCharsFromHtml', () => {
  it('counts characters after stripping tags', () => {
    expect(countPlainTextCharsFromHtml('<p>hello</p>')).toBe(5)
    expect(countPlainTextCharsFromHtml('<b>hi</b> there')).toBe('hi there'.length)
  })

  it('excludes the paywall-break marker div from the count', () => {
    expect(countPlainTextCharsFromHtml('<div data-paywall-break></div>abc')).toBe(3)
    expect(countPlainTextCharsFromHtml('<div data-paywall-break="true"></div>abc')).toBe(3)
  })

  it('returns 0 for empty or non-string input', () => {
    expect(countPlainTextCharsFromHtml('')).toBe(0)
    expect(countPlainTextCharsFromHtml(null)).toBe(0)
    expect(countPlainTextCharsFromHtml(undefined)).toBe(0)
    expect(countPlainTextCharsFromHtml(42)).toBe(0)
  })
})
