import { describe, it, expect } from 'vitest'
import {
  XEC_PER_CHARACTER,
  AUDIO_MIN_XEC,
  getPlainTextFromHtml,
  getPlainTextCharCount,
  calculateAudioPriceXec,
  getAudioPriceForPost,
} from '@/lib/audioPricing'

describe('getPlainTextFromHtml', () => {
  it('strips tags and collapses whitespace', () => {
    expect(getPlainTextFromHtml('<p>hi   there</p>')).toBe('hi there')
    expect(getPlainTextFromHtml('<h1>A</h1>\n<p>B</p>')).toBe('A B')
  })

  it('returns empty string for falsy input', () => {
    expect(getPlainTextFromHtml('')).toBe('')
    expect(getPlainTextFromHtml(null)).toBe('')
  })
})

describe('getPlainTextCharCount', () => {
  it('counts characters of the stripped text', () => {
    expect(getPlainTextCharCount('<p>hello</p>')).toBe(5)
  })
})

describe('calculateAudioPriceXec', () => {
  it('charges half a XEC per character, rounded up', () => {
    expect(calculateAudioPriceXec(10)).toBe(5)
    expect(calculateAudioPriceXec(201)).toBe(Math.ceil(201 * XEC_PER_CHARACTER))
  })

  it('is 0 for zero, negative, or missing counts', () => {
    expect(calculateAudioPriceXec(0)).toBe(0)
    expect(calculateAudioPriceXec(-5)).toBe(0)
    expect(calculateAudioPriceXec(undefined)).toBe(0)
  })
})

describe('getAudioPriceForPost', () => {
  it('applies the 100 XEC floor for short posts', () => {
    expect(getAudioPriceForPost(10)).toBe(AUDIO_MIN_XEC)
    expect(getAudioPriceForPost(0)).toBe(AUDIO_MIN_XEC)
  })

  it('uses the per-character price once it exceeds the floor', () => {
    expect(getAudioPriceForPost(300)).toBe(150) // ceil(300 * 0.5)
  })
})
