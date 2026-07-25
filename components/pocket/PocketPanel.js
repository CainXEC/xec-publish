'use client'

// =============================================================================
//  PocketPanel — /pocket. Create, restore, fund, sweep, and forget the Pocket.
//
//  The pocket is a browser-held spending key derived from ONE Cashtab
//  signature over a fixed sentence (lib/pocket/derive.js). This panel is the
//  only place that key is ever created or handled outside a spend:
//    create : show sentence → user signs in Cashtab → paste → verify it's
//             THEIR wallet → derive → register (challenge session + possession
//             proof) → fund from Cashtab (the funding BIP21 carries the
//             on-chain DELEGATE endorsement of the pocket pubkey).
//    restore: same paste — deterministic signing re-derives the identical key;
//             if it matches the registered pocket, no server write at all.
//    freeze : a derived address that does NOT match the registered pocket is
//             never silently adopted — the wrong wallet signed, or
//             deterministic signing changed. Explicit "replace" only.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  usePocket,
  refreshPocket,
  refreshPocketBalance,
  applyOptimisticSpend,
  undoOptimisticSpend,
  POCKET_SOFT_CAP_XEC,
} from '@/lib/pocket/store'
import { useRollingSats } from '@/lib/pocket/useRollingSats'
import {
  POCKET_SENTENCE_V1,
  CASHTAB_SIGN_URL,
  parsePastedSignature,
  verifySignatureAgainstPrimary,
  derivePocketFromSignature,
  buildRegisterProofString,
  signRegisterProof,
} from '@/lib/pocket/derive'
import { savePocket, forgetPocket, loadPocket } from '@/lib/pocket/storage'
import { buildPublishFeeBip21 } from '@/lib/paymentSplit'
import { encodeFeedOpReturnRaw, FEED_ACTION } from '@/lib/feedProtocol'
import {
  payWithCashtab,
  isCashtabExtensionAvailable,
  signMessageWithCashtabExtension,
} from '@/lib/ecash/cashtabPay'
import { watchPaymentAddress, prewarmPaymentWatch } from '@/lib/ecash/watchPaymentAddress'

const FUND_PRESETS = [1000, 5000, 10000, 20000]

export default function PocketPanel() {
  const pocket = usePocket()

  return (
    <div className="pow-pocket">
      <style>{CSS}</style>
      <header className="pockethead">
        <h1 className="title">Pocket</h1>
        <p className="sub">
          A spending balance for one-tap feed actions, article unlocks and publishing payments.
          A few coins for your pocket. The wallet is still Cashtab.
        </p>
      </header>

      {pocket.status === 'disabled' && (
        <p className="body dim center">The Pocket isn’t enabled on this deployment yet.</p>
      )}

      {pocket.status === 'signedout' && (
        <p className="center">
          <Link className="cta" href="/login">
            Log in
          </Link>
        </p>
      )}

      {(pocket.status === 'idle' || pocket.status === 'none') && pocket.status === 'none' && (
        <CreateOrRestore pocket={pocket} />
      )}

      {pocket.status === 'ready' && <PocketDashboard pocket={pocket} />}
    </div>
  )
}

