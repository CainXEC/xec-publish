import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

// -----------------------------------------------------------------------------
// After claiming the welcome gift, "Mint your handle →" sent brand-new users to
// /claim-handle — the grandfathered-author claim, which needs a one-time code
// they don't have. It now goes to the mint flow (/marketplace) with Pay with POW
// pre-selected, since the gift's 10 POW buys a handle and its XEC doesn't.
// -----------------------------------------------------------------------------

import {
  MINT_HANDLE_PATH,
  CLAIM_HANDLE_PATH,
  mintHandleHref,
  initialPayWith,
} from '@/lib/handleRoutes'

describe('mintHandleHref', () => {
  it('points at the mint flow, not the grandfather claim', () => {
    expect(MINT_HANDLE_PATH).toBe('/marketplace')
    expect(mintHandleHref()).toBe('/marketplace')
    expect(mintHandleHref()).not.toContain(CLAIM_HANDLE_PATH)
  })

  it('can pre-select paying with POW', () => {
    expect(mintHandleHref({ payWith: 'pow' })).toBe('/marketplace?pay=pow')
    expect(mintHandleHref({ payWith: 'xec' })).toBe('/marketplace')
  })
})

describe('initialPayWith', () => {
  it('starts on POW for a signed-in visitor arriving with ?pay=pow', () => {
    expect(initialPayWith('?pay=pow', true)).toBe('pow')
    expect(initialPayWith('?view=all&pay=pow', true)).toBe('pow')
  })

  it('starts on XEC otherwise', () => {
    expect(initialPayWith('', true)).toBe('xec')
    expect(initialPayWith('?pay=xec', true)).toBe('xec')
    expect(initialPayWith('?pay=bogus', true)).toBe('xec')
  })

  it('never starts a signed-out visitor on POW (POW mints need login)', () => {
    expect(initialPayWith('?pay=pow', false)).toBe('xec')
  })
})

// Nothing in the UI links to the grandfather claim page: its audience reaches it
// from the private message that carried their claim code, never from a button.
// (A source scan, because vitest here can't parse JSX inside .js components.)
describe('no UI link to /claim-handle', () => {
  const ROOT = path.resolve(__dirname, '../..')
  const files = (dir) =>
    readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = path.join(dir, e.name)
      if (e.isDirectory()) return files(rel)
      return /\.(jsx?|tsx?)$/.test(e.name) ? [rel] : []
    })

  it('no component or page links to the claim page', () => {
    const offenders = [...files('components'), ...files('app')].filter((f) =>
      /["'`]\/claim-handle/.test(readFileSync(path.join(ROOT, f), 'utf8')),
    )
    expect(offenders).toEqual([])
  })

  it('the welcome-gift card sends "Mint your handle" to the mint flow with POW selected', () => {
    const src = readFileSync(path.join(ROOT, 'components/onboarding/StarterXecCard.js'), 'utf8')
    expect(src).toMatch(/href=\{mintHandleHref\(\{ payWith: 'pow' \}\)\}[^>]*>\s*Mint your handle/)
  })
})
