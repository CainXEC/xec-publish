'use client'

import GetStartedButton from '@/components/onboarding/GetStartedModal'

/**
 * A slim strip above the feed for logged-out visitors (Piece 1), pointing them at
 * the "Get started" explainer. Intentionally NOT dismissible: onboarding is the
 * whole point for someone who hasn't logged in, so it stays until they do — the
 * parent only renders it while signed out, so logging in makes it disappear on
 * its own.
 */
export default function OnboardingStrip() {
  return (
    <div className="onboard-strip">
      <style>{STRIP_CSS}</style>
      <span className="onboard-strip-text">
        New to Proof of Writing? It runs on eCash — get started free in 3 steps.
      </span>
      <GetStartedButton className="onboard-strip-btn">Get started</GetStartedButton>
    </div>
  )
}

const STRIP_CSS = `
.onboard-strip {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin: 0 0 14px;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--neon, #7CFF6B) 7%, var(--panel, #111));
  border: 1px solid color-mix(in srgb, var(--neon, #7CFF6B) 35%, var(--line, #333));
  border-radius: 10px;
}
/* On a phone the composer is hidden, so the strip sits between the sticky header
   and the Feed/Forums tabs. Give it breathing room above (it was flush to the
   header) by moving half the space that sat below it up top — balanced. */
@media (max-width: 1099px) {
  .onboard-strip { margin: 7px 0; }
}
.onboard-strip-text { flex: 1 1 auto; min-width: 0; font-size: 13.5px; line-height: 1.4; color: var(--text, #fff); }
/* Rectangular, neon-outlined — matches the site's newposts / forum buttons. */
.onboard-strip-btn {
  flex: 0 0 auto; cursor: pointer;
  font: inherit; font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  padding: 8px 16px; border-radius: 8px;
  border: 1px solid var(--neon, #7CFF6B);
  background: transparent; color: var(--neon, #7CFF6B);
  transition: box-shadow .15s, color .15s;
}
.onboard-strip-btn:hover { box-shadow: 0 0 12px rgba(0,255,156,.25); }
`
