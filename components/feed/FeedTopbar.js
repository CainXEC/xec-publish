'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import FeedNotifications from '@/components/feed/FeedNotifications'
import ThemeToggle from '@/components/ThemeToggle'

/**
 * The shared feed-theme header, used by every neon page (feed, thread, profile,
 * articles). Responsive by CSS:
 *  - Desktop: wordmark on the left; text nav links + bell + theme toggle on the right.
 *  - Mobile (≤600px): a hamburger on the left holds the nav links (log in /
 *    dashboard / marketplace), the wordmark is centered, and the bell + theme
 *    toggle stay pinned top-right.
 * The same link set feeds both the desktop row and the mobile menu, so they never
 * drift apart. `signedIn` drives whether "log in" shows; `isAuthor` gates the
 * dashboard link. Log out lives on the dashboard, not here.
 */
export default function FeedTopbar({ signedIn = false, isAuthor = false }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  // Close the hamburger menu on any outside click.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  // One link set, rendered twice: `cls` styles them as desktop pills ('toplink')
  // or mobile menu rows ('hammenu-item'). Both close the menu on click.
  const renderLinks = (cls) => (
    <>
      {isAuthor ? (
        <Link href="/dashboard" className={cls} onClick={() => setOpen(false)}>
          dashboard
        </Link>
      ) : null}
      {!signedIn && !isAuthor ? (
        <Link href="/login" className={cls} onClick={() => setOpen(false)}>
          log in
        </Link>
      ) : null}
      <Link href="/marketplace" className={cls} onClick={() => setOpen(false)}>
        marketplace
      </Link>
    </>
  )

  return (
    <div className="topbar">
      {/* Hamburger — visible only on mobile (CSS), holds the nav links. */}
      <div className="topnav" ref={rootRef}>
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
        {open ? (
          <div className="hammenu" role="menu">
            {renderLinks('hammenu-item')}
          </div>
        ) : null}
      </div>

      <Link href="/" className="wordmark">
        proofofwriting
      </Link>

      <div className="toplinks">
        {/* Text links — hidden on mobile (CSS), where they live in the hamburger. */}
        <span className="toplinks-text">{renderLinks('toplink')}</span>
        <FeedNotifications signedIn={signedIn} />
        <ThemeToggle variant="feed" />
      </div>
    </div>
  )
}
