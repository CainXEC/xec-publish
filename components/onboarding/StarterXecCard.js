'use client'

import { useCallback, useEffect, useState } from 'react'

// The pre-filled tweet. The profile link is appended so the founder knows which
// account to hand-tip. Kept here as the single source of the share copy.
const TWEET_TEXT = 'Just joined @proofofwriting — a new social network powered by eCash. My profile 🪶:'
const SHARED_KEY = 'pow_starter_shared'
const DISMISS_KEY = 'pow_starter_dismissed'

function readFlag(key) {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
function writeFlag(key) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(key, '1')
  } catch {
    /* best-effort */
  }
}

/**
 * "Claim starter XEC" card for a logged-in but unfunded new account (Piece 3).
 * Only rendered by the parent when the server says the account is brand-new (no
 * tip received, no post, no reaction) — so this component is display-only and
 * doesn't re-check funding. Clicking "Share on X" opens a pre-filled tweet that
 * carries their profile link + @proofofwriting; the founder sees it and tips them
 * by hand, at which point the server signal flips and the parent stops rendering
 * this on the next load.
 *
 * `profilePath` is the on-site profile path ("/@handle" or "/@<address>"); the
 * absolute URL is built at click time from the live origin.
 */
export default function StarterXecCard({ profilePath }) {
  const [shared, setShared] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  // Session flags decide the sub-state (shared → "on its way") and dismissal, so
  // the card doesn't nag within a session; a fresh load re-derives eligibility
  // server-side. Read after mount to avoid SSR/client mismatch.
  useEffect(() => {
    setShared(readFlag(SHARED_KEY))
    setDismissed(readFlag(DISMISS_KEY))
  }, [])

  const onShare = useCallback(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const url = profilePath ? `${origin}${profilePath}` : origin
    const text = `${TWEET_TEXT} ${url}`
    const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`
    if (typeof window !== 'undefined') window.open(intent, '_blank', 'noopener,noreferrer')
    writeFlag(SHARED_KEY)
    setShared(true)
  }, [profilePath])

  const onDismiss = useCallback(() => {
    writeFlag(DISMISS_KEY)
    setDismissed(true)
  }, [])

  if (dismissed) return null

  return (
    <div className="starter-card" id="starter-xec">
      <style>{STARTER_CSS}</style>
      <button type="button" className="starter-x" onClick={onDismiss} aria-label="Dismiss">×</button>
      {shared ? (
        <div className="starter-body">
          <h3 className="starter-h">Starter XEC is on its way</h3>
          <p className="starter-p">
            Thanks for posting! We&rsquo;ll send your XEC shortly — keep an eye on your
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
  position: relative;
  text-align: center;
  margin: 0 0 14px;
  /* symmetric side padding so the centered copy/button are truly centered, and
     wide enough on the right to clear the absolute dismiss × */
  padding: 16px 40px;
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
.starter-x {
  position: absolute; top: 8px; right: 10px;
  background: none; border: none; cursor: pointer;
  font-size: 22px; line-height: 1; color: var(--dim, #888); padding: 2px 6px;
}
.starter-x:hover { color: var(--text, #fff); }
.starter-body { flex: 1 1 auto; min-width: 0; }
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
