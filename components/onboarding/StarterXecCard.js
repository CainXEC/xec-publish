'use client'

import { useCallback, useState } from 'react'

// The pre-filled tweet. The profile link is appended so the founder knows which
// account to hand-tip. Kept here as the single source of the share copy.
const TWEET_TEXT = 'Just joined @proofofwriting — a new social network powered by eCash. My profile 🪶:'

/**
 * "Claim starter XEC" card for a logged-in but unfunded new account (Piece 3).
 * Only rendered by the parent when the server says the account is brand-new (no
 * tip received, no post, no reaction), so it's purely SERVER-driven: it shows
 * until the account is funded (the manual welcome tip flips the signal) and there
 * is no dismiss — onboarding stays until it's done, matching the get-started
 * strip. `shared` is IN-MEMORY only (no sessionStorage): a persisted flag used to
 * survive the new-wallet login and hide/mis-state the card (it flashed, then
 * vanished), so this state resets cleanly on every load.
 *
 * `profilePath` is the on-site profile path ("/@handle" or "/@<address>"); the
 * absolute URL is built at click time from the live origin.
 */
export default function StarterXecCard({ profilePath }) {
  const [shared, setShared] = useState(false)

  const onShare = useCallback(() => {
    if (typeof window === 'undefined') return
    const origin = window.location.origin
    const url = profilePath ? `${origin}${profilePath}` : origin
    const text = `${TWEET_TEXT} ${url}`
    const web = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`

    const isMobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent || '')
    if (isMobile) {
      // Prefer the native X app: its twitter:// scheme opens the composer
      // pre-filled. If the app isn't installed nothing handles the scheme, so
      // after a beat — and only if we're still here (the app didn't take over and
      // hide the tab) — fall back to the web composer.
      window.location.href = `twitter://post?message=${encodeURIComponent(text)}`
      setTimeout(() => {
        if (document.visibilityState === 'visible') window.location.href = web
      }, 800)
    } else {
      window.open(web, '_blank', 'noopener,noreferrer')
    }
    setShared(true)
  }, [profilePath])

  return (
    <div className="starter-card" id="starter-xec">
      <style>{STARTER_CSS}</style>
      {shared ? (
        <div className="starter-body">
          <h3 className="starter-h">Starter XEC is on its way</h3>
          <p className="starter-p">
            Thanks for sharing! We&rsquo;ll send your XEC shortly — keep an eye on your
            notifications. Once it lands you can post, react, and unlock stories.
          </p>
          <button type="button" className="starter-btn ghost" onClick={onShare}>
            Share again
          </button>
        </div>
      ) : (
        <div className="starter-body">
          <p className="starter-p">
            Tag <strong>@proofofwriting</strong> on X to receive enough free XEC to post,
            react, unlock content, and more!
          </p>
          <button type="button" className="starter-btn" onClick={onShare}>
            Share on X
          </button>
        </div>
      )}
    </div>
  )
}

const STARTER_CSS = `
.starter-card {
  text-align: center;
  margin: 0 0 14px;
  padding: 16px 24px;
  background: color-mix(in srgb, var(--neon, #7CFF6B) 8%, var(--panel, #111));
  border: 1px solid color-mix(in srgb, var(--neon, #7CFF6B) 45%, var(--line, #333));
  border-radius: 12px;
}
/* Phone: composer hidden, so the card sits between the sticky header and the
   tabs — balance its spacing the same way the get-started strip is (gap above,
   the tabs' own padding is the matching gap below). */
@media (max-width: 1099px) {
  .starter-card { margin: 12px 0 0; }
}
.starter-body { min-width: 0; }
.starter-h { margin: 0 0 5px; font-size: 15.5px; font-weight: 700; color: var(--text, #fff); }
.starter-p { margin: 0 0 12px; font-size: 13.5px; line-height: 1.5; color: var(--dim, #bbb); }
.starter-p strong { color: var(--text, #fff); }
/* Rectangular, neon-outlined — matches the site's newposts / forum buttons. */
.starter-btn {
  display: inline-block; cursor: pointer;
  font: inherit; font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  padding: 9px 18px; border-radius: 8px;
  border: 1px solid var(--neon, #7CFF6B);
  background: transparent; color: var(--neon, #7CFF6B);
  transition: box-shadow .15s, color .15s;
}
.starter-btn:hover { box-shadow: 0 0 12px rgba(0,255,156,.25); }
.starter-btn.ghost { border-color: var(--line, #444); color: var(--dim, #aaa); }
.starter-btn.ghost:hover { box-shadow: none; border-color: var(--neon, #7CFF6B); color: var(--neon, #7CFF6B); }
`
