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

import {
  beginCashtabPayment,
  abortCashtabPayment,
  isCashtabExtensionAvailable,
  type CashtabGesture,
} from './cashtabPay'

let pending: CashtabGesture | null = null

/**
 * Call SYNCHRONOUSLY inside the Login tap (before navigating to /login).
 *
 * `existingWindow` — the Cashtab tab the onboarding "Get Cashtab" step already
 * opened (its actual Window handle). When present (and still open, and there's
 * no desktop extension), login REUSES that exact window for the payment rather
 * than opening a second, competing cashtab.com tab. This matters most on iOS
 * Chrome, where neither named-window reuse NOR window.close() works — so a
 * leftover Cashtab tab can't be merged or dismissed, and its presence breaks
 * Cashtab's self-close-and-return (you're left stranded on Cashtab). Holding the
 * real handle and navigating THAT window is the only reliable way to keep one
 * tab. Without an existing window, opens its own placeholder tab to survive the
 * async nonce fetch — except with the extension, where nothing is opened.
 */
export function armLoginLaunch(existingWindow?: Window | null): void {
  // Drop a stale arm (e.g. a previous Login tap that never reached /login) so we
  // never leak more than one blank tab.
  if (pending) abortCashtabPayment(pending)
  // Reuse the onboarding's Cashtab tab by HANDLE when we have one open and no
  // extension will handle the payment in-page.
  if (existingWindow && !existingWindow.closed && !isCashtabExtensionAvailable()) {
    pending = { hasExtension: false, placeholderWindow: existingWindow }
    return
  }
  pending = beginCashtabPayment('cashtab')
}

/** /login retrieves (and clears) the armed launch, if any. */
export function takeLoginLaunch(): CashtabGesture | null {
  const g = pending
  pending = null
  return g
}
