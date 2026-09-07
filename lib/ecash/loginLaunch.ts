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
 * placeholder tab (brought to the foreground by window.open — the only way to
 * foreground a Cashtab tab on iOS) to survive the async nonce fetch, except with
 * the desktop extension present, where nothing is opened (in-page popup). Named
 * 'cashtab' so it reuses an existing Cashtab tab where the browser honors that
 * (desktop / Android) instead of piling up a second one.
 */
export function armLoginLaunch(): void {
  // Drop a stale arm (e.g. a previous Login tap that never reached /login) so we
  // never leak more than one blank tab.
  if (pending) abortCashtabPayment(pending)
  pending = beginCashtabPayment('cashtab')
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
