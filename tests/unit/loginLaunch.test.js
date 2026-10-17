// Verifies how /login gets the user off the Cashtab PAYMENT tab once login
// lands: Cashtab must get to close its own tab first (Android Chrome / desktop /
// iOS Safari — the user drops back onto POW); POW only navigates the tab to POW
// itself if it is STILL open after the grace window (iOS Chrome ignores
// window.close()). Navigating it immediately raced Cashtab's own close and won,
// so on Android the Cashtab tab turned into POW instead of closing.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  handBackPaymentWindow,
  PAYMENT_TAB_CLOSE_GRACE_MS,
} from '@/lib/ecash/loginLaunch'

const POW_URL = 'https://www.proofofwriting.com/'

// A stand-in for the cross-origin Cashtab window handle: `closed` flips when
// Cashtab closes itself; `location.href` records whether POW took it over.
function fakeWindow() {
  return { closed: false, location: { href: 'https://cashtab.com/#/send?bip21=x' } }
}

describe('handBackPaymentWindow', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('leaves the tab alone when Cashtab closes it within the grace window', async () => {
    const w = fakeWindow()
    const p = handBackPaymentWindow(w, POW_URL)
    // Cashtab's success screen is 2.1s, then window.close().
    await vi.advanceTimersByTimeAsync(2100)
    w.closed = true
    await vi.advanceTimersByTimeAsync(200)
    await expect(p).resolves.toBe('closed')
    expect(w.location.href).not.toBe(POW_URL)
    // Nothing fires later either.
    await vi.advanceTimersByTimeAsync(PAYMENT_TAB_CLOSE_GRACE_MS)
    expect(w.location.href).not.toBe(POW_URL)
  })

  it('does not take the tab over before the grace window ends', async () => {
    const w = fakeWindow()
    void handBackPaymentWindow(w, POW_URL)
    await vi.advanceTimersByTimeAsync(PAYMENT_TAB_CLOSE_GRACE_MS - 200)
    expect(w.location.href).not.toBe(POW_URL)
  })

  it('points a tab Cashtab could not close at POW once the grace window ends', async () => {
    const w = fakeWindow()
    const p = handBackPaymentWindow(w, POW_URL)
    await vi.advanceTimersByTimeAsync(PAYMENT_TAB_CLOSE_GRACE_MS)
    await expect(p).resolves.toBe('redirected')
    expect(w.location.href).toBe(POW_URL)
  })

  it('counts elapsed time, so a throttled (≈1/s) background interval still ends on time', async () => {
    const w = fakeWindow()
    const p = handBackPaymentWindow(w, POW_URL, { pollMs: 1000 })
    await vi.advanceTimersByTimeAsync(PAYMENT_TAB_CLOSE_GRACE_MS)
    await expect(p).resolves.toBe('redirected')
  })

  it('resolves at once when there is no tab, or it is already closed', async () => {
    await expect(handBackPaymentWindow(null, POW_URL)).resolves.toBe('none')
    const w = fakeWindow()
    w.closed = true
    await expect(handBackPaymentWindow(w, POW_URL)).resolves.toBe('closed')
    expect(w.location.href).not.toBe(POW_URL)
  })

  it('treats an unreachable handle as gone instead of throwing', async () => {
    const w = {
      get closed() {
        throw new Error('blocked')
      },
      location: { href: 'x' },
    }
    await expect(handBackPaymentWindow(w, POW_URL)).resolves.toBe('closed')
  })
})
