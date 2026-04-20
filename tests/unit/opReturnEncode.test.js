import { describe, it, expect } from 'vitest'
import { decodeOpReturnToPostId, encodePostIdOpReturnRaw } from '@/lib/opReturnEncode'

const SAMPLE_UUID = 'd66cb66c-debd-4700-8228-15627f4ca434'

describe('encodePostIdOpReturnRaw', () => {
  it('matches the "abc" example: push 3 + ASCII bytes', () => {
    const bytes = new TextEncoder().encode('abc')
    const push = bytes.length.toString(16).padStart(2, '0')
    const hex = push + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(hex).toBe('03616263')
  })

  it('encodes a 36-char UUID with 0x24 push prefix', () => {
    const raw = encodePostIdOpReturnRaw(SAMPLE_UUID)
    expect(raw.startsWith('24')).toBe(true)
    expect(raw.length).toBe(2 + 36 * 2)
  })

  it('throws for non-36-byte strings', () => {
    expect(() => encodePostIdOpReturnRaw('short')).toThrow()
    expect(() => encodePostIdOpReturnRaw(`${SAMPLE_UUID}x`)).toThrow()
  })
})

describe('decodeOpReturnToPostId', () => {
  it('round-trips encode then decode to the original UUID', () => {
    const raw = encodePostIdOpReturnRaw(SAMPLE_UUID)
    const scriptHex = `6a${raw}`
    expect(decodeOpReturnToPostId(scriptHex)).toBe(SAMPLE_UUID)
  })

  it('supports OP_PUSHDATA1 wrapper (6a4c24…)', () => {
    const raw = encodePostIdOpReturnRaw(SAMPLE_UUID)
    const pushLen = 0x24
    const scriptHex = `6a4c${pushLen.toString(16).padStart(2, '0')}${raw.slice(2)}`
    expect(decodeOpReturnToPostId(scriptHex)).toBe(SAMPLE_UUID)
  })

  it('returns null for wrong opcode (not OP_RETURN)', () => {
    expect(decodeOpReturnToPostId('7624' + '61'.repeat(36))).toBeNull()
  })

  it('returns null for empty or too-short scripts', () => {
    expect(decodeOpReturnToPostId('')).toBeNull()
    expect(decodeOpReturnToPostId('6a')).toBeNull()
  })

  it('returns null when push length exceeds remaining hex', () => {
    expect(decodeOpReturnToPostId('6a2400')).toBeNull()
  })

  it('returns null for invalid UTF-8 payload', () => {
    expect(decodeOpReturnToPostId('6a03eda0bf')).toBeNull()
  })

  it('decodes a short ASCII push after OP_RETURN', () => {
    const scriptHex = '6a03616263'
    expect(decodeOpReturnToPostId(scriptHex)).toBe('abc')
  })
})
