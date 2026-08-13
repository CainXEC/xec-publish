import { describe, it, expect } from 'vitest'
import { calculateReadingTimeMinutes } from '@/lib/calculateReadingTimeMinutes'
import { formatReadingTimeLabel } from '@/lib/getReadingTime'

describe('calculateReadingTimeMinutes', () => {
  it('strips tags and rounds word count up to whole minutes', () => {
    expect(calculateReadingTimeMinutes('<p>one two three</p>')).toBe(1)
    expect(calculateReadingTimeMinutes(`<p>${'word '.repeat(200).trim()}</p>`)).toBe(1)
    expect(calculateReadingTimeMinutes(`<p>${'word '.repeat(201).trim()}</p>`)).toBe(2)
  })

  it('ignores the paywall-break marker div', () => {
    const body = '<p>word</p><div data-paywall-break="true"></div>'
    expect(calculateReadingTimeMinutes(body)).toBe(1)
  })

  it('tolerates nullish input', () => {
    expect(calculateReadingTimeMinutes(null)).toBe(1) // empty → 1-word split → 1 minute floor
  })

  it('counts CJK characters instead of whitespace-splitting them into one giant "word"', () => {
    // Chinese/Japanese/Korean have no spaces between words — a naive
    // whitespace split treats an entire paragraph as ONE "word", flooring
    // any CJK article to "1 min read" regardless of actual length. 900
    // Han characters at 300 chars/min should read as 3 minutes, not 1.
    const cjk = '這是一篇很長的文章'.repeat(100) // 900 Han characters, zero spaces
    expect(cjk.length).toBe(900)
    expect(calculateReadingTimeMinutes(`<p>${cjk}</p>`)).toBe(3)
  })

  it('sums CJK characters and whitespace-delimited words when an article mixes scripts', () => {
    const cjk = '這是測試文字'.repeat(50) // 300 Han characters -> 1 min at 300 cpm
    const words = 'word '.repeat(200).trim() // 200 words -> 1 min at 200 wpm
    expect(calculateReadingTimeMinutes(`<p>${cjk}</p><p>${words}</p>`)).toBe(2)
  })

  it('regression: the real under-counted article now reads as more than 1 minute', () => {
    // A trimmed but representative slice of the actual reported article
    // (post-1786603442906) — the full body (3,238 characters) was measuring
    // as 2 whitespace "words" and flooring to "1 min read".
    const excerpt =
      '一回角子老虎機的用處沒有勝、沒有付：從角子老虎機經濟到人類學的開端如果把「角子老虎機」只理解成一部賭博機器，我們很容易只看見投入、隨機、勝負與回報。'.repeat(
        20,
      )
    const minutes = calculateReadingTimeMinutes(`<p>${excerpt}</p>`)
    expect(minutes).toBeGreaterThan(1)
  })
})

describe('formatReadingTimeLabel', () => {
  it('labels a single minute in the singular', () => {
    expect(formatReadingTimeLabel(1)).toBe('1 min read')
  })

  it('labels multiple minutes in the plural and rounds', () => {
    expect(formatReadingTimeLabel(5)).toBe('5 min read')
    expect(formatReadingTimeLabel(4.4)).toBe('4 min read')
    expect(formatReadingTimeLabel(4.6)).toBe('5 min read')
  })

  it('returns null for missing or sub-minute values', () => {
    expect(formatReadingTimeLabel(0)).toBeNull()
    expect(formatReadingTimeLabel(0.5)).toBeNull()
    expect(formatReadingTimeLabel(null)).toBeNull()
    expect(formatReadingTimeLabel('nope')).toBeNull()
  })
})
