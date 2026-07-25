// =============================================================================
//  cashtabPay.ts — the single choke-point for "start a Cashtab payment".
//
//  Desktop-only enhancement: if the user has the Cashtab BROWSER EXTENSION, the
//  payment is driven through the extension's in-page approval popup (no tab).
//  If they don't, we fall back to today's behavior exactly — open the Cashtab
//  WEB wallet (https://cashtab.com/#/send?bip21=…) in a new tab. NEVER both.
//
//  Mobile is safe by construction: the extension announces itself by setting
//  window.bitcoinAbc === 'cashtab', which only a desktop browser extension can
//  do. On mobile that global is never set, so isCashtabExtensionAvailable() is
//  always false and every flow takes the identical web-tab path it has today.
//  No user-agent sniffing is used or needed.
//
//  Both paths carry the FULL BIP21 string (including our op_return_raw envelope
//  — auth nonce / content hash / feed action), so the on-chain result is
//  identical either way. Verification is unchanged: each call site's existing
//  Chronik watch/poll detects the landed tx regardless of which path ran.
// =============================================================================

import {
  CashtabConnect,
  CashtabTransactionDeniedError,
  CashtabTimeoutError,
} from 'cashtab-connect'

// A page-lifetime singleton — the extension messaging bus is global, and we
// never need to tear it down (destroy() only clears in-flight listeners).
let _connect: CashtabConnect | null = null
function getConnect(): CashtabConnect | null {
  if (typeof window === 'undefined') return null
  if (!_connect) _connect = new CashtabConnect()
  return _connect
}

/**
 * True only when the desktop Cashtab browser extension has injected itself.
 * Because only that extension sets window.bitcoinAbc, this doubles as the
 * "desktop-with-extension" gate — it can never be true on mobile.
 */
export function isCashtabExtensionAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window as unknown as { bitcoinAbc?: string }).bitcoinAbc === 'cashtab'
  )
}

export type CashtabResult =
  | { ok: true; via: 'extension'; txid?: string }
  | { ok: true; via: 'tab' }
  | { ok: false; via: 'extension'; reason: 'denied' | 'timeout' | 'error' }

// Map an extension rejection to a typed reason the caller can act on. Only
// 'denied' is an unambiguous "user said no" — on 'timeout'/'error' the tx may
// still broadcast (the 30s window is for the RESPONSE, not the approval), so
// callers should keep waiting and let their poll catch a late payment.
function classifyError(err: unknown): 'denied' | 'timeout' | 'error' {
  if (err instanceof CashtabTransactionDeniedError) return 'denied'
  if (err instanceof CashtabTimeoutError) return 'timeout'
  return 'error'
}

async function sendViaExtension(bip21: string): Promise<CashtabResult> {
  const connect = getConnect()
  // Shouldn't happen (we only get here when the extension is available), but if
  // the instance can't be created, fail as an error so the caller can recover.
  if (!connect) return { ok: false, via: 'extension', reason: 'error' }
  try {
    const res = await connect.sendBip21(bip21)
    return { ok: true, via: 'extension', txid: res?.txid }
  } catch (err) {
    return { ok: false, via: 'extension', reason: classifyError(err) }
  }
}

// -----------------------------------------------------------------------------
//  Message signing via the extension (cashtab-connect signMessage).
//  The Pocket derives its key from a signature over a fixed sentence; on the
//  desktop extension we get that signature through the SAME in-page approval
//  popup that drives payments — it returns in memory, never touching a tab, the
//  clipboard, or a URL. Requires an extension new enough to support signMessage;
//  anything older resolves to 'unsupported'/'timeout' so the caller can fall
//  back to the web sign flow.
// -----------------------------------------------------------------------------

export type SignMessageResult =
  | { ok: true; signature: string; address?: string }
  | {
      ok: false
      reason: 'unavailable' | 'unsupported' | 'denied' | 'timeout' | 'error'
    }

// cashtab-connect gained signMessage after the version we build against, so we
// feature-detect it rather than depend on the type. Shape mirrors the address/
// tx responses: resolves { signature, address } or throws a denied/timeout error.
type SignCapableConnect = {
  signMessage?: (
    message: string,
  ) => Promise<{ signature?: string; address?: string }>
}

function classifySignError(err: unknown): 'denied' | 'timeout' | 'error' {
  const name = (err as { name?: string } | null)?.name ?? ''
  if (
    name === 'CashtabSignatureDeniedError' ||
    err instanceof CashtabTransactionDeniedError
  ) {
    return 'denied'
  }
  if (err instanceof CashtabTimeoutError) return 'timeout'
  return 'error'
}