// -----------------------------------------------------------------------------
//  Create / restore wizard (status 'none': signed in, no pocket on this device)
// -----------------------------------------------------------------------------
function CreateOrRestore({ pocket }) {
  const [step, setStep] = useState('sign') // 'sign' | 'paste' | 'fund'
  const [pasted, setPasted] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [restored, setRestored] = useState(false)
  const [copied, setCopied] = useState(false)
  const [clipboardCleared, setClipboardCleared] = useState(false)
  // True while we derive from a signature the Cashtab extension just returned —
  // shows a "deriving" panel instead of the sign form for that brief moment.
  const [autoDeriving, setAutoDeriving] = useState(false)
  // True while the Cashtab extension's signMessage approval popup is open.
  const [extSigning, setExtSigning] = useState(false)
  // A derived pocket that CONFLICTS with the account's registered one. Never
  // silently adopted — the user must explicitly replace (or use the right wallet).
  const [frozen, setFrozen] = useState(null) // { derived, currentAddress }

  const needsWalletLogin = pocket.sessionVia !== 'challenge'

  const copySentence = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(POCKET_SENTENCE_V1)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* the sentence is visible; manual copy still works */
    }
  }, [])

  const clearClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText('')
      setClipboardCleared(true)
    } catch {
      /* best-effort */
    }
  }, [])

  const finishCreate = useCallback(
    (derived, registered) => {
      savePocket({
        v: 1,
        accountId: pocket.accountId,
        address: derived.address,
        pkHex: derived.pkHex,
        skHex: derived.skHex,
        primaryAtCreation: pocket.primaryAddress ?? '',
        registered,
        createdAt: new Date().toISOString(),
      })
      refreshPocket()
      setStep('fund')
    },
    [pocket.accountId, pocket.primaryAddress],
  )

  const registerPocket = useCallback(
    async (derived, replace) => {
      const proofSig = signRegisterProof(
        derived.skHex,
        buildRegisterProofString(pocket.accountId, derived.address),
      )
      const res = await fetch('/api/pocket/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          address: derived.address,
          pubkey: derived.pkHex,
          proofSig,
          ...(replace ? { replace: true } : {}),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 409 && json?.error === 'pocket_conflict') {
        setFrozen({ derived, currentAddress: json.currentPocket?.address ?? null })
        return false
      }
      if (!res.ok || !json.ok) {
        setError(json?.error || 'Could not register the pocket. Try again.')
        return false
      }
      finishCreate(derived, true)
      return true
    },
    [pocket.accountId, finishCreate],
  )

  const submitSignature = useCallback(async (rawSig) => {
    if (busy) return
    // `rawSig` lets the callback/clipboard paths submit a signature directly,
    // without waiting on the async `pasted` state update; the button passes none.
    const raw = typeof rawSig === 'string' ? rawSig : pasted
    setBusy(true)
    setError('')
    setFrozen(null)
    try {
      const parsed = parsePastedSignature(raw)
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }
      if (!verifySignatureAgainstPrimary(parsed.sigBase64, pocket.primaryAddress ?? '')) {
        setError(
          `That signature wasn’t made by your login wallet (${shorten(pocket.primaryAddress)}). ` +
            'In Cashtab, make sure the wallet you log in with is the ACTIVE wallet, then sign the sentence again.',
        )
        return
      }
      const derived = derivePocketFromSignature(parsed.sigBytes)

      // What does the server think this account's pocket is?
      const statusRes = await fetch('/api/pocket/status', { cache: 'no-store' })
      const status = await statusRes.json().catch(() => ({}))
      const registeredAddr = status?.pocket?.address ?? null

      if (registeredAddr && sameAddress(registeredAddr, derived.address)) {
        // Pure restore: the key re-derived to exactly the registered pocket.
        setRestored(true)
        finishCreate(derived, true)
        return
      }
      if (registeredAddr) {
        // Mismatch: wrong wallet signed, or deterministic signing changed.
        // FREEZE — never silently mint a new pocket over the old one.
        setFrozen({ derived, currentAddress: registeredAddr })
        return
      }
      if (needsWalletLogin) {
        setError(
          'Setting up a Pocket needs a full wallet login (your current session came from a payment). Log in with your main wallet, then try again.',
        )
        return
      }
      await registerPocket(derived, false)
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setBusy(false)
      setAutoDeriving(false)
    }
  }, [busy, pasted, pocket.primaryAddress, needsWalletLogin, registerPocket, finishCreate])

  // Open Cashtab's Sign & Verify in a new tab and leave the sentence on the
  // clipboard so it can be pasted in. POW stays open here so the user can return
  // and paste the signature (via the button below or the textarea).
  const openWebSignTab = useCallback(() => {
    // Put the sentence on the clipboard so it can be pasted straight into
    // Cashtab's Sign box. The async Clipboard API can lose the write when
    // window.open steals focus a tick later, so we ALSO do a synchronous
    // execCommand copy, which commits before the new tab opens.
    try {
      navigator.clipboard?.writeText(POCKET_SENTENCE_V1).catch(() => {})
    } catch {
      /* ignore */
    }
    try {
      const ta = document.createElement('textarea')
      ta.value = POCKET_SENTENCE_V1
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.top = '-1000px'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    } catch {
      /* ignore */
    }
    const win = window.open(CASHTAB_SIGN_URL, '_blank', 'noopener,noreferrer')
    if (!win) {
      setError(
        'Couldn’t open Cashtab automatically. Go to cashtab.com → Sign & Verify, paste the ' +
          'sentence (it’s on your clipboard), sign, then come back and paste the signature below.',
      )
    }
  }, [])

  // Kick the "sign one sentence" ceremony to Cashtab.
  //  - Desktop EXTENSION: sign through cashtab-connect's in-page approval popup.
  //    The signature returns in memory — no tab, no clipboard, no URL — and we
  //    derive on the spot. The preferred path (the sanctioned wallet channel).
  //  - Otherwise (mobile / no extension / an extension too old for signMessage):
  //    open the web Sign & Verify screen; the user signs, copies the signature,
  //    returns, and pastes it below.
  const signInCashtab = useCallback(async () => {
    setError('')
    if (isCashtabExtensionAvailable()) {
      setExtSigning(true)
      const res = await signMessageWithCashtabExtension(POCKET_SENTENCE_V1)
      setExtSigning(false)
      if (res.ok) {
        setPasted(res.signature)
        setAutoDeriving(true)
        await submitSignature(res.signature)
        return
      }
      if (res.reason === 'denied') {
        setError('You declined the signature in Cashtab. Tap “Sign in Cashtab” to try again.')
        return
      }
      // 'unsupported' | 'timeout' | 'unavailable' | 'error' → open the web screen.
    }
    openWebSignTab()
  }, [submitSignature, openWebSignTab])

  // The user signed in the web Sign & Verify screen and copied the signature;
  // one tap reads it from the clipboard and submits — no field focus / long-press
  // / paste dance.
  const pasteFromClipboard = useCallback(async () => {
    let text = ''
    try {
      text = await navigator.clipboard.readText()
    } catch {
      /* handled below */
    }
    text = (text || '').trim()
    if (!text) {
      setError('Couldn’t read your clipboard — paste the signature into the box below instead.')
      return
    }
    setPasted(text)
    void submitSignature(text)
  }, [submitSignature])

  const replaceConfirmed = useCallback(async () => {
    if (!frozen?.derived || busy) return
    setBusy(true)
    setError('')
    try {
      if (needsWalletLogin) {
        setError('Replacing a Pocket needs a full wallet login. Log in with your main wallet first.')
        return
      }
      await registerPocket(frozen.derived, true)
    } finally {
      setBusy(false)
    }
  }, [frozen, busy, needsWalletLogin, registerPocket])

  if (step === 'fund') {
    return (
      <FundPocket
        restored={restored}
        clipboardCleared={clipboardCleared}
        onClearClipboard={clearClipboard}
      />
    )
  }

  // A pay-scope session (logged in by paying for something, not the full wallet
  // challenge) can't create a Pocket — same bar as change-address, because the
  // server can only confirm you own the account from the challenge login (the
  // ceremony signature can't be sent; it IS the Pocket key). Gate UPFRONT with a
  // login button so the user isn't walked through the whole sign-and-paste
  // ceremony only to dead-end at the end. `next` returns them here after login.
  if (needsWalletLogin) {
    return (
      <div className="panel">
        <h2 className="h2">Log in with your wallet first</h2>
        <p className="body">
          Setting up a Pocket needs a full wallet login. Your session came from a
          payment — enough to read and unlock, but a Pocket touches your keys, so we
          ask you to prove your wallet first. It’s a quick, one-time login.
        </p>
        <p className="center">
          <Link className="cta" href="/login?next=/pocket">
            Log in with your wallet
          </Link>
        </p>
      </div>
    )
  }

  if (frozen) {
    return (
      <div className="panel freeze">
        <h2 className="h2">This isn’t your current Pocket</h2>
        <p className="body">
          Your account’s registered Pocket is <code className="mono">{shorten(frozen.currentAddress)}</code>,
          but the signature you pasted derives <code className="mono">{shorten(frozen.derived.address)}</code>.
        </p>
        <p className="body">
          That usually means the signature came from a <strong>different wallet</strong> — often an old
          wallet from before an address change. Funds in the old Pocket can only be recovered with the
          old wallet’s signature.
        </p>
        <button className="cta danger" onClick={() => void replaceConfirmed()} disabled={busy}>
          {busy ? 'Replacing…' : 'Replace pocket (start fresh with this wallet)'}
        </button>
        <button className="ghost" onClick={() => setFrozen(null)} disabled={busy}>
          Cancel — I’ll sign with the right wallet
        </button>
        {error && <p className="notice">{error}</p>}
      </div>
    )
  }

  if (autoDeriving) {
    return (
      <div className="panel">
        <h2 className="h2">Deriving your Pocket…</h2>
        <p className="body">
          Signature received from Cashtab — verifying it’s your wallet and rebuilding your Pocket
          key. One moment.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="panel">
        <h2 className="h2">1 · Sign one sentence in Cashtab</h2>
        <p className="body">
          Your signature <em>is</em> the key to your Pocket: the same wallet signing the same
          sentence always produces the same key, so you can rebuild your Pocket on any device by
          signing again. Nothing to back up, nothing to lose.
        </p>
        <div className="sentence">
          <code>{POCKET_SENTENCE_V1}</code>
        </div>
        <div className="row">
          <button className="cta" onClick={() => void signInCashtab()} disabled={extSigning}>
            {extSigning ? 'Check Cashtab…' : 'Sign in Cashtab →'}
          </button>
          <button className="ghost" onClick={() => void copySentence()}>
            {copied ? 'copied ✓' : 'copy sentence'}
          </button>
        </div>
        <p className="body dim">
          Cashtab opens in a new tab with the sentence copied to your clipboard: paste it into Sign
          &amp; Verify, sign, copy the signature, then come back and paste it below.
        </p>
      </div>

      <div className="panel">
        <h2 className="h2">2 · Paste the signature</h2>
        <p className="body dim">
          After signing in Cashtab, paste the signature here — tap <em>Paste signature</em> to grab it
          straight from your clipboard, or paste it into the box.
        </p>
        <div className="row">
          <button className="ghost" onClick={() => void pasteFromClipboard()} disabled={busy}>
            Paste signature from Cashtab
          </button>
        </div>
        <textarea
          className="paste"
          rows={2}
          placeholder="…or paste the 88-character signature from Cashtab here"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          className="cta"
          onClick={() => void submitSignature()}
          disabled={busy || !pasted.trim()}
        >
          {busy ? 'Checking…' : 'Create my pocket'}
        </button>
        <p className="warn">
          The signature is the key to your Pocket. Never share it or paste it on any other site
          unless you’re willing to risk losing your Pocket change.
        </p>
        {error && <p className="notice">{error}</p>}
      </div>
    </>
  )
}

