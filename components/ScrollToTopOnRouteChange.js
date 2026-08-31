'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

export default function ScrollToTopOnRouteChange() {
  const pathname = usePathname()

  useEffect(() => {
    if (typeof window === 'undefined') return
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual'
    }
  }, [])

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