/**
 * Ask the Cashtab EXTENSION to sign a message via its in-page approval popup.
 * Only ever call after isCashtabExtensionAvailable(); on any non-success the
 * caller should fall back to the web sign flow (except 'denied', a deliberate
 * user no).
 */
export async function signMessageWithCashtabExtension(
  message: string,
): Promise<SignMessageResult> {
  if (!isCashtabExtensionAvailable()) return { ok: false, reason: 'unavailable' }
  const connect = getConnect() as (CashtabConnect & SignCapableConnect) | null
  if (!connect || typeof connect.signMessage !== 'function') {
    return { ok: false, reason: 'unsupported' }
  }
  try {
    const res = await connect.signMessage(message)
    if (res && typeof res.signature === 'string' && res.signature) {
      return { ok: true, signature: res.signature, address: res.address }
    }
    return { ok: false, reason: 'error' }
  } catch (err) {
    return { ok: false, reason: classifySignError(err) }
  }
}

function openTab(cashtabUrl: string): void {
  if (typeof window !== 'undefined' && cashtabUrl) {
    window.open(cashtabUrl, '_blank', 'noopener,noreferrer')
  }
}

// -----------------------------------------------------------------------------
//  Synchronous flows — the BIP21 is known at click time.
// -----------------------------------------------------------------------------

/**
 * Start a payment when the BIP21 is already known. Runs exactly ONE path:
 * the extension if present, otherwise a Cashtab web tab (identical to today).
 * Safe to fire-and-forget; the returned promise resolves once the extension
 * popup is answered so callers can reset their UI on an explicit denial.
 */
export async function payWithCashtab({
  bip21,
  cashtabUrl,
}: {
  bip21: string
  cashtabUrl: string
}): Promise<CashtabResult> {
  if (isCashtabExtensionAvailable()) {
    return sendViaExtension(bip21)
  }
  openTab(cashtabUrl)
  return { ok: true, via: 'tab' }
}

// -----------------------------------------------------------------------------
//  Async-prepare flows — the BIP21 arrives after a /prepare fetch. These decide
//  the path AT CLICK (so we never open a stray tab when the extension will
//  handle it), pre-opening a placeholder tab only on the web-wallet path to
//  survive popup blockers, then finishing once the BIP21 is in hand.
// -----------------------------------------------------------------------------

export type CashtabGesture = {
  hasExtension: boolean
  placeholderWindow: Window | null
}

/**
 * Call FIRST, synchronously inside the click handler, before any await.
 *  - extension present → opens nothing; the payment goes through the extension.
 *  - extension absent  → opens about:blank to survive popup blockers; the
 *    caller points it at the Cashtab URL once /prepare returns.
 */
export function beginCashtabPayment(): CashtabGesture {
  if (typeof window === 'undefined') {
    return { hasExtension: false, placeholderWindow: null }
  }
  if (isCashtabExtensionAvailable()) {
    return { hasExtension: true, placeholderWindow: null }
  }
  // No 'noopener' here — with it, window.open returns null and we'd lose the
  // handle; the opener link is severed manually instead (matches the existing
  // ComposeBox / EngagementBar / MintHandle popup-blocker workaround).
  const placeholderWindow = window.open('about:blank', '_blank')
  if (placeholderWindow) placeholderWindow.opener = null
  return { hasExtension: false, placeholderWindow }
}

/**
 * Finish a payment started with beginCashtabPayment(), once the BIP21 is known.
 * Runs exactly ONE path — never both.
 */
export async function completeCashtabPayment(
  gesture: CashtabGesture,
  { bip21, cashtabUrl }: { bip21: string; cashtabUrl: string },
): Promise<CashtabResult> {
  if (gesture.hasExtension) {
    return sendViaExtension(bip21)
  }
  if (gesture.placeholderWindow) {
    try {
      gesture.placeholderWindow.location.href = cashtabUrl
    } catch {
      /* the user closed the placeholder tab — nothing to point anywhere */
    }
    return { ok: true, via: 'tab' }
  }
  // Placeholder never opened (popup blocked) — last-ditch direct open.
  openTab(cashtabUrl)
  return { ok: true, via: 'tab' }
}

/**
 * Abandon a gesture whose /prepare failed: close the placeholder tab (no-op on
 * the extension path). Mirrors the existing `payWindow?.close()` cleanup.
 */
export function abortCashtabPayment(gesture: CashtabGesture): void {
  gesture.placeholderWindow?.close()
}
