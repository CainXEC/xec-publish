import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// -----------------------------------------------------------------------------
// The logged-out "Get started" copy promised "2,500 XEC + 10 POW free" no matter
// what — even after the faucet was taken down. The strip and modal now render
// the gift only while faucetOffer() says it's open (lib/faucetConfig.ts): the
// live pow_reward_config switch AND a configured sender. It fails CLOSED — if
// the config can't be read, the site doesn't promise a gift it can't confirm.
// -----------------------------------------------------------------------------

const { db } = vi.hoisted(() => ({ db: { config: null, error: null } }))
vi.mock('next/cache', () => ({ unstable_cache: (fn) => fn }))
vi.mock('@/lib/db', () => ({
  adminDb: () => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () =>
        db.error ? { data: null, error: db.error } : { data: db.config ? { config: db.config } : null, error: null },
    }
    return { from: () => query }
  },
}))

import { faucetOffer } from '@/lib/faucetConfig'

beforeEach(() => {
  db.config = null
  db.error = null
  vi.stubEnv('PATRON_WALLET_MNEMONIC', 'test words')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('faucetOffer', () => {
  it('is open, at the live amounts, while the switch is on', async () => {
    db.config = { enabled: true, xecPerClaim: 5000, powPerClaim: 10 }
    expect(await faucetOffer()).toEqual({ open: true, xec: 5000, pow: 10 })
  })

  it('is closed once the switch is turned off', async () => {
    db.config = { enabled: false }
    expect((await faucetOffer()).open).toBe(false)
  })

  it('is closed when no sender wallet is configured', async () => {
    vi.stubEnv('PATRON_WALLET_MNEMONIC', '')
    db.config = { enabled: true }
    expect((await faucetOffer()).open).toBe(false)
  })

  it('fails closed when the config cannot be read', async () => {
    db.error = { message: 'connection reset' }
    expect((await faucetOffer()).open).toBe(false)
  })
})
