// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The helper subscribes to a Chronik ws; stub it to a no-op unwatch so the timing
// behavior can be tested in isolation.
vi.mock('@/lib/ecash/watchPaymentAddress', () => ({
  watchPaymentAddress: vi.fn(() => () => {}),
}))

import { pollUntil } from '@/lib/ecash/pollUntil'
import { watchPaymentAddress } from '@/lib/ecash/watchPaymentAddress'

describe('pollUntil', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('checks immediately, then on the interval, and stops on done', async () => {
    let calls = 0
    const check = vi.fn(async () => {
      calls += 1
      return calls >= 2 ? { done: true } : undefined
    })
    pollUntil(check, { intervalMs: 1000 })

    await vi.advanceTimersByTimeAsync(0) // immediate check #1
    expect(check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000) // tick → check #2 → done
    expect(check).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5000) // nothing more after done
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('doubles the delay on a backoff result, capped at maxDelayMs', async () => {
    const check = vi.fn(async () => ({ backoff: true }))
    pollUntil(check, { intervalMs: 1000, maxDelayMs: 4000 })

    await vi.advanceTimersByTimeAsync(0) // #1 → backoff, next delay 2000
    expect(check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000) // only 1000 elapsed, delay is 2000
    expect(check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000) // 2000 total → #2 → next delay 4000
    expect(check).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(4000) // #3 (cap holds)
    expect(check).toHaveBeenCalledTimes(3)
  })

  it('resets to the base cadence after a healthy (non-backoff) check', async () => {
    let calls = 0
    const check = vi.fn(async () => {
      calls += 1
      return calls === 1 ? { backoff: true } : undefined // one throttle, then healthy
    })
    pollUntil(check, { intervalMs: 1000, maxDelayMs: 8000 })

    await vi.advanceTimersByTimeAsync(0) // #1 backoff → delay 2000
    await vi.advanceTimersByTimeAsync(2000) // #2 healthy → delay back to 1000
    expect(check).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000) // #3 at the base cadence again
    expect(check).toHaveBeenCalledTimes(3)
  })

  it('stops after the lifetime cap and calls onLifetimeExpired once', async () => {
    const check = vi.fn(async () => undefined)
    const onExpire = vi.fn()
    pollUntil(check, { intervalMs: 1000, maxLifetimeMs: 2500, onLifetimeExpired: onExpire })

    await vi.advanceTimersByTimeAsync(0) // t=0 #1
    await vi.advanceTimersByTimeAsync(1000) // t=1000 #2
    await vi.advanceTimersByTimeAsync(1000) // t=2000 #3
    await vi.advanceTimersByTimeAsync(1000) // t=3000 > 2500 → stop, no #4
    expect(check).toHaveBeenCalledTimes(3)
    expect(onExpire).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('the returned stop() halts polling and unwatches', async () => {
    const unwatch = vi.fn()
    watchPaymentAddress.mockReturnValueOnce(unwatch)
    const check = vi.fn(async () => undefined)
    const stop = pollUntil(check, { intervalMs: 1000, onWsAddress: 'ecash:qtest' })

    await vi.advanceTimersByTimeAsync(0) // #1
    expect(check).toHaveBeenCalledTimes(1)
    stop()
    expect(unwatch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(check).toHaveBeenCalledTimes(1) // no further checks
  })

  it('wires the ws nudge to the given address and threads the txid when asked', async () => {
    const seen = []
    const check = vi.fn(async (txid) => {
      seen.push(txid)
      return undefined
    })
    pollUntil(check, { intervalMs: 10_000, onWsAddress: 'ecash:qabc', wsThreadsTxid: true })
    await vi.advanceTimersByTimeAsync(0) // immediate loop check (no wsTxid)

    // Grab the onTx callback the helper registered and fire it like a ws landing.
    const [addr, onTx] = watchPaymentAddress.mock.calls[0]
    expect(addr).toBe('ecash:qabc')
    onTx('deadbeef')
    await vi.advanceTimersByTimeAsync(0)
    expect(seen).toContain('deadbeef') // threaded through to check()
  })

  it('swallows a throw in check and keeps polling', async () => {
    let calls = 0
    const check = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('transport blip')
      return calls >= 2 ? { done: true } : undefined
    })
    pollUntil(check, { intervalMs: 1000 })

    await vi.advanceTimersByTimeAsync(0) // #1 throws — loop must survive
    expect(check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000) // #2 → done
    expect(check).toHaveBeenCalledTimes(2)
  })
})
