import { describe, it, expect } from 'vitest'
import { chunkTextForTTS, TTS_CHUNK_SIZE } from '@/lib/audioChunking'

const byteLen = (s) => new TextEncoder().encode(s).length

describe('chunkTextForTTS', () => {
  it('returns no chunks for empty or whitespace-only text', () => {
    expect(chunkTextForTTS('')).toEqual([])
    expect(chunkTextForTTS('   \n  ')).toEqual([])
    expect(chunkTextForTTS(null)).toEqual([])
  })

  it('returns a single chunk when text fits under the byte cap', () => {
    expect(chunkTextForTTS('Hello world.')).toEqual(['Hello world.'])
  })

  it('keeps every chunk within the byte cap', () => {
    const text = 'a'.repeat(50)
    const chunks = chunkTextForTTS(text, 10)
    expect(chunks.length).toBe(5)
    for (const c of chunks) expect(byteLen(c)).toBeLessThanOrEqual(10)
    expect(chunks.join('')).toBe(text)
  })

  it('prefers to split at a paragraph boundary', () => {
    const text = 'First paragraph here.\n\nSecond paragraph here.'
    const chunks = chunkTextForTTS(text, 30)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]).toBe('First paragraph here.')
  })

  it('never breaks a multi-byte UTF-8 sequence across chunks', () => {
    // "é" is 2 bytes in UTF-8; every chunk must still decode cleanly.
    const text = 'é'.repeat(40)
    const chunks = chunkTextForTTS(text, 9)
    for (const c of chunks) {
      expect(byteLen(c)).toBeLessThanOrEqual(9)
      // A clean split means the reassembled string has no replacement chars.
      expect(c).not.toContain('\uFFFD')
    }
    expect(chunks.join('')).toBe(text)
  })

  it('exposes a chunk size safely under Google TTS 5000-byte cap', () => {
    expect(TTS_CHUNK_SIZE).toBeLessThan(5000)
  })
})
