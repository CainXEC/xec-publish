import { describe, it, expect } from 'vitest'
import { charCounterClassName } from '@/lib/charCounterClassName'

const MUTED = 'text-zinc-500 dark:text-zinc-400'
const WARN = 'text-amber-600 dark:text-amber-400'
const OVER = 'text-red-600 dark:text-red-400'

describe('charCounterClassName', () => {
  it('is muted well under the limit', () => {
    expect(charCounterClassName(0, 100, 20)).toBe(MUTED)
    expect(charCounterClassName(79, 100, 20)).toBe(MUTED)
  })

  it('warns once within the warn window', () => {
    expect(charCounterClassName(80, 100, 20)).toBe(WARN)
    expect(charCounterClassName(99, 100, 20)).toBe(WARN)
  })

  it('flags red at or over the limit', () => {
    expect(charCounterClassName(100, 100, 20)).toBe(OVER)
    expect(charCounterClassName(120, 100, 20)).toBe(OVER)
  })
})
