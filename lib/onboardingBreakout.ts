'use client'
// =============================================================================
//  onboardingBreakout.ts — escape an Android in-app WebView into real Chrome.
//
//  When POW is opened INSIDE another app's in-app browser (the X app, Facebook,
//  Instagram, …), the page runs in a bare Android WebView. That WebView can't
//  run the Cashtab web wallet reliably (no shared login session, popups/redirects
//  behave oddly), so onboarding is a dead end there. On Android we CAN hand the
//  page off to the real Chrome app via an `intent://` URL — landing the visitor
//  in a normal browser session with the onboarding modal already open.
//
//  iOS is deliberately untouched: an iOS WebView has no equivalent, reliable way
//  to force Safari, so there we keep the in-place modal (see the callers).
// =============================================================================

// The query flag that tells a freshly loaded page to pop the onboarding modal
// open on its own — the caller strips it back off the URL once consumed.
export const AUTO_OPEN_PARAM = 'getstarted'

function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
}

/**
 * True only for an Android WebView hosted inside ANOTHER app (X, Facebook,
 * Instagram, …) — not a real browser and not a Chrome Custom Tab. The ";wv"
 * token is the reliable WebView signal; the app-name tokens catch a few hosts
 * that omit it. Standalone Chrome and Custom Tabs (which ARE real Chrome) never
 * match, so they keep the normal in-place modal — no needless break-out.
 */
export function isAndroidInAppBrowser(): boolean {
  if (!isAndroid()) return false
  const ua = navigator.userAgent || ''
  if (/;\s*wv[)\s]/.test(ua)) return true
  return /(FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|Pinterest|Twitter)/i.test(ua)
}

/** The current URL, flagged so the target page auto-opens onboarding on load. */
function onboardingTargetUrl(): string {
  const target = new URL(window.location.href)
  // Drop any existing hash — the intent URL uses its own "#Intent" fragment, and
  // a page hash here would collide with it.
  target.hash = ''
  target.searchParams.set(AUTO_OPEN_PARAM, '1')
  return target.href
}

/**
 * A Chrome `intent://` URL for an https link: opens it in the Chrome app
 * specifically, falling back to the plain https URL (in whatever browser
 * resolves it) if Chrome isn't installed.
 */
function chromeIntentUrl(httpsUrl: string): string {
  const withoutScheme = httpsUrl.replace(/^https?:\/\//, '')
  return (
    `intent://${withoutScheme}#Intent;scheme=https;` +
    'package=com.android.chrome;' +
    `S.browser_fallback_url=${encodeURIComponent(httpsUrl)};end`
  )
}

/**
 * Hand the current page — flagged to auto-open onboarding — to the real Chrome
 * app. Only call after isAndroidInAppBrowser(). If Chrome opens, this WebView
 * goes to the background; if the host app swallows the intent, the caller's
 * fallback timer opens the modal in place instead.
 */
export function breakOutToChrome(): void {
  try {
    window.location.href = chromeIntentUrl(onboardingTargetUrl())
  } catch {
    /* couldn't build/navigate the intent — the caller falls back to the modal */
  }
}
