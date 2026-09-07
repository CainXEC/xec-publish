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
 * placeholder tab to survive the async nonce fetch — except with the desktop
 * extension present, where beginCashtabPayment opens nothing (in-page popup).
 */
export function armLoginLaunch(): void {
  // Drop a stale arm (e.g. a previous Login tap that never reached /login) so we
  // never leak more than one blank tab.
  if (pending) abortCashtabPayment(pending)
  // Name the window 'cashtab' so login REUSES the Cashtab tab the onboarding
  // "Get Cashtab" step already opened (same name) instead of opening a second,
  // competing cashtab.com tab — two tabs break the self-close-and-return on iOS.
  pending = beginCashtabPayment('cashtab')
}

/** /login retrieves (and clears) the armed launch, if any. */
export function takeLoginLaunch(): CashtabGesture | null {
  const g = pending
  pending = null
  return g
}
