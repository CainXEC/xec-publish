import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture what the profile cache registers and what a mint delivery clears,
// without a Next request store.
const { revalidateTag, unstable_cache } = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((fn) => fn),
}))
vi.mock('next/cache', () => ({ revalidateTag, unstable_cache }))
// Keep the enumeration offline: an empty wallet (the cache path then throws → []).
vi.mock('chronik-client', () => ({
  ChronikClient: class {
    address() {
      return { utxos: async () => ({ utxos: [] }) }
    }
  },
}))

import { heldHandlesCacheTag, forgetHeldHandlesDisplay, cachedHeldHandlesForDisplay } from '@/lib/heldHandles'

// -----------------------------------------------------------------------------
// After @XEC_BITCOIN was delivered, the buyer's profile kept showing only their
// old handle for ~9 minutes: the "Handles" strip is cached 5 minutes per wallet
// and nothing cleared it on delivery. A delivery now drops that wallet's entry.
// The tag must match whichever address form each side holds: the mint side has
// payer_address ("ecash:…"), the profile side may pass the bare form.
// -----------------------------------------------------------------------------

const BUYER = 'ecash:qzvzy5gr6gecgux3xauphuvw0dz062xdu5lzpjcfr2'
const BARE = 'qzvzy5gr6gecgux3xauphuvw0dz062xdu5lzpjcfr2'

beforeEach(() => {
  revalidateTag.mockReset()
  unstable_cache.mockClear()
})

describe('heldHandlesCacheTag', () => {
  it('names the same entry for prefixed, bare, padded and upper-case forms', () => {
    const tag = heldHandlesCacheTag(BUYER)
    expect(tag).toBe(`held-handles:${BARE}`)
    expect(heldHandlesCacheTag(BARE)).toBe(tag)
    expect(heldHandlesCacheTag(`  ${BUYER.toUpperCase()} `)).toBe(tag)
  })
})

describe('forgetHeldHandlesDisplay', () => {
  it('expires the tag the profile cache registers, immediately', async () => {
    // The profile side registers its entry under the tag for the address it holds…
    await cachedHeldHandlesForDisplay(BARE).catch(() => {})
    const opts = unstable_cache.mock.calls[0][2]
    // …and the delivery side clears that same tag from the payer address.
    forgetHeldHandlesDisplay(BUYER)
    expect(revalidateTag).toHaveBeenCalledWith(opts.tags[0], { expire: 0 })
  })

  it('never throws when there is no request store (scripts / tests)', () => {
    revalidateTag.mockImplementation(() => {
      throw new Error('Invariant: static generation store missing')
    })
    expect(() => forgetHeldHandlesDisplay(BUYER)).not.toThrow()
  })

  it('does nothing without an address', () => {
    forgetHeldHandlesDisplay(null)
    forgetHeldHandlesDisplay('')
    expect(revalidateTag).not.toHaveBeenCalled()
  })
})