// -----------------------------------------------------------------------------
//  Fund step — first funding after create/restore. Every top-up BIP21 carries
//  the on-chain DELEGATE endorsement of the pocket pubkey.
// -----------------------------------------------------------------------------
function FundPocket({ restored, clipboardCleared, onClearClipboard }) {
  const pocket = usePocket()
  const rollingSats = useRollingSats(pocket.balanceSats)
  return (
    <div className="panel">
      <h2 className="h2">{restored ? 'Pocket restored ✓' : 'Pocket created ✓'}</h2>
      {restored ? (
        <p className="body">
          Same signature, same key: this is the Pocket you already had
          {pocket.balanceSats != null && pocket.balanceSats > 0
            ? ` — with ${formatXecFull(pocket.balanceSats)} XEC still in it.`
            : '.'}
        </p>
      ) : (
        <p className="body">
          Now load it with pocket change from Cashtab. A few thousand XEC covers hundreds of likes
          and replies.
        </p>
      )}
      {!clipboardCleared && (
        <button className="ghost" onClick={() => void onClearClipboard()}>
          clear the signature from my clipboard
        </button>
      )}
      <TopUp />
      <p className="body dim">
        Balance: <strong>{pocket.balanceSats == null ? '…' : `${formatXecFull(rollingSats)} XEC`}</strong>
        {' · '}
        <Link href="/pocket">done → pocket overview</Link>
      </p>
    </div>
  )
}

