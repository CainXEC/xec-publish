import { describe, it, expect } from 'vitest'
import { skeleton, validateHandleSyntax, displayHandle } from '@/lib/handleSkeleton'

// Uniqueness gate: two handles collide iff they share a skeleton. These tests pin
// the confusable-folding and case rules so a silent change can't corrupt which
// names are mintable.
describe('skeleton', () => {
  it('is case-insensitive (for chars outside the confusable set)', () => {
    expect(skeleton('SimonCain')).toBe('simoncain')
    expect(skeleton('simoncain')).toBe('simoncain')
    // No I/l/1 here, so pure case folding: HELLO == Hello == hello.
    expect(skeleton('HELLO')).toBe('hello')
    expect(skeleton('Hello')).toBe('hello')
  })

  it('treats capital I and dotted lowercase i as DISTINCT (I is a bare vertical)', () => {
    // "SIMONCAIN" has capital I -> folds to l; "SimonCain" has lowercase i -> stays.
    expect(skeleton('SIMONCAIN')).toBe('slmoncaln')
    expect(skeleton('SIMONCAIN')).not.toBe(skeleton('SimonCain'))
  })

  it('folds the bare-vertical family (capital I, lowercase l, digit 1) to one', () => {
    const target = skeleton('allen')
    expect(skeleton('Allen')).toBe(target)
    expect(skeleton('a11en')).toBe(target) // digit 1 -> l
    expect(skeleton('AIlen')).toBe(target) // capital I -> l
    expect(target).toBe('allen')
  })

  it('keeps leet pairs that are NOT bare-vertical distinct (0, dotted i)', () => {
    expect(skeleton('sim0n')).toBe('sim0n') // zero is left alone
    expect(skeleton('sim0n')).not.toBe(skeleton('simon'))
    // s1mon folds 1->l => "slmon", distinct from "simon"
    expect(skeleton('s1mon')).toBe('slmon')
    expect(skeleton('s1mon')).not.toBe(skeleton('simon'))
  })

  it('strips zero-width characters before folding', () => {
    expect(skeleton('sim\u200Bon')).toBe('simon')
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
