import { describe, it, expect } from 'vitest'
import { truncateAtWord } from '@/lib/truncateAtWord'

// Share cards are permanent and public — whatever the card says is what sits in
// someone else's timeline forever. These pin the two failure modes that made a
// card look broken: a word cut in half, and a clipped card with no "…" at all.

describe('truncateAtWord', () => {
  it('leaves text that already fits completely alone — no ellipsis', () => {
    expect(truncateAtWord('short and sweet', 280)).toBe('short and sweet')
  })

  it('leaves text of exactly the budget alone', () => {
    const s = 'a'.repeat(50)
    expect(truncateAtWord(s, 50)).toBe(s)
  })

  it('cuts at a word boundary, never mid-word', () => {
    const out = truncateAtWord('the quick brown fox jumps over the lazy dog', 20)
    expect(out).toBe('the quick brown fox…')
    expect(out.length).toBeLessThanOrEqual(20)
  })

  it('never emits a trailing space before the ellipsis', () => {
    expect(truncateAtWord('alpha beta gamma delta', 12)).toBe('alpha beta…')
  })

  it('always marks that something was removed', () => {
    expect(truncateAtWord('a'.repeat(400), 280).endsWith('…')).toBe(true)
  })

  it('stays inside the budget so it is safe for a hard limit', () => {
    for (const max of [10, 40, 160, 200, 280]) {
      expect(truncateAtWord('word '.repeat(200), max).length).toBeLessThanOrEqual(max)
    }
  })

  it('hard-cuts a single unspaced word rather than returning nothing', () => {
    // An eCash address pasted as the whole post: no boundary to back off to.
    const addr = `ecash:${'q'.repeat(60)}`
    const out = truncateAtWord(addr, 30)
    expect(out.length).toBe(30)
    expect(out.startsWith('ecash:q')).toBe(true)
  })

  it('does not let a far-left space eat most of the budget', () => {
    // "I " then one long token — backing off to that space would keep 2 chars.
    const out = truncateAtWord(`I ${'x'.repeat(100)}`, 40)
    expect(out.length).toBe(40)
  })

  it('handles empty and non-string input', () => {
    expect(truncateAtWord('', 100)).toBe('')
    expect(truncateAtWord(null, 100)).toBe('')
    expect(truncateAtWord(undefined, 100)).toBe('')
    expect(truncateAtWord('text', 0)).toBe('')
  })
})
