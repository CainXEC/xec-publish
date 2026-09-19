'use client'

import { useEffect } from 'react'

// Matches a leading "(N) " / "(99+) " badge we previously prepended, so we can
// strip it before recomputing — and never stack badges.
const BADGE_PREFIX_RE = /^\(\d+\+?\)\s+/

/**
 * X-style browser-tab badge: while `count` > 0, prefix the tab title with
 * "(N)" (or "(99+)") so unread notifications are visible even when the tab is
 * in the background. When it drops to 0, the plain title is restored.
 *
 * Robustness: Next rewrites the title on every client navigation — and often
 * REPLACES the whole <title> element, not just its text — which would orphan a
 * node reference and drop the badge (the "move around / switch to the tab and
 * it's gone" bug). So we (a) always read/write `document.title` (its setter
 * targets the live <title>, whichever element that is), (b) re-apply on any
 * <head> mutation via a subtree observer that catches both text changes and a
 * full element swap, and (c) re-assert on focus/visibility as a backstop. The
 * re-apply only writes when the title actually differs, so it settles in one
 * tick and never loops.
 */
export function useTitleNotificationBadge(count) {
  useEffect(() => {
    if (typeof document === 'undefined') return
    const label = count > 99 ? '99+' : String(count)

    const apply = () => {
      const base = document.title.replace(BADGE_PREFIX_RE, '')
      const desired = count > 0 ? `(${label}) ${base}` : base
      if (document.title !== desired) document.title = desired
    }

    apply()

    // Catch Next's title rewrites (text change OR whole-element replacement).
    const head = document.head
    const observer = head ? new MutationObserver(apply) : null
    observer?.observe(head, { childList: true, subtree: true, characterData: true })

    // Backstop for the reported "switch to the tab and the (N) is gone" case:
    // re-assert if a reset ever slipped past the observer.
    const reassert = () => apply()
    window.addEventListener('focus', reassert)
    document.addEventListener('visibilitychange', reassert)

    return () => {
      observer?.disconnect()
      window.removeEventListener('focus', reassert)
      document.removeEventListener('visibilitychange', reassert)
      // Leave the tab title clean if this unmounts (e.g. sign-out).
      document.title = document.title.replace(BADGE_PREFIX_RE, '')
    }
  }, [count])
}
