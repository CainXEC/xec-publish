import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The scheduler fires the on-chain re-verification via next/server's after().
// Stub after() so we can assert WHETHER it was scheduled without needing a real
// request scope, and so the (unmocked) reverify callback never actually runs.
const afterMock = vi.fn()
vi.mock('next/server', () => ({ after: (fn) => afterMock(fn) }))

import { handleCheckIsStale, scheduleHandleReverifyIfStale } from '@/lib/resolveProfile'

const HOUR = 60 * 60 * 1000

describe('handleCheckIsStale', () => {
  it('is stale when never checked (null)', () => {
    expect(handleCheckIsStale(null)).toBe(true)
    expect(handleCheckIsStale(undefined)).toBe(true)
  })

  it('is fresh right after a check', () => {
    expect(handleCheckIsStale(new Date().toISOString())).toBe(false)
  })

  it('is stale once the check is older than the TTL', () => {
    const old = new Date(Date.now() - HOUR).toISOString()
    expect(handleCheckIsStale(old)).toBe(true)
  })
})

describe('scheduleHandleReverifyIfStale', () => {
  beforeEach(() => afterMock.mockClear())
  afterEach(() => vi.clearAllMocks())

  it('schedules a re-verify for a stale handle-holder', () => {
    const fired = scheduleHandleReverifyIfStale(
      { id: 'a1', active_handle_token_id: 'tok', display_handle_checked_at: null },
      'ecash:qtest',
    )
    expect(fired).toBe(true)
    expect(afterMock).toHaveBeenCalledTimes(1)
  })

  it('does nothing for an account that displays no handle (no token)', () => {
    const fired = scheduleHandleReverifyIfStale(
      { id: 'a1', active_handle_token_id: null, display_handle_checked_at: null },
      'ecash:qtest',
    )
    expect(fired).toBe(false)
    expect(afterMock).not.toHaveBeenCalled()
  })

  it('does not re-check a handle verified within the TTL', () => {
    const fired = scheduleHandleReverifyIfStale(
      {
        id: 'a1',
        active_handle_token_id: 'tok',
        display_handle_checked_at: new Date().toISOString(),
      },
      'ecash:qtest',
    )
    expect(fired).toBe(false)
    expect(afterMock).not.toHaveBeenCalled()
  })
})
