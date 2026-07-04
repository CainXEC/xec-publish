import { describe, it, expect } from 'vitest'
import { postBodyHasMeaningfulText } from '@/lib/postBodyHasMeaningfulText'

describe('postBodyHasMeaningfulText', () => {
  it('is true when visible text remains after stripping markup', () => {
    expect(postBodyHasMeaningfulText('<p>hi</p>')).toBe(true)
    expect(postBodyHasMeaningfulText('<h1>Title</h1><p>body</p>')).toBe(true)
  })

  it('is false for markup with no visible text', () => {
    expect(postBodyHasMeaningfulText('<p></p>')).toBe(false)
    expect(postBodyHasMeaningfulText('<p><br></p>')).toBe(false)
  })

  it('treats non-breaking spaces as empty', () => {
    expect(postBodyHasMeaningfulText('<p>&nbsp;</p>')).toBe(false)
    expect(postBodyHasMeaningfulText('<p>\u00a0</p>')).toBe(false)
  })

  it('ignores the paywall-break marker div', () => {
    expect(postBodyHasMeaningfulText('<div data-paywall-break="true"></div>')).toBe(false)
  })

  it('is false for empty or non-string input', () => {
    expect(postBodyHasMeaningfulText('')).toBe(false)
    expect(postBodyHasMeaningfulText(null)).toBe(false)
    expect(postBodyHasMeaningfulText(undefined)).toBe(false)
  })
})
