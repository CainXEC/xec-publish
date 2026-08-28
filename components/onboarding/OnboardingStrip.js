'use client'

import { useEffect, useState } from 'react'
import GetStartedButton from '@/components/onboarding/GetStartedModal'

const DISMISS_KEY = 'pow_onboard_strip_dismissed'

/**
 * A slim, dismissible strip above the feed for logged-out visitors (Piece 1),
 * pointing them at the "Get started" explainer. Dismissal is remembered
 * per-browser (localStorage) so it doesn't nag on repeat visits — the "Get
 * started" nav button is always there for anyone who dismissed it. The parent
 * only renders this when signed out.
 */
export default function OnboardingStrip() {
  // Start hidden until we've read the dismissal flag, so a returning visitor who
  // already dismissed it never sees a flash of the strip.
  const [ready, setReady] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === '1')
    } catch {
      /* storage disabled — just show it */
    }
    setReady(true)
  }, [])

  const onDismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* best-effort */
    }
    setDismissed(true)
  }

  if (!ready || dismissed) return null

  return (
    <div className="onboard-strip">
      <style>{STRIP_CSS}</style>
      <span className="onboard-strip-text">
        New to Proof of Writing? It runs on eCash — get started free in 3 steps.
      </span>
      <GetStartedButton className="onboard-strip-btn">Get started</GetStartedButton>
      <button type="button" className="onboard-strip-x" onClick={onDismiss} aria-label="Dismiss">×</button>
    </div>
  )
}

const STRIP_CSS = `
.onboard-strip {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin: 0 0 14px;
  padding: 10px 14px;
  background: color-mix(in srgb, var(--neon, #7CFF6B) 7%, var(--panel, #111));
  border: 1px solid color-mix(in srgb, var(--neon, #7CFF6B) 35%, var(--line, #333));
  border-radius: 10px;
}
.onboard-strip-text { flex: 1 1 auto; min-width: 0; font-size: 13.5px; line-height: 1.4; color: var(--text, #fff); }
.onboard-strip-btn {
  flex: 0 0 auto; cursor: pointer;
  font-size: 13px; font-weight: 600; font-family: inherit;
  padding: 6px 14px; border-radius: 999px;
  border: 1px solid var(--neon, #7CFF6B);
  background: var(--neon, #7CFF6B); color: var(--bg, #000);
}
.onboard-strip-btn:hover { filter: brightness(1.08); }
.onboard-strip-x {
  flex: 0 0 auto;
  background: none; border: none; cursor: pointer;
  font-size: 20px; line-height: 1; color: var(--dim, #888); padding: 2px 4px;
}
.onboard-strip-x:hover { color: var(--text, #fff); }
`
