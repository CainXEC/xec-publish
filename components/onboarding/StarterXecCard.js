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
      <div className="starter-quill" aria-hidden>🪶</div>
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
          <h3 className="starter-h">You&rsquo;re in! Claim your starter XEC</h3>
          <p className="starter-p">
            You&rsquo;ve got enough XEC to look around — to post and react, get some free.
            Share your profile on X and tag <strong>@proofofwriting</strong>, and we&rsquo;ll
            send you starter XEC.
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
  display: flex; gap: 14px; align-items: flex-start;
  margin: 0 0 14px;
  padding: 16px 40px 16px 16px;
  background: color-mix(in srgb, var(--neon, #7CFF6B) 8%, var(--panel, #111));
  border: 1px solid color-mix(in srgb, var(--neon, #7CFF6B) 45%, var(--line, #333));
  border-radius: 12px;
}
.starter-x {
  position: absolute; top: 8px; right: 10px;
  background: none; border: none; cursor: pointer;
  font-size: 22px; line-height: 1; color: var(--dim, #888); padding: 2px 6px;
}
.starter-x:hover { color: var(--text, #fff); }
.starter-quill { font-size: 26px; line-height: 1.2; flex: 0 0 auto; }
.starter-body { flex: 1 1 auto; min-width: 0; }
.starter-h { margin: 0 0 5px; font-size: 15.5px; font-weight: 700; color: var(--text, #fff); }
.starter-p { margin: 0 0 12px; font-size: 13.5px; line-height: 1.5; color: var(--dim, #bbb); }
.starter-p strong { color: var(--text, #fff); }
.starter-btn {
  display: inline-block; cursor: pointer;
  font-size: 13.5px; font-weight: 600; font-family: inherit;
  padding: 8px 18px; border-radius: 999px;
  border: 1px solid var(--neon, #7CFF6B);
  background: var(--neon, #7CFF6B); color: var(--bg, #000);
}
.starter-btn:hover { filter: brightness(1.08); }
.starter-btn.ghost { background: transparent; color: var(--text, #fff); }
.starter-btn.ghost:hover { filter: none; border-color: var(--text, #fff); }
`
