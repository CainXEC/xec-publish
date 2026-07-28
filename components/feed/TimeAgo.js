'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

/**
 * Relative "34m"/"2h"/"5d" label, falling back to an absolute short date past a
 * week. Pure function of `iso` + the current wall clock — which is exactly why
 * rendering it directly during SSR breaks hydration: the For You feed is served
 * from a 30s `unstable_cache`, so the server HTML carries a label computed when
 * the cache entry was written, while the client hydrates against `Date.now()`.
 * "34m" vs "37m" → `Text content did not match`. Use the <TimeAgo> component
 * below, never this bare function, in anything that renders on the server.
 */
export function relativeTime(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * A relative timestamp that survives hydration and stays live.
 *
 * `suppressHydrationWarning` tells React to accept the server-rendered text as-is
 * during hydration — no mismatch error, no flash — even though this render's
 * client-clock value may differ. The mount effect then bumps a tick so the label
 * reconciles to the real current time, and a 60s interval keeps it ticking while
 * the row is on screen.
 *
 * Renders a <Link> to `href` when given (the feed's clickable timestamp), else a
 * plain <span>. Extra props (className, title, …) pass straight through. Pass a
 * `format` function to override the label shape (e.g. the profile rail's
 * "34m ago" phrasing) while keeping the same hydration-safe, self-ticking guts.
 */
export default function TimeAgo({ iso, href, format = relativeTime, ...rest }) {
  // Bumped once after mount to recompute with the client clock, then every 60s.
  const [, setTick] = useState(0)
  useEffect(() => {
    setTick((t) => t + 1)
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const label = format(iso)
  if (href) {
    return (
      <Link href={href} suppressHydrationWarning {...rest}>
        {label}
      </Link>
    )
  }
  return (
    <span suppressHydrationWarning {...rest}>
      {label}
    </span>
  )
}
