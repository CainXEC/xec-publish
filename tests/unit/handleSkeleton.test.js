import { describe, it, expect } from 'vitest'
import { skeleton, validateHandleSyntax, displayHandle } from '@/lib/handleSkeleton'

// Uniqueness gate: two handles collide iff they share a skeleton. These tests pin
// the confusable-folding and case rules so a silent change can't corrupt which
// names are mintable.
describe('skeleton', () => {
  it('is case-insensitive (including through the confusable set)', () => {
    // i folds to l like I does, so case can't leak through the letter i.
    expect(skeleton('SimonCain')).toBe('slmoncaln')
    expect(skeleton('simoncain')).toBe('slmoncaln')
    expect(skeleton('HELLO')).toBe('hello')
    expect(skeleton('Hello')).toBe('hello')
  })

  it('folds capital I and dotted lowercase i TOGETHER (Option 3)', () => {
    // The old rule kept dotted i distinct, leaking case through the letter i
    // (the @indonesia/@Indonesia artifact). Now both fold to l and collide.
    expect(skeleton('SIMONCAIN')).toBe('slmoncaln')
    expect(skeleton('SIMONCAIN')).toBe(skeleton('SimonCain'))
    expect(skeleton('Indonesia')).toBe(skeleton('indonesia'))
  })

  it('folds the bare-vertical family (capital I, lowercase l, digit 1) to one', () => {
    const target = skeleton('allen')
    expect(skeleton('Allen')).toBe(target)
    expect(skeleton('a11en')).toBe(target) // digit 1 -> l
    expect(skeleton('AIlen')).toBe(target) // capital I -> l
    expect(target).toBe('allen')
  })

  it('keeps leet pairs that are NOT bare-vertical distinct (0 stays 0)', () => {
    expect(skeleton('sim0n')).toBe('slm0n') // zero is left alone; the i still folds
    expect(skeleton('sim0n')).not.toBe(skeleton('simon'))
    // 1 IS bare-vertical: s1mon and simon both fold to "slmon" and collide.
    expect(skeleton('s1mon')).toBe('slmon')
    expect(skeleton('s1mon')).toBe(skeleton('simon'))
  })

  it('strips zero-width characters before folding', () => {
    expect(skeleton('sim\u200Bon')).toBe('slmon')
  })
})

describe('validateHandleSyntax', () => {
  it('accepts valid handles (returns null)', () => {
    expect(validateHandleSyntax('simon')).toBeNull()
    expect(validateHandleSyntax('Simon_Cain')).toBeNull()
    expect(validateHandleSyntax('a')).toBeNull()
    expect(validateHandleSyntax('a'.repeat(15))).toBeNull()
  })

  it('rejects the empty handle', () => {
    expect(validateHandleSyntax('')).toBeTruthy()
  })

  it('rejects handles longer than 15 chars', () => {
    expect(validateHandleSyntax('a'.repeat(16))).toBeTruthy()
  })

  it('rejects non-ASCII and disallowed characters', () => {
    expect(validateHandleSyntax('simon cain')).toBeTruthy() // space
    expect(validateHandleSyntax('simon.cain')).toBeTruthy() // dot
    expect(validateHandleSyntax('siménon')).toBeTruthy() // accented
  })

  it('rejects leading/trailing/consecutive underscores', () => {
    expect(validateHandleSyntax('_simon')).toBeTruthy()
    expect(validateHandleSyntax('simon_')).toBeTruthy()
    expect(validateHandleSyntax('si__mon')).toBeTruthy()
  })
})

describe('displayHandle', () => {
  it('preserves case', () => {
    expect(displayHandle('SimonCain')).toBe('SimonCain')
  })

  it('trims whitespace and strips zero-width characters', () => {
    expect(displayHandle('  simon  ')).toBe('simon')
    expect(displayHandle('sim\u200Bon')).toBe('simon')
  })
})
