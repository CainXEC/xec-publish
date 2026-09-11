'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

// Remembers each path's scroll position for the tab's session, so a BACK
// navigation (e.g. returning from a feed post you tapped into) can restore it
// — the mobile equivalent of desktop's reading pane, which never navigates
// away from the feed at all and so never loses its scroll position. A forward
// navigation (a normal link click) is unaffected — it still always starts at
// the top, same as before.
const STORAGE_KEY = 'pow:scrollPositions'

function readPositions() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

function savePosition(pathname, y) {
  try {
    const map = readPositions()
    map[pathname] = y
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* sessionStorage can throw in a private/locked-down context — best-effort */
  }
}

// Two ways a navigation can mean "take me back to where I was": a real
// browser back/forward (a native 'popstate'), or an explicit in-page control
// with no pane to just close (a mobile thread page's "← Feed") that instead
// does a normal router.push and calls requestScrollRestoreOnNextNav first.
// Both are recorded as a TIMESTAMP in sessionStorage, not a one-shot
// "consume" flag — isRestoreNavigation() is a non-destructive peek so more
// than one component can independently check the same navigation (this one
// for scroll, FeedClient for its cached "Load more" pages) without a fragile
// dependency on which of their effects happens to run first. The short
// window is just long enough to outlast this navigation's mount + retries,
// short enough that a deliberate click right after a back-nav isn't
// mistaken for another restore.
const RESTORE_SIGNAL_WINDOW_MS = 1500
const POP_NAV_KEY = 'pow:lastPopNavAt'
const FORCE_RESTORE_KEY = 'pow:forceRestoreScrollAt'

function markTimestamp(key) {
  try {
    sessionStorage.setItem(key, String(Date.now()))
  } catch {
    /* best-effort — worst case this navigation just isn't treated as a restore */
  }
}

function isRecent(key) {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return false
    const ts = Number(raw)
    return Number.isFinite(ts) && Date.now() - ts < RESTORE_SIGNAL_WINDOW_MS
  } catch {
    return false
  }
}

/** True when the CURRENT navigation is a "return to where I was" one. Peek,
 *  not consume — safe to call from any number of components. */
export function isRestoreNavigation() {
  return isRecent(POP_NAV_KEY) || isRecent(FORCE_RESTORE_KEY)
}

export function requestScrollRestoreOnNextNav() {
  markTimestamp(FORCE_RESTORE_KEY)
}

export default function ScrollToTopOnRouteChange() {
  const pathname = usePathname()

  useEffect(() => {
    if (typeof window === 'undefined') return
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual'
    }
    // pushState-based navigation (router.push, a <Link> click) never fires
    // 'popstate' — only a real browser back/forward does — so this reliably
    // tells the two apart.
    const onPopState = () => markTimestamp(POP_NAV_KEY)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // Continuously remember this page's scroll position (debounced to the last
  // tick, not every frame) so it's there to restore WHENEVER the reader later
  // navigates back to it — captured while still on the page, since by the time
  // a route change actually fires there's nothing reliable left to read.
  useEffect(() => {
    if (typeof window === 'undefined') return
    let t = null
    const onScroll = () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        savePosition(pathname, window.scrollY || window.pageYOffset || 0)
      }, 120)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (t) clearTimeout(t)
    }
  }, [pathname])

  useEffect(() => {
    if (typeof window === 'undefined') return

    // The marketplace, on a holder deep-link (?holder=), scrolls ITSELF down to
    // that holder's handles (MarketplaceShell). Don't fight it — a blanket
    // scroll-to-top, with its retry timeouts, would yank the viewport back to the
    // mint hero right after the auto-scroll landed. Read the query here (not via
    // useSearchParams as a dep) so a marketplace FILTER change on the same path
    // doesn't newly trigger a scroll-to-top.
    if (
      pathname === '/marketplace' &&
      new URLSearchParams(window.location.search).get('holder')
    ) {
      return
    }

    // A URL hash (e.g. a notification's #comment-<txid> or #post-<txid> deep
    // link, or the comments section's own #comments) means something on the
    // page wants to scroll there itself — don't yank the viewport back to top
    // out from under it.
    if (window.location.hash) return

    if (isRestoreNavigation()) {
      const saved = readPositions()[pathname]
      if (typeof saved === 'number') {
        const restore = () => window.scrollTo({ top: saved, left: 0, behavior: 'instant' })
        restore()
        // Same retry rationale as the scroll-to-top path below: the App Router
        // can adjust scroll a beat after the route commits.
        const timeouts = [50, 150, 400].map((delay) => setTimeout(restore, delay))
        return () => timeouts.forEach(clearTimeout)
      }
      // No remembered position for this path (e.g. the very first visit to it
      // this session) — fall through to the normal scroll-to-top below.
    }

    const scrollAllTargets = () => {
      const y = window.scrollY || window.pageYOffset || 0
      if (y > 0) {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
        document.documentElement.scrollTop = 0
        document.body.scrollTop = 0
      }
    }

    scrollAllTargets()
    // Retry: the App Router can restore/adjust scroll a beat after the route
    // commits, so re-assert top a few times.
    const timeouts = [50, 150, 400].map((delay) => setTimeout(scrollAllTargets, delay))

    return () => timeouts.forEach(clearTimeout)
  }, [pathname])

  return null
}
