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
