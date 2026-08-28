'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { armLoginLaunch } from '@/lib/ecash/loginLaunch'

// The free Cashtab WEB wallet (no extension, no app) — new wallets can claim
// 42 XEC free, enough to cover the 6-XEC login challenge.
const CASHTAB_URL = 'https://cashtab.com'

/**
 * The three-step onboarding explainer for a walletless visitor, shown in a modal
 * so they never leave the page. Controlled: `open` + `onClose`. Pieces 1–2 of the
 * onboarding plan (get a wallet → log in → get starter XEC).
 */
export function GetStartedModal({ open, onClose }) {
  const router = useRouter()

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const onLogin = useCallback(() => {
    // Same gesture the topbar uses: pre-open the Cashtab window inside the tap
    // (iOS Safari), then navigate to /login which points it at the challenge.
    armLoginLaunch()
    onClose?.()
    router.push('/login')
  }, [onClose, router])

  if (!open) return null

  return (
    <div className="ob-overlay" role="dialog" aria-modal="true" aria-label="Get started" onClick={onClose}>
      <style>{OB_MODAL_CSS}</style>
      <div className="ob-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ob-x" onClick={onClose} aria-label="Close">×</button>
        <h2 className="ob-title">Get started free</h2>

        <ol className="ob-steps">
          <li className="ob-step">
            <span className="ob-num" aria-hidden>1</span>
            <div className="ob-body">
              <h3 className="ob-h">Create your eCash wallet</h3>
              <p className="ob-p">
                Cashtab is your key to this platform. It&rsquo;s an open source web wallet and
                new users can claim <strong>42 XEC free</strong>. Claim your free XEC, save your
                seed phrase, then come back to this page.
              </p>
              <a className="ob-btn" href={CASHTAB_URL} target="_blank" rel="noopener noreferrer">
                Get Cashtab →
              </a>
            </div>
          </li>

          <li className="ob-step">
            <span className="ob-num" aria-hidden>2</span>
            <div className="ob-body">
              <h3 className="ob-h">Log in</h3>
              <p className="ob-p">One tiny 6-XEC payment logs you in. That&rsquo;s it!</p>
              <button type="button" className="ob-btn" onClick={onLogin}>
                Log in
              </button>
            </div>
          </li>

          <li className="ob-step">
            <span className="ob-num" aria-hidden>3</span>
            <div className="ob-body">
              <h3 className="ob-h">Get XEC</h3>
              <p className="ob-p">
                Once you&rsquo;re in, click on the Share on X button and we&rsquo;ll send you
                enough XEC to start posting.
              </p>
            </div>
          </li>
        </ol>
      </div>
    </div>
  )
}

/**
 * A self-contained "Get started" trigger: renders a button (styled by the caller
 * via `className`) that opens the explainer modal. Used in the topbar and the
 * logged-out feed strip — each instance owns its modal state, so only the one
 * that was clicked is open.
 */
export default function GetStartedButton({ className = '', children = 'Get started', onClick }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          onClick?.() // let a caller close its own menu first
          setOpen(true)
        }}
      >
        {children}
      </button>
      <GetStartedModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}

const OB_MODAL_CSS = `
.ob-overlay {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
  background: color-mix(in srgb, var(--bg, #000) 78%, transparent);
  backdrop-filter: blur(3px);
}
.ob-modal {
  position: relative;
  width: 100%; max-width: 460px;
  max-height: calc(100vh - 40px); overflow-y: auto;
  /* Left-justified regardless of where the modal is mounted — it's a DOM child of
     the get-started button, which may sit inside a centered strip. */
  text-align: left;
  background: var(--panel, #111);
  border: 1px solid var(--line, #333);
  border-radius: 14px;
  padding: 26px 24px 24px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.45);
}
.ob-x {
  position: absolute; top: 10px; right: 12px;
  background: none; border: none; cursor: pointer;
  font-size: 26px; line-height: 1; color: var(--dim, #888);
  padding: 4px 8px;
}
.ob-x:hover { color: var(--text, #fff); }
.ob-title { margin: 0 0 20px; font-size: 22px; font-weight: 700; color: var(--text, #fff); }
.ob-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 18px; }
.ob-step { display: flex; gap: 14px; align-items: flex-start; }
.ob-num {
  flex: 0 0 auto;
  width: 26px; height: 26px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700;
  color: var(--bg, #000); background: var(--neon, #7CFF6B);
}
.ob-body { flex: 1 1 auto; min-width: 0; }
.ob-h { margin: 2px 0 4px; font-size: 15px; font-weight: 700; color: var(--text, #fff); }
.ob-p { margin: 0 0 10px; font-size: 13.5px; line-height: 1.5; color: var(--dim, #aaa); }
.ob-p strong { color: var(--text, #fff); }
/* Rectangular, neon-outlined — matches the site's newposts / forum buttons.
   Scoped as .ob-modal .ob-btn so the neon color out-specifies the global
   pow-feed anchor rule (color:inherit), which would otherwise wash the anchor
   variant — Get Cashtab — back to the body text color. */
.ob-modal .ob-btn {
  display: inline-block; cursor: pointer;
  font: inherit; font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  padding: 9px 16px; border-radius: 8px;
  border: 1px solid var(--neon, #7CFF6B);
  background: transparent; color: var(--neon, #7CFF6B);
  text-decoration: none; transition: box-shadow .15s, color .15s;
}
.ob-modal .ob-btn:hover { box-shadow: 0 0 12px rgba(0,255,156,.25); }
`