// -----------------------------------------------------------------------------
//  Ready dashboard (status 'ready': record on this device)
// -----------------------------------------------------------------------------
function PocketDashboard({ pocket }) {
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [serverPocket, setServerPocket] = useState(undefined) // undefined=loading, null=none
  // Roll the balance to its new value — up when a top-up lands, down on a sweep.
  const rollingSats = useRollingSats(pocket.balanceSats)

  // Cross-check the device record against the account's registered pocket —
  // catches "replaced on another device" (old record here) early.
  useEffect(() => {
    let stopped = false
    fetch('/api/pocket/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!stopped) setServerPocket(j?.pocket ?? null)
      })
      .catch(() => {
        if (!stopped) setServerPocket(null)
      })
    return () => {
      stopped = true
    }
  }, [pocket.address])

  const stale =
    serverPocket && pocket.address && !sameAddress(serverPocket.address, pocket.address)

  const copyAddr = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(pocket.address ?? '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }, [pocket.address])

  // Sweep on a single press — no confirm dialog. The whole Pocket goes back to
  // the login wallet (recoverable any time by re-signing), so there's nothing to
  // guard against. The displayed balance rolls to zero the instant it's pressed
  // via the optimistic overlay (whole balance leaving), reconciled by the Chronik
  // nudge after the tx lands — and rolled back up if the sweep fails.
  const sweep = useCallback(async () => {
    if (busy || !pocket.primaryAddress || !(pocket.balanceSats > 0)) return
    setBusy(true)
    setNotice('')
    const sweeping = pocket.balanceSats ?? 0
    applyOptimisticSpend(sweeping)
    try {
      const record = loadPocket(pocket.accountId)
      if (!record) {
        undoOptimisticSpend(sweeping)
        setNotice('No pocket key on this device.')
        return
      }
      const { pocketSweep } = await import('@/lib/pocket/wallet')
      const r = await pocketSweep({ skHex: record.skHex, toAddress: pocket.primaryAddress })
      if (r.ok) {
        setNotice(`Swept ${formatXecFull(Number(r.sats))} XEC back to your wallet ✓`)
        refreshPocketBalance()
      } else {
        undoOptimisticSpend(sweeping)
        setNotice(r.error)
      }
    } catch {
      undoOptimisticSpend(sweeping)
      setNotice('Could not sweep. Try again.')
    } finally {
      setBusy(false)
    }
  }, [busy, pocket.accountId, pocket.primaryAddress, pocket.balanceSats])

  // Forget on a single press — no confirm dialog. It only drops the local key
  // record; any funds stay on the pocket address and come back any time you sign
  // the sentence again, so there's nothing to lose and nothing to guard against.
  const forget = useCallback(() => {
    forgetPocket(pocket.accountId)
    refreshPocket()
  }, [pocket.accountId])

  return (
    <>
      {stale && (
        <div className="panel freeze">
          <p className="body">
            This device holds an <strong>older Pocket</strong> ({shorten(pocket.address)}) — your
            account’s current one is {shorten(serverPocket.address)} (replaced on another device).
            Sweep this one to your wallet, then forget it and restore the current Pocket.
          </p>
        </div>
      )}

      <div className="panel">
        <p className="balance">
          {pocket.balanceSats == null ? '…' : `${formatXecFull(rollingSats)} XEC`}
        </p>
        <p className="body dim mono" title={pocket.address ?? ''}>
          {pocket.address}
          <button className="ghost tiny" onClick={() => void copyAddr()}>
            {copied ? 'copied ✓' : 'copy'}
          </button>
        </p>
        {!pocket.registered && (
          <p className="notice">
            This pocket isn’t registered to your account yet — likes paid from it would show up as a
            stranger. Re-run setup: forget it below, then create it again.
          </p>
        )}
      </div>

      <div className="panel">
        <h2 className="h2">Top up from Cashtab</h2>
        <TopUp />
      </div>

      <div className="panel">
        <h2 className="h2">Take it back out</h2>
        <p className="body">
          The Pocket is always yours to empty — one click returns everything to your wallet.
        </p>
        <div className="row stretch">
          <button className="cta" onClick={() => void sweep()} disabled={busy || !(pocket.balanceSats > 0)}>
            {busy ? 'Sweeping…' : 'Sweep to my wallet'}
          </button>
          <button className="ghost" onClick={forget} disabled={busy}>
            forget on this device
          </button>
        </div>
        {notice && <p className="notice ok">{notice}</p>}
      </div>

      <div className="panel">
        <h2 className="h2">If you lose this device</h2>
        <p className="body dim">
          Nothing is lost. Sign the same sentence with your wallet on any device and the identical
          Pocket reappears. The signature is the key: never share it, never paste it anywhere but
          proofofwriting.com.
        </p>
      </div>
    </>
  )
}

