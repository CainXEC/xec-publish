'use client'

import GetStartedButton from '@/components/onboarding/GetStartedModal'

/**
 * A slim strip above the feed for logged-out visitors (Piece 1), pointing them at
 * the "Get started" explainer. Intentionally NOT dismissible: onboarding is the
 * whole point for someone who hasn't logged in, so it stays until they do — the
 * parent only renders it while signed out, so logging in makes it disappear on
 * its own.
 *
 * `offer` is the server's faucetOffer() (lib/faucetConfig.ts): the welcome gift
 * is only promised while it's switched on. Handed to the modal so it doesn't
 * have to ask again.
 */
export default function OnboardingStrip({ offer = null }) {
  const gift = offer?.open
    ? `Get ${Number(offer.xec).toLocaleString('en-US')} XEC + ${Number(offer.pow).toLocaleString('en-US')} POW free — start in 3 steps.`
    : 'Get set up in 2 steps.'
  return (
    <div className="onboard-strip">
      <style>{STRIP_CSS}</style>
      <span className="onboard-strip-text">New to Proof of Writing? {gift}</span>
      <GetStartedButton className="onboard-strip-btn" offer={offer ?? { open: false }}>
        Get started
      </GetStartedButton>
    </div>
  )
}

const STRIP_CSS = `
.onboard-strip {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  text-align: center;
  margin: 0 0 14px;
  padding: 14px;
  background: color-mix(in srgb, var(--neon, #7CFF6B) 7%, var(--panel, #111));
  border: 1px solid color-mix(in srgb, var(--neon, #7CFF6B) 35%, var(--line, #333));
  border-radius: 10px;
}
/* On a phone the composer is hidden, so the strip sits between the sticky header
   and the Feed/Forums tabs — and the tabs contribute ~12px of their own top
   padding below the banner. So equal MARGINS read lopsided (tight above, loose
   below). Put the gap above the banner and none below; the tabs' padding is the
   matching gap, so it sits evenly between the header and the Feed/Forums labels. */
@media (max-width: 1099px) {
  .onboard-strip { margin: 12px 0 0; }
}
.onboard-strip-text { font-size: 13.5px; line-height: 1.4; color: var(--text, #fff); }
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
