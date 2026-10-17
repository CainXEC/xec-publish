'use client'
// =============================================================================
//  loginLaunch.ts — carry a Cashtab window opened by the LOGIN tap into /login.
//
//  iOS Safari only lets a site open a NEW window from a real user tap — never
//  from a page-load effect (that's why the login page couldn't auto-open Cashtab
//  in a new window there). So we pre-open a blank tab in the "Login" tap gesture
//  itself (beginCashtabPayment) and stash it here; the /login page points it at
//  Cashtab once the nonce is ready (completeCashtabPayment). Because it's a real
//  window.open()'d window, Cashtab can self-close and return after the send —
//  matching the desktop / Android-Chrome behavior on Safari too.
//
//  Module-level state survives the in-app (SPA) navigation to /login. Login
//  entries reached WITHOUT a tap (a router.replace redirect, a hard load, a
//  pasted URL) simply arm nothing; /login then falls back to its own open
//  attempt + the on-page "Open Cashtab" button.
// =============================================================================

import { beginCashtabPayment, abortCashtabPayment, type CashtabGesture } from './cashtabPay'

let pending: CashtabGesture | null = null

/**
 * Call SYNCHRONOUSLY inside the Login tap (before navigating to /login). Opens a
 * FRESH placeholder tab ('_blank', foregrounded by window.open — the only way to
 * surface a Cashtab tab on iOS) to survive the async nonce fetch, except with
 * the desktop extension present, where nothing is opened (in-page popup).
 *
 * Deliberately '_blank', NOT 'cashtab': the onboarding "Get Cashtab" tab is
 * named 'cashtab', and a matching name makes window.open REUSE that background
 * tab instead of opening a new foregrounded one (so the payment tab never
 * appears). The leftover tab is redirected to POW by its HANDLE, not its name.
 */
export function armLoginLaunch(): void {
  // Drop a stale arm (e.g. a previous Login tap that never reached /login) so we
  // never leak more than one blank tab.
  if (pending) abortCashtabPayment(pending)
  pending = beginCashtabPayment()
}

/** /login retrieves (and clears) the armed launch, if any. */
export function takeLoginLaunch(): CashtabGesture | null {
  const g = pending
  pending = null
  return g
}

// ---------------------------------------------------------------------------
//  The "land back on POW" window.
//
//  Onboarding leaves a second Cashtab tab open (step 1's "Get Cashtab"). On iOS
//  we can neither close it (window.close() is blocked) nor focus it — so when
//  the login payment tab SELF-CLOSES, the browser lands on that leftover Cashtab
//  tab instead of POW. What we CAN do is navigate it: the one operation iOS
//  allows on a window we opened. So /login points it at POW the moment the login
//  is confirmed — then the tab sitting behind the payment tab IS POW, and the
//  self-close lands there. Navigating only after confirmation means it loads
//  already signed in (a navigation at tap time would load it signed out).
// ---------------------------------------------------------------------------

let returnWindow: Window | null = null

/** Hand /login the leftover Cashtab tab to redirect to POW once login lands. */
export function setLoginReturnWindow(w: Window | null): void {
  returnWindow = w
}

/** /login retrieves (and clears) that tab, if any. */
export function takeLoginReturnWindow(): Window | null {
  const w = returnWindow
  returnWindow = null
  return w
}

// ---------------------------------------------------------------------------
//  Getting the user off the Cashtab PAYMENT tab once login lands.
//
//  The designed flow: Cashtab sends, shows its success screen, then calls
//  window.close() itself (~2.1s after the broadcast) — the tab closes and the
//  user drops back onto POW. That works wherever the browser lets a script
//  close a window it opened (Android Chrome, desktop, iOS Safari). iOS Chrome
//  ignores the close and strands the user on Cashtab, so there we have to
//  navigate the tab to POW ourselves.
//
//  We can't tell those apart up front, and login is 0-conf — POW sees the
//  payment ~1s after the send, BEFORE Cashtab's close fires. Navigating the tab
//  right away therefore beat Cashtab's own close everywhere: on Android the
//  Cashtab tab turned into POW instead of closing, so it looked like Cashtab
//  had opened in the same tab. So: give Cashtab a grace window to close itself,
//  and take the tab over only if it's still open after that.
// ---------------------------------------------------------------------------

/** How long Cashtab gets to close its own tab (its success screen is 2.1s). */
export const PAYMENT_TAB_CLOSE_GRACE_MS = 3000

function isGone(w: Window): boolean {
  try {
    return w.closed
  } catch {
    return true // no longer reachable — nothing we could navigate anyway
  }
}

/**
 * Resolves once the payment tab has closed itself ('closed') or, if it's still
 * open after the grace window, once we've pointed it at POW ('redirected').
 * 'none' when there's no tab to deal with. Callers navigate themselves AFTER
 * this — navigating away first would kill the timer.
 */
export function handBackPaymentWindow(
  w: Window | null,
  powUrl: string,
  { graceMs = PAYMENT_TAB_CLOSE_GRACE_MS, pollMs = 200 } = {},
): Promise<'none' | 'closed' | 'redirected'> {
  if (!w) return Promise.resolve('none')
  if (isGone(w)) return Promise.resolve('closed')
  return new Promise((resolve) => {
    // Elapsed time, not tick count: a backgrounded tab's interval is throttled
    // (≈1/s), so ticks under-count the wait.
    const startedAt = Date.now()
    const id = setInterval(() => {
      if (isGone(w)) {
        clearInterval(id)
        resolve('closed')
        return
      }
      if (Date.now() - startedAt >= graceMs) {
        clearInterval(id)
        try {
          w.location.href = powUrl
        } catch {
          /* cross-origin navigation blocked — the POW tab still redirects itself */
        }
        resolve('redirected')
      }
    }, pollMs)
  })
}
