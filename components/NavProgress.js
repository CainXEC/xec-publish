'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

// A thin top-of-page progress bar that appears the instant an internal link is
// clicked and completes once the new route commits. It exists because some pages
// (dashboard, author profiles) do real server work on navigation — Chronik reads
// + several DB queries — so there's a visible gap between the click and the new
// page rendering. Without feedback, users think the click did nothing. Next's
// App Router keeps the OLD page on screen during that gap (no loading.js here),
// so this bar is the "something is happening" signal.
//
// Start signal = the click itself (the URL doesn't change until the route is
// ready, so we can't wait for that). Completion = a pathname/search change, i.e.
// the new route actually committed. If a click never commits a route (a dropped
// soft navigation, a cancelled load, or a slow route that outran our patience),
// a safety timeout RESETS the bar — clears it quietly — rather than finishing it
// to 100%: a stall that produced no page shouldn't masquerade as a success.
//
// The window is sized to cover a slow, COLD render of the force-dynamic pages
// (the home feed can take a few seconds on a cold serverless start) while still
// clearing a genuinely dropped navigation promptly instead of riding a long dead
// timer. On a real-but-slow load that commits after this fires, the bar has
// already cleared, so the new page simply appears with no late 100% flash.
const STALL_TIMEOUT_MS = 8000

export default function NavProgress() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [visible, setVisible] = useState(false)
  const [progress, setProgress] = useState(0)
  const trickleRef = useRef(null)
  const safetyRef = useRef(null)
  const hideRef = useRef(null)

  const clearTimers = () => {
    if (trickleRef.current) clearInterval(trickleRef.current)
    if (safetyRef.current) clearTimeout(safetyRef.current)
    if (hideRef.current) clearTimeout(hideRef.current)
    trickleRef.current = safetyRef.current = hideRef.current = null
  }

  // Clear the bar WITHOUT the 100% fill — for a navigation that never committed.
  // Distinct from finish(): reset() says "nothing happened", finish() says "done".
  const reset = () => {
    clearTimers()
    setVisible(false)
    setProgress(0)
  }

  const start = () => {
    clearTimers()
    setVisible(true)
    setProgress(8)
    // Creep toward ~90% while we wait, slowing as it climbs — classic "trickle"
    // so the bar always looks alive but never reaches the end until the route
    // actually commits.
    trickleRef.current = setInterval(() => {
      setProgress((p) => (p >= 90 ? p : p + Math.max(0.4, (90 - p) * 0.08)))
    }, 200)
    // If the navigation never commits (dropped/cancelled load, same-page click),
    // reset — don't leave the bar hanging, and don't fake a completion.
    safetyRef.current = setTimeout(() => reset(), STALL_TIMEOUT_MS)
  }

  const finish = () => {
    clearTimers()
    setProgress(100)
    hideRef.current = setTimeout(() => {
      setVisible(false)
      setProgress(0)
    }, 260)
  }

  // Intercept clicks on internal links (capture phase, so we see it before the
  // router). Anything that wouldn't be a same-tab in-app navigation is ignored.
  useEffect(() => {
    const onClick = (e) => {
      if (e.defaultPrevented) return
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const anchor = e.target?.closest?.('a')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('#')) return
      if (anchor.target && anchor.target !== '_self') return
      if (anchor.hasAttribute('download')) return
      if ((anchor.getAttribute('rel') || '').includes('external')) return
      // Links that open IN PLACE (e.g. the home rail's reading pane) carry a
      // real href for new-tab clicks but preventDefault a plain click in their
      // own (bubble-phase) handler — which runs AFTER this capture listener, so
      // we can't see it. They opt out explicitly; without this the bar starts,
      // no route ever commits, and it crawls until the safety timeout.
      if (anchor.hasAttribute('data-no-navprogress')) return
      let url
      try {
        url = new URL(anchor.href, window.location.href)
      } catch {
        return
      }
      if (url.origin !== window.location.origin) return
      // Same URL (or hash-only jump) → no route change to wait for.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      start()
    }
    document.addEventListener('click', onClick, { capture: true })
    return () => document.removeEventListener('click', onClick, { capture: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The route committed — finish the bar. Runs on every pathname/search change.
  useEffect(() => {
    if (visible) finish()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams])

  useEffect(() => () => clearTimers(), [])

  if (!visible) return null

  return (
    <div className="navprogress" aria-hidden>
      <div
        className="navprogress-bar"
        style={{ width: `${progress}%`, opacity: progress >= 100 ? 0 : 1 }}
      />
    </div>
  )
}
