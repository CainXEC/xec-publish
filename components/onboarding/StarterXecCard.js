'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

/**
 * Welcome-gift card for a logged-in, brand-new account (onboarding Piece 3).
 * The parent only mounts it while the server says the account is brand-new (no
 * tip received, no post, no reaction); the card then asks /api/faucet/status
 * where the account stands and lets it claim XEC + POW from the new-user faucet
 * (lib/faucet.ts). Keeps id="starter-xec" — the composer's "get it free" nudge
 * scrolls here.
 *
 * States: eligible → Claim button; sent/claimed → success + mint-a-handle link;
 * capped → today's budget is gone, resets 00:00 UTC; ineligible → explain the
 * new-Cashtab-wallet rule; unknown → held for verification; disabled → quiet
 * note; not_new/signedout → render nothing.
 *
 * @param {{ preview?: Record<string, unknown> | null }} [props]
 */
export default function StarterXecCard({ preview = null } = {}) {
  // `preview` (dev bench /dev/faucet only) pins a state and skips the network.
  const [s, setS] = useState(preview ?? { state: 'loading' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (preview) return undefined
    let on = true
    fetch('/api/faucet/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (on) setS(d?.ok ? d : { state: 'disabled' })
      })
      .catch(() => {
        if (on) setS({ state: 'disabled' })
      })
    return () => {
      on = false
    }
  }, [preview])

  const claim = useCallback(async () => {
    if (preview) return
    setBusy(true)
    setErr('')
    try {
      const r = await fetch('/api/faucet/claim', { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (d?.state) setS((prev) => ({ ...prev, ...d }))
      if (!d?.ok && d?.error) setErr(d.error)
    } catch {
      setErr('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }, [preview])

  const xec = Number(s.xec ?? 2500).toLocaleString('en-US')
  const pow = Number(s.pow ?? 10).toLocaleString('en-US')
  const gift = `${xec} XEC + ${pow} POW`

  if (s.state === 'not_new' || s.state === 'signedout') return null

  let body
  if (s.state === 'loading') {
    body = <p className="starter-p muted">Checking your welcome gift…</p>
  } else if (s.state === 'eligible') {
    body = (
      <>
        <h3 className="starter-h">Your welcome gift is ready</h3>
        <p className="starter-p">
          Claim <strong>{gift}</strong>{' '}free — enough to post, react, unlock stories, try
          one-tap payments with your Pocket, and mint your own @handle with the POW.
        </p>
        <button type="button" className="starter-btn" onClick={claim} disabled={busy}>
          {busy ? 'Sending…' : `Claim ${gift}`}
        </button>
      </>
    )
  } else if (s.state === 'sent' || s.state === 'claimed') {
    body = (
      <>
        <h3 className="starter-h">Welcome gift sent 🎉</h3>
        <p className="starter-p">
          <strong>{gift}</strong>{' '}{s.state === 'sent' ? 'just landed in' : 'went to'}{' '}your
          Cashtab wallet. Your {pow} POW mints a free handle (11–15 characters), and a
          1,000 XEC top-up sets up your Pocket for one-tap payments.
        </p>
        <div className="starter-ctas">
          <Link href="/claim-handle" className="starter-btn">
            Mint your handle →
          </Link>
          <Link href="/pocket" className="starter-btn ghost">
            Set up your Pocket →
          </Link>
        </div>
        {s.txid ? (
          <a
            className="starter-tx"
            href={`https://explorer.e.cash/tx/${s.txid}`}
            target="_blank"
            rel="noreferrer"
          >
            view transaction
          </a>
        ) : null}
      </>
    )
  } else if (s.state === 'capped') {
    body = (
      <>
        <h3 className="starter-h">Today&rsquo;s welcome gifts are all claimed</h3>
        <p className="starter-p">
          The faucet resets at <strong>00:00 UTC</strong>
          {s.resetsAt ? <ResetLocal iso={s.resetsAt} /> : null} — come back then to claim{' '}
          <strong>{gift}</strong>.
        </p>
      </>
    )
  } else if (s.state === 'ineligible') {
    body = (
      <p className="starter-p">
        The welcome gift is for <strong>new Cashtab wallets</strong>{' '}that claimed
        Cashtab&rsquo;s free 42 XEC. Create a new wallet at cashtab.com, claim its 42 XEC, then log in here with it
        to claim {gift}.
      </p>
    )
  } else if (s.state === 'unknown') {
    body = (
      <p className="starter-p">
        Your welcome gift is being verified — it should arrive in your Cashtab wallet shortly.
      </p>
    )
  } else {
    body = <p className="starter-p muted">The welcome gift is temporarily unavailable — check back soon.</p>
  }

  return (
    <div className="starter-card" id="starter-xec">
      <style>{STARTER_CSS}</style>
      <div className="starter-body">
        {body}
        {err ? <p className="starter-err">{err}</p> : null}
      </div>
    </div>
  )
}

/** " (6:00 PM your time)" — rendered client-side only (post-fetch), so no SSR mismatch. */
function ResetLocal({ iso }) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return <> ({d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} your time)</>
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
.starter-p:last-child { margin-bottom: 0; }
.starter-p.muted { margin: 0; }
.starter-p strong { color: var(--text, #fff); }
/* Rectangular, neon-outlined — matches the site's newposts / forum buttons. */
.starter-btn {
  display: inline-block; cursor: pointer; text-decoration: none;
  font: inherit; font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  padding: 9px 18px; border-radius: 8px;
  border: 1px solid var(--neon, #7CFF6B);
  background: transparent; color: var(--neon, #7CFF6B);
  transition: box-shadow .15s, color .15s;
}
.starter-btn:hover { box-shadow: 0 0 12px rgba(0,255,156,.25); }
.starter-btn:disabled { opacity: .6; cursor: wait; box-shadow: none; }
.starter-ctas { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
.starter-btn.ghost { border-color: var(--line, #444); color: var(--dim, #aaa); }
.starter-btn.ghost:hover { box-shadow: none; border-color: var(--neon, #7CFF6B); color: var(--neon, #7CFF6B); }
.starter-tx { display: block; margin-top: 10px; font-size: 12px; color: var(--dim, #aaa); }
.starter-tx:hover { color: var(--cyan, #3df0ff); }
.starter-err { margin: 10px 0 0; font-size: 12.5px; color: var(--no, #ff5c6c); }
`