// -----------------------------------------------------------------------------
//  Shared top-up widget: preset Cashtab payments to the pocket address, each
//  carrying the DELEGATE op_return; records provenance via /api/pocket/funded.
// -----------------------------------------------------------------------------
function TopUp() {
  const pocket = usePocket()
  const [fundBip21, setFundBip21] = useState(null)
  const postedTxids = useRef(new Set())

  // While a top-up is pending, forward incoming pocket txs to the provenance
  // recorder (server checks pays-pocket + DELEGATE; wrong txids are ignored).
  useEffect(() => {
    if (!fundBip21 || !pocket.address) return undefined
    prewarmPaymentWatch()
    const unwatch = watchPaymentAddress(pocket.address, (txid) => {
      if (!txid || postedTxids.current.has(txid)) return
      postedTxids.current.add(txid)
      void fetch('/api/pocket/funded', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txid }),
      }).catch(() => {})
    })
    return unwatch
  }, [fundBip21, pocket.address])

  const startFund = useCallback(
    (amountXec) => {
      if (!pocket.address) return
      const record = loadPocket(pocket.accountId)
      const delegate = record?.pkHex
        ? encodeFeedOpReturnRaw({ action: FEED_ACTION.DELEGATE, pubkey: record.pkHex })
        : undefined
      const bip21 = buildPublishFeeBip21(pocket.address, amountXec, delegate)
      setFundBip21(bip21)
      void payWithCashtab({ bip21, cashtabUrl: `https://cashtab.com/#/send?bip21=${bip21}` })
    },
    [pocket.address, pocket.accountId],
  )

  const balanceXec = (pocket.balanceSats ?? 0) / 100

  return (
    <>
      <div className="row">
        {FUND_PRESETS.map((amt) => {
          const overCap = balanceXec + amt > POCKET_SOFT_CAP_XEC
          return (
            <button
              key={amt}
              className="cta preset"
              onClick={() => startFund(amt)}
              disabled={overCap}
              title={overCap ? 'That’s more than pocket change — keep the rest in Cashtab.' : undefined}
            >
              +{amt.toLocaleString()} XEC
            </button>
          )
        })}
      </div>
      {balanceXec >= POCKET_SOFT_CAP_XEC && (
        <p className="warn">
          That’s plenty for a pocket. Keep the rest in Cashtab — the Pocket is deliberately not
          where your money lives.
        </p>
      )}
      {fundBip21 && (
        <div className="fundwait">
          <p className="body">
            Waiting for the payment{' '}
            <span className="dots" aria-hidden>
              …
            </span>{' '}
            balance updates the moment it lands.
          </p>
        </div>
      )}
    </>
  )
}

