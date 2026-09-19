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
 * Next rewrites `document.title` from page metadata on every client navigation,
 * which would wipe the prefix — so a MutationObserver on the <title> element
 * re-applies it. The re-apply only writes when the title actually differs, so
 * it settles in one extra tick and never loops.
 */
export function useTitleNotificationBadge(count) {
  useEffect(() => {
    if (typeof document === 'undefined') return
    const titleEl = document.querySelector('title')
    if (!titleEl) return

    const label = count > 99 ? '99+' : String(count)
    const apply = () => {
      const base = document.title.replace(BADGE_PREFIX_RE, '')
      const desired = count > 0 ? `(${label}) ${base}` : base
      if (document.title !== desired) document.title = desired
    }

    apply()
    const observer = new MutationObserver(apply)
    observer.observe(titleEl, { childList: true })
    return () => {
      observer.disconnect()
      // Leave the tab title clean if this unmounts (e.g. sign-out).
      document.title = document.title.replace(BADGE_PREFIX_RE, '')
    }
  }, [count])
}
