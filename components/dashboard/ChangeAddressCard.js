'use client'

// =============================================================================
//  ChangeAddressCard — the "Wallet address" panel in profile settings.
//  Moving an account to a new wallet is NOT a form field: the user proves
//  control of the new wallet by paying the same 5.5 XEC nonce challenge the
//  login uses, FROM that wallet. Mirrors WalletLogin's poll loop (1.2s interval
//  + Chronik websocket nudge) against the change-address routes:
//    POST /api/account/change-address/start, GET /api/account/change-address/status
//
//  Wrong-wallet payments are recoverable: the server keeps the challenge alive
//  and reports why it didn't match (same_address / address_in_use), so the user
//  can pay again from the right wallet while the countdown runs.
// =============================================================================

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { QRCodeSVG } from 'qrcode.react'
import { watchPaymentAddress, prewarmPaymentWatch } from '@/lib/ecash/watchPaymentAddress'
import { payWithCashtab } from '@/lib/ecash/cashtabPay'
import { usePocket } from '@/lib/pocket/store'

export default function ChangeAddressCard({ currentAddress, handle = null }) {
  const router = useRouter()
  const pocket = usePocket()
  const [phase, setPhase] = useState('idle') // idle | starting | proving | done
  const [started, setStarted] = useState(null)
  const [notice, setNotice] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(null)
  const [copied, setCopied] = useState(false)
  const [result, setResult] = useState(null)

  // RAW bip21 (no encodeURIComponent), same as WalletLogin — carries the nonce.
  const cashtabUrl = started ? `https://cashtab.com/#/send?bip21=${started.bip21Url}` : '#'

  // Cashtab extension if present (in-page popup, no tab), else a Cashtab web tab
  // — exactly one, never both. The QR/address below is the fallback.
  const openCashtab = () => {
    if (!started) return
    void payWithCashtab({ bip21: started.bip21Url, cashtabUrl })
  }

  const begin = useCallback(async () => {
    setNotice('')
    setPhase('starting')
    prewarmPaymentWatch()
    try {
      const r = await fetch('/api/account/change-address/start', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) {
        setNotice(j.error ?? 'Couldn’t start the address change. Try again.')
        setPhase('idle')
        return
      }
      setStarted(j)
      setPhase('proving')
    } catch {
      setNotice('Network hiccup — try again.')
      setPhase('idle')
    }
  }, [])

  const cancel = useCallback(() => {
    // just abandon the challenge; the unused nonce expires and is swept
    setPhase('idle')
    setStarted(null)
    setNotice('')
  }, [])

  const copyAddr = async () => {
    if (!started) return
    try {
      await navigator.clipboard.writeText(started.proofAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  // poll for the new wallet's proof payment
  useEffect(() => {
    if (phase !== 'proving' || !started) return
    let stopped = false
    const apply = (j) => {
      if (j.ok && j.newAddress) {
        setResult(j)
        setNotice('')
        setPhase('done')
        // The server re-stamped the session cookie for the new address; let the
        // nav byline re-read /api/me and re-render this page's server data.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('sessionChanged'))
        }
        router.refresh()
      } else if (j.status && j.status !== 'awaiting_payment' && j.error) {
        // Recoverable while the countdown runs (e.g. paid from the wrong
        // wallet): show why and keep polling — paying again from the right
        // wallet with the SAME request completes the change.
        setNotice(j.error)
      }
    }
    const poll = async () => {
      try {
        const r = await fetch('/api/account/change-address/status', { cache: 'no-store' })
        if (!stopped) apply(await r.json())
      } catch {
        /* keep polling */
      }
    }
    poll()
    const id = setInterval(() => !stopped && poll(), 1200)
    // Live nudge: poll the instant Chronik sees a tx touch the proof address;
    // third arg = wake on tab refocus (the payment often lands while the user
    // is over in Cashtab).
    const stopWatch = watchPaymentAddress(
      started.proofAddress,
      () => { if (!stopped) poll() },
      () => { if (!stopped) poll() },
    )
    return () => { stopped = true; clearInterval(id); stopWatch() }
  }, [phase, started, router])

  // countdown to nonce expiry
  useEffect(() => {
    if (phase !== 'proving' || !started) { setSecondsLeft(null); return }
    const tick = () =>
      setSecondsLeft(Math.max(0, Math.round((new Date(started.expiresAt).getTime() - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [phase, started])

  useEffect(() => {
    if (phase === 'proving' && secondsLeft === 0) {
      setNotice('That request expired. Start again when you’re ready.')
      setPhase('idle')
      setStarted(null)
    }
  }, [secondsLeft, phase])

  const mm = secondsLeft != null ? String(Math.floor(secondsLeft / 60)) : ''
  const ss = secondsLeft != null ? String(secondsLeft % 60).padStart(2, '0') : ''

  return (
    <section className="dashpanel">
      <style>{ADDR_CSS}</style>
      <h2 className="prof-panel-title">Wallet address</h2>
      <p className="prof-panel-sub">Your login wallet — and where your earnings are paid.</p>
      <p className="addrx-addr" title={currentAddress}>{currentAddress}</p>

      {phase === 'done' && result ? (
        <div role="status">
          <p className="addrx-okhead">Address updated ✓</p>
          <p className="addrx-addr" title={result.newAddress}>{result.newAddress}</p>
          <p className="prof-panel-sub">
            Logins, article sales, replies and tips now use this wallet. Your old wallet stays
            linked: everything it unlocked is still yours, and it can still log in to this account.
          </p>
          {result.absorbed ? (
            <p className="prof-panel-sub">
              The new wallet had an unused account here (from logging in with it once) — it was
              folded into this one, and anything it unlocked came along.
            </p>
          ) : null}
          {result.handleKept && result.handle ? (
            <p className="prof-panel-sub">
              Your handle <strong>@{result.handle}</strong> came along — its NFT is already in the
              new wallet.
            </p>
          ) : null}
          {!result.handleKept && handle ? (
            <p className="prof-panel-sub">
              Your <strong>@{handle}</strong> byline was unbound because the handle NFT is still in
              your old wallet. Send the NFT to the new wallet in Cashtab (eTokens tab), then
              re-select it under “Your handles” above.
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <ul className="addrx-warns">
            <li>
              Prove you own the new wallet by sending a <strong>{started?.amountXec ?? '5.50'} XEC</strong>{' '}
              check-in payment <strong>from that wallet</strong> — in Cashtab, switch to the new
              wallet before sending.
            </li>
            <li>
              Your current wallet stays linked: articles it unlocked stay unlocked, and it can
              still log in to this account.
            </li>
            {handle ? (
              <li>
                Your <strong>@{handle}</strong> handle NFT lives in your current wallet. To keep
                your byline, send the NFT to the new wallet (Cashtab → eTokens) and re-select it
                under “Your handles” — you can do that before or after switching.
              </li>
            ) : null}
            {pocket.status === 'ready' && (pocket.balanceSats ?? 0) > 0 ? (
              <li>
                Your <strong>Pocket</strong> holds {Math.floor(pocket.balanceSats / 100).toLocaleString()}{' '}
                XEC and was created by your <strong>current</strong> wallet’s signature — after the
                switch, recovering it needs the old wallet.{' '}
                <Link href="/pocket">Sweep the Pocket to your wallet first</Link>, then set up a
                fresh one with the new wallet.
              </li>
            ) : null}
          </ul>

          {notice ? (
            <p className="error" style={{ marginTop: '12px' }} role="alert">{notice}</p>
          ) : null}

          {phase === 'proving' && started ? (
            <div>
              <p className="addrx-poll">
                Waiting for the {started.amountXec} XEC payment from your new wallet
                {secondsLeft != null && secondsLeft > 0 ? (
                  <span className="addrx-timer"> · expires in {mm}:{ss}</span>
                ) : null}
              </p>
              <div className="addrx-actions">
                <button type="button" className="dashbtn" onClick={openCashtab}>
                  Open Cashtab
                </button>
                <button type="button" className="ghost" onClick={copyAddr}>
                  {copied ? 'copied ✓' : 'copy address'}
                </button>
                <button type="button" className="ghost" onClick={cancel}>
                  Cancel
                </button>
              </div>
              <div className="addrx-qrwrap">
                <div className="addrx-qr">
                  <QRCodeSVG value={started.bip21Url} size={148} bgColor="#dffff2" fgColor="#05130d" />
                </div>
                <p className="addrx-proofaddr" title={started.proofAddress}>{started.proofAddress}</p>
              </div>
            </div>
          ) : (
            <div className="addrx-actions">
              <button
                type="button"
                className="dashbtn"
                onClick={() => void begin()}
                disabled={phase === 'starting'}
              >
                {phase === 'starting' ? 'Preparing…' : 'Change wallet address'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

// Scoped chrome on top of FEED_CSS / PROFILE_CSS (this card renders inside the
// settings page's .pow-feed tree, so panel/button/error styles come from there).
const ADDR_CSS = `
.pow-feed .addrx-addr{margin:12px 0 0;font-size:12.5px;color:var(--text);word-break:break-all;
  background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:9px 11px;}
.pow-feed .addrx-warns{margin:14px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:6px;}
.pow-feed .addrx-warns li{font-size:12px;line-height:1.55;color:var(--dim);}
.pow-feed .addrx-warns strong{color:var(--text);font-weight:700;}
.pow-feed .addrx-actions{margin-top:16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;}
.pow-feed .addrx-actions a.dashbtn{text-decoration:none;}
.pow-feed .addrx-poll{margin:14px 0 0;font-size:13px;color:var(--text);}
.pow-feed .addrx-poll::after{content:"\\2588";margin-left:3px;color:var(--neon);animation:addrx-blink 1s steps(1) infinite;}
.pow-feed .addrx-timer{color:var(--cyan);}
@keyframes addrx-blink{50%{opacity:0;}}
.pow-feed .addrx-qrwrap{margin-top:16px;display:flex;flex-direction:column;align-items:flex-start;gap:8px;}
.pow-feed .addrx-qr{display:inline-block;padding:10px;background:#dffff2;border-radius:10px;
  box-shadow:0 0 0 1px var(--neon),0 0 18px rgba(0,255,156,.2);}
.pow-feed .addrx-proofaddr{margin:0;font-size:11.5px;color:var(--dim);word-break:break-all;}
.pow-feed .addrx-okhead{margin:14px 0 0;font-size:14px;font-weight:700;color:var(--neon);
  text-shadow:0 0 8px rgba(0,255,156,.3);}
@media (prefers-reduced-motion:reduce){.pow-feed .addrx-poll::after{animation:none;}}
`