// -----------------------------------------------------------------------------

function sameAddress(a, b) {
  const norm = (x) => String(x ?? '').toLowerCase().replace(/^ecash:/, '')
  return norm(a) === norm(b) && norm(a) !== ''
}

function shorten(addr) {
  const bare = String(addr ?? '').replace(/^ecash:/, '')
  return bare.length > 12 ? `${bare.slice(0, 6)}…${bare.slice(-4)}` : bare || '—'
}

function formatXecFull(sats) {
  return Math.floor((Number(sats) || 0) / 100).toLocaleString()
}

const CSS = `
.pow-pocket{
  --bg:#070b0a; --panel:#0d1513; --line:#173a33; --text:#d6fff0; --dim:#5f8a7e;
  --neon:#00ff9c; --cyan:#3df0ff; --no:#ff5c6c;
  max-width:640px; margin:0 auto; padding:0 20px 0; box-sizing:border-box;
  color:var(--text); text-align:left;
}
/* Header matches the marketplace page (MarketplaceClient .mkhead/.title/.sub). */
.pow-pocket .pockethead{margin:0 0 26px;text-align:center;}
.pow-pocket .title{font-size:40px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:var(--neon);
  margin:0 0 14px;text-shadow:0 0 26px rgba(0,255,156,.28);}
.pow-pocket .sub{color:#a6d8c9;font-size:14.5px;line-height:1.6;margin:0 auto;max-width:640px;
  text-align:justify;-webkit-hyphens:auto;hyphens:auto;}
@media (max-width:520px){.pow-pocket .title{font-size:30px;}}
.pow-pocket .center{text-align:center;}
/* Flat sections — no tile cards, separated by whitespace. Reset the card look
   inherited from FEED_CSS's .pow-feed .panel (bg/border/radius/shadow). */
.pow-pocket .panel{padding:0;margin:0 0 30px;background:none;border:none;border-radius:0;box-shadow:none;}
.pow-pocket .panel.freeze{border-left:2px solid var(--no);padding-left:16px;}
.pow-pocket .h2{font-size:15px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--neon);margin:0 0 10px;}
.pow-pocket .body{font-size:14px;line-height:1.6;color:var(--text);margin:0 0 12px;}
.pow-pocket .body.dim{color:var(--dim);}
.pow-pocket .body a{color:var(--cyan);}
.pow-pocket .mono{font-family:inherit;font-size:12px;word-break:break-all;}
.pow-pocket .sentence{background:#04120c;border:1px dashed var(--neon);border-radius:10px;padding:14px 16px;margin:0 0 12px;}
.pow-pocket .sentence code{font-size:13px;line-height:1.6;color:var(--neon);word-break:break-word;}
.pow-pocket .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:0 0 6px;}
/* Mixed cta+ghost rows: stretch children to the tallest sibling so the pair
   reads as one control group (the sweep/forget row). */
.pow-pocket .row.stretch{align-items:stretch;}
.pow-pocket .row.stretch .ghost{display:inline-flex;align-items:center;}
.pow-pocket .cta{background:transparent;color:var(--neon);border:1px solid var(--neon);border-radius:10px;
  padding:12px 18px;font:inherit;font-size:14px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
  cursor:pointer;text-decoration:none;display:inline-block;
  transition:background .15s,color .15s;}
.pow-pocket .cta:hover:not(:disabled){background:var(--neon);color:#04120c;}
.pow-pocket .cta:disabled{border-color:var(--line);color:var(--dim);cursor:not-allowed;}
.pow-pocket .cta.preset{padding:10px 14px;font-size:13px;}
.pow-pocket .cta.danger{border-color:var(--no);color:var(--no);}
.pow-pocket .cta.danger:hover:not(:disabled){background:var(--no);color:#140507;}
.pow-pocket .ghost{background:transparent;border:1px solid var(--line);color:var(--cyan);border-radius:8px;
  padding:8px 14px;font:inherit;font-size:12.5px;cursor:pointer;text-decoration:none;display:inline-block;}
.pow-pocket .ghost:hover{border-color:var(--cyan);}
.pow-pocket .ghost.tiny{padding:2px 8px;font-size:11px;margin-left:8px;}
.pow-pocket .paste{width:100%;box-sizing:border-box;background:#04120c;border:1px solid var(--line);border-radius:10px;
  color:var(--text);font:inherit;font-size:13px;padding:12px;margin:0 0 12px;resize:vertical;}
.pow-pocket .paste:focus{outline:none;border-color:var(--neon);}
.pow-pocket .warn{font-size:12.5px;color:#e8c06a;line-height:1.55;margin:12px 0 0;}
.pow-pocket .notice{color:var(--no);font-size:13.5px;margin:12px 0 0;}
.pow-pocket .notice.ok{color:var(--neon);}
.pow-pocket .balance{font-size:34px;font-weight:800;color:var(--neon);margin:0 0 8px;
  text-shadow:0 0 10px rgba(0,255,156,.4);}
.pow-pocket .fundwait{margin-top:10px;}

/* PAPER (light mode) — manuscript grounds, ink type, glow killed. */
html:not(.dark) .pow-pocket{
  --bg:#f6f4ed; --panel:#fdfcf8; --line:#e3dfd2; --text:#1a1c17; --dim:#5e6155;
  --neon:#12703c; --cyan:#0e6b74; --no:#a3312f;
}
html:not(.dark) .pow-pocket *{text-shadow:none;}
/* Kill the paper card-shadow FEED_CSS puts on .pow-feed .panel in light mode. */
html:not(.dark) .pow-pocket .panel{box-shadow:none;}
html:not(.dark) .pow-pocket .sub{color:#4a4d42;}
html:not(.dark) .pow-pocket .sentence{background:#fff;}
html:not(.dark) .pow-pocket .paste{background:#fff;}
html:not(.dark) .pow-pocket .cta:hover:not(:disabled){color:#fdfcf8;}
html:not(.dark) .pow-pocket .warn{color:#8a6d1f;}
`
