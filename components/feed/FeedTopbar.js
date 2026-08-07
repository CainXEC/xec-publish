'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import FeedNotifications from '@/components/feed/FeedNotifications'
import PocketChip from '@/components/pocket/PocketChip'
import ThemeToggle from '@/components/ThemeToggle'
import AnimatedLogo from '@/components/AnimatedLogo'

/**
 * The shared feed-theme header, used by every neon page (feed, thread, profile,
 * articles). One layout at every width (CSS grid): a hamburger on the left holds
 * the nav links (log in / dashboard / marketplace / log out), the wordmark is
 * centered, and the notification bell + theme toggle sit on the right.
 * The same link set feeds both the (now hidden) inline row and the hamburger menu,
 * so they never drift apart. `signedIn` drives whether "log in" shows; `isAuthor` gates the
 * dashboard link. `showLogout` adds a "log out" action (used on the dashboard and
 * its sub-pages, where log out belongs); it clears the session and returns home.
 */
export default function FeedTopbar({
  signedIn = false,
  isAuthor = false,
  showLogout = false,
  showMarketplace = true,
  // Keep marketplace out of the desktop link row (to de-clutter a busy header)
  // but leave it in the mobile hamburger menu.
  marketplaceMobileOnly = false,
  showDashboard = true,
}) {
  const [open, setOpen] = useState(false)
  // null = not an admin session; a number = the AI_SATOSHI review-queue count,
  // reported up by the bell's poll (one fetch serves both surfaces). Drives
  // the admin-only "agent" item in the hamburger — desktop-only for free,
  // since the hamburger doesn't render below 1100px (the bottom bar takes over).
  const [agentPending, setAgentPending] = useState(null)
  const rootRef = useRef(null)
  const router = useRouter()
  const pathname = usePathname()

  // The wordmark links home. If you're ALREADY home, a Link to the same route
  // is a no-op — so intercept and hard-refresh the feed instead.
  const onWordmarkClick = useCallback(
    (e) => {
      setOpen(false)
      if (pathname === '/') {
        e.preventDefault()
        window.location.reload()
      }
    },
    [pathname],
  )

  // Close the hamburger menu on any outside click.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const handleLogout = useCallback(async () => {
    setOpen(false)
    try {
      await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' })
    } catch {
      /* ignore */
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sessionChanged'))
    }
    router.push('/')
  }, [router])

  // One link set, rendered twice: `cls` styles them as desktop pills ('toplink')
  // or mobile menu rows ('hammenu-item'). Both close the menu on click.
  const renderLinks = (cls, mobile = false) => (
    <>
      {/* Desktop entry point for search (the hamburger only renders >=1100px);
          mobile uses the tb-search icon in the bar instead. */}
      <Link href="/search" className={cls} onClick={() => setOpen(false)}>
        search
      </Link>
      {signedIn && showDashboard ? (
        <Link href="/dashboard" className={cls} onClick={() => setOpen(false)}>
          dashboard
        </Link>
      ) : null}
      {!signedIn && !isAuthor ? (
        <Link href="/login" className={cls} onClick={() => setOpen(false)}>
          log in
        </Link>
      ) : null}
      {showMarketplace && (mobile || !marketplaceMobileOnly) ? (
        <Link href="/marketplace" className={cls} onClick={() => setOpen(false)}>
          marketplace
        </Link>
      ) : null}
      {showLogout ? (
        <button type="button" className={cls} onClick={() => void handleLogout()}>
          log out
        </button>
      ) : null}
      {/* Admin-only, and last: a rarely-used house utility shouldn't sit above
          the links everyone actually came for. Renders only when the pending
          count resolves, which is admin sessions only. */}
      {agentPending != null ? (
        <Link href="/admin/agent" className={cls} onClick={() => setOpen(false)}>
          agent{agentPending > 0 ? ` · ${agentPending}` : ''}
        </Link>
      ) : null}
    </>
  )

  return (
    <div className="topbar">
      {/* Hamburger holds the nav links at every width. The menu is always in the
          DOM so CSS can reveal it on hover for pointer devices (see feedTheme
          `.topnav:hover`); the click toggles an `open` class that pins it open
          (and is the sole path on touch, where there's no hover). */}
      <div className={`topnav${open ? ' open' : ''}`} ref={rootRef}>
        <button
          type="button"
          className="hamburger"
          onClick={() => setOpen((s) => !s)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Menu"
        >
          <span className="hamicon" aria-hidden>
            ☰
          </span>
        </button>
        <div className="hammenu" role="menu">
          {renderLinks('hammenu-item', true)}
        </div>
      </div>

      {/* Desktop-only text label next to the hamburger: the wordmark already
          links home, but as an icon-only mark it doesn't read as "back to the
          feed" — people land on the dashboard/profile and don't realize this
          is the way back. Mobile already has a labeled "Feed" tab in the
          bottom nav, so this is hidden there (CSS) rather than duplicating it. */}
      <Link href="/" className="tb-feedlink" onClick={onWordmarkClick}>
        Feed
      </Link>

      {/* Pocket chip — a standalone topbar item placed on the LEFT by CSS order
          (right of the hamburger on desktop; right of the bell on mobile, where
          the hamburger is gone). Self-fetching; renders null when signed out or
          the pocket flag is off, so it never leaves an empty slot. */}
      <PocketChip />

      {/* The bell is its own flex item so CSS can place it: on the right at
          desktop, on the LEFT on mobile — the slot the hamburger vacates, where
          the bottom bar takes over navigation. One instance either way (never
          double-mounted → never double-polls). */}
      <div className="tb-bell">
        <FeedNotifications signedIn={signedIn} onAgentPending={setAgentPending} />
      </div>

      <Link href="/" className="wordmark" onClick={onWordmarkClick} aria-label="Proof of Writing — home">
        <AnimatedLogo />
      </Link>

      <div className="toplinks">
        {/* Text links — hidden on mobile (CSS), where they live in the hamburger. */}
        <span className="toplinks-text">{renderLinks('toplink')}</span>
        {/* Mobile search entry: an icon left of the theme toggle. Hidden on
            desktop (>=1100px, CSS .tb-search), where search lives in the
            hamburger menu instead — the bottom bar doesn't carry it either. */}
        <Link href="/search" className="toplink toplink-toggle tb-search" aria-label="Search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="11" cy="11" r="6.5" />
            <path d="M15.8 15.8L21 21" />
          </svg>
        </Link>
        <ThemeToggle variant="feed" />
      </div>
    </div>
  )
}
