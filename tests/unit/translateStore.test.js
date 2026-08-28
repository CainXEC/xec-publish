// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  getShortTranslation,
  setShortTranslation,
  clearShortTranslation,
} from '@/lib/translateStore'

beforeEach(() => {
  // A fresh in-memory localStorage per test (jsdom's isn't reliably present here).
  const mem = new Map()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
      clear: () => mem.clear(),
    },
  })
})

describe('short-content translation store (Option B — feed/comments)', () => {
  it('round-trips a stored translation and clears it', () => {
    setShortTranslation('feed', 'tx1', { translated: 'hola', lang: 'es' })
    expect(getShortTranslation('feed', 'tx1')?.data?.translated).toBe('hola')
    expect(getShortTranslation('feed', 'tx1')?.lang).toBe('es')
    clearShortTranslation('feed', 'tx1')
    expect(getShortTranslation('feed', 'tx1')).toBeNull()
  })

  it('keys by kind AND id (feed vs comment are distinct)', () => {
    setShortTranslation('feed', 'x', { translated: 'F', lang: 'es' })
    setShortTranslation('comment', 'x', { translated: 'C', lang: 'es' })
    expect(getShortTranslation('feed', 'x')?.data?.translated).toBe('F')
    expect(getShortTranslation('comment', 'x')?.data?.translated).toBe('C')
  })

  it('caps the store (LRU) so it cannot grow without bound', () => {
    for (let i = 0; i < 205; i++) {
      setShortTranslation('feed', `tx${i}`, { translated: `t${i}`, lang: 'es' })
    }
    const raw = JSON.parse(window.localStorage.getItem('pow_tr_short') || '{}')
    expect(Object.keys(raw).length).toBeLessThanOrEqual(200)
    // The most recently stored survives; the oldest were evicted.
    expect(getShortTranslation('feed', 'tx204')?.data?.translated).toBe('t204')
    expect(getShortTranslation('feed', 'tx0')).toBeNull()
  })

  it('ignores bad input', () => {
    setShortTranslation('feed', null, { translated: 'x' })
    setShortTranslation(null, 'x', { translated: 'x' })
    setShortTranslation('feed', 'x', null)
    expect(getShortTranslation('feed', 'x')).toBeNull()
    expect(getShortTranslation('feed', null)).toBeNull()
  })
})
