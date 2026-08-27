'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { prewarmPaymentWatch } from '@/lib/ecash/watchPaymentAddress'
import { pollUntil } from '@/lib/ecash/pollUntil'
import { beginPayment, completePayment, abortPayment } from '@/lib/pocket/payGateway'
import EcashIcon from '@/components/EcashIcon'

// Display-only (the server re-prices in /api/forums/create/prepare). Keep in sync
// with FORUM_CREATE_FEE_XEC in lib/forums.ts.
const FORUM_CREATE_FEE_XEC = 10000

// Client-side slug guard mirroring lib/forums validateForumSlug — the server is
// the authority; this just gives instant feedback while typing.
const SLUG_RE = /^[A-Za-z0-9_]{2,24}$/

/**
 * Create-a-forum form + paid create flow. Handle-holders only (the server gates;
 * a non-holder gets a 403 surfaced here). Fields: name (the /f/<slug>), title,
 * description. Pay the one-time creation fee (100% platform) → the forum is
 * recorded → onCreated(forum) hands it back to the directory.
 */
export default function CreateForum({ onCreated, onCancel }) {
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [phase, setPhase] = useState('compose') // 'compose' | 'paying'
  const [payViaPocket, setPayViaPocket] = useState(false)
  const [intent, setIntent] = useState(null)
  const [notice, setNotice] = useState('')
  const [txidInput, setTxidInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [statusMsg, setStatusMsg] = useState('Waiting for payment…')
  const bodyRef = useRef(null)
  // Synchronous re-entrancy lock (see ComposeBox.js): guards against a double-tap
  // paying the forum-creation fee twice before `submitting` disables the button.
  const submitLockRef = useRef(false)

  const slugOk = SLUG_RE.test(slug) && !slug.startsWith('_') && !slug.endsWith('_')
  const titleOk = title.trim().length > 0 && title.trim().length <= 80
  const canSubmit = slugOk && titleOk && !submitting

  const resetToCompose = useCallback(() => {
    submitLockRef.current = false
    setPhase('compose')
    setIntent(null)
    setPayViaPocket(false)
    setNotice('')
    setTxidInput('')
    setStatusMsg('Waiting for payment…')
  }, [])

  const startPayment = useCallback(async () => {
    if (!canSubmit) return
    // Refuse a second concurrent start synchronously (double-tap / Enter+click) so
    // the creation fee can't be paid twice.
    if (submitLockRef.current) return
    submitLockRef.current = true
    bodyRef.current = { slug: slug.trim(), title: title.trim(), description: description.trim() }
    setSubmitting(true)
    setNotice('')
    prewarmPaymentWatch()
    const handle = beginPayment({ kind: 'forum-create', amountXec: FORUM_CREATE_FEE_XEC })
    setPayViaPocket(handle.mode === 'pocket')
    try {
      const res = await fetch('/api/forums/create/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(bodyRef.current),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        abortPayment(handle)
        setNotice(data.error || 'Could not start the payment. Try again.')
        return
      }
      void completePayment(handle, {
        bip21: data.bip21Url,
        cashtabUrl: data.cashtabUrl,
      }).then((r) => {
        if (r.ok && r.txid) {
          setStatusMsg('Creating your forum…')
          setIntent((prev) => (prev ? { ...prev, knownTxid: r.txid } : prev))
        } else if (!r.ok && r.reason === 'denied') {
          resetToCompose()
          setNotice('Payment cancelled — your draft is safe.')
        } else if (!r.ok && r.reason === 'pocket_error') {
          setPayViaPocket(false)
          setNotice(r.message || 'Pocket couldn’t send — use the Cashtab link below.')
        }
      })
      setIntent(data)
      setPhase('paying')
    } catch {
      abortPayment(handle)
      setNotice('Network hiccup — try again.')
      // Nothing broadcast — release the lock so a retry can start.
      submitLockRef.current = false
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, slug, title, description, resetToCompose])

  const confirmBody = useCallback(
    (extra) => ({
      slug: bodyRef.current?.slug,
      title: bodyRef.current?.title,
      description: bodyRef.current?.description,
      since: intent?.preparedAt,
      ...extra,
    }),
    [intent],
  )

  // Poll for the creation payment (Cashtab + non-optimistic pocket).
  const paying = phase === 'paying' && intent
  useEffect(() => {
    if (!paying) return undefined
    return pollUntil(
      async (wsTxid) => {
        const knownTxid = wsTxid ?? intent.knownTxid
        const res = await fetch('/api/forums/create/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(confirmBody(knownTxid ? { txid: knownTxid } : {})),
        })
        if (res.status === 429) return { backoff: true }
        const data = await res.json()
        if (data.status === 'created' && data.forum) {
          onCreated?.(data.forum)
          return { done: true }
        }
        if (!res.ok) setNotice(data.error || 'Verification failed.')
        return undefined
      },
      {
        onWsAddress: intent.payAddress,
        wsThreadsTxid: true,
        maxLifetimeMs: 120_000,
        onLifetimeExpired: () =>
          setNotice('Still confirming — refresh in a moment if the forum doesn’t appear.'),
      },
    )
  }, [paying, intent, confirmBody, onCreated])

  const verifyManual = useCallback(async () => {
    const t = txidInput.trim()
    if (!/^[0-9a-f]{64}$/i.test(t)) {
      setNotice('Enter a valid 64-character transaction ID.')
      return
    }
    setNotice('Checking that transaction…')
    try {
      const res = await fetch('/api/forums/create/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(confirmBody({ txid: t })),
      })
      const data = await res.json()
      if (data.status === 'created' && data.forum) {
        onCreated?.(data.forum)
      } else if (data.status === 'awaiting_payment') {
        setNotice("That transaction doesn't match this forum yet.")
      } else {
        setNotice(data.error || 'Could not verify that transaction.')
      }
    } catch {
      setNotice('Network hiccup — try again.')
    }
  }, [txidInput, confirmBody, onCreated])

  if (paying) {
    if (payViaPocket) {
      return (
        <div className="panel pay">
          <p className="poll">Creating your forum…</p>
          {notice ? <p className="notice">{notice}</p> : null}
        </div>
      )
    }
    return (
      <div className="panel pay">
        <p className="payhead">
          Cashtab opened for <strong>{intent.amountXec} XEC</strong>. Confirm to create the forum.
        </p>
        <p className="poll">{statusMsg}</p>
        <details className="manual">
          <summary>Cashtab didn&apos;t open, or already paid?</summary>
          <div style={{ textAlign: 'center', margin: '12px 0 0' }}>
            <a href={intent.cashtabUrl} target="_blank" rel="noreferrer" className="ghost">
              Open in Cashtab
            </a>
          </div>
          <div className="manualrow">
            <input
              value={txidInput}
              onChange={(e) => setTxidInput(e.target.value)}
              placeholder="Paste the transaction ID"
              spellCheck={false}
            />
            <button type="button" onClick={() => void verifyManual()} className="btn">
              Verify
            </button>
          </div>
        </details>
        {notice ? <p className="notice">{notice}</p> : null}
        <div style={{ marginTop: '16px' }}>
          <button type="button" onClick={() => resetToCompose()} className="linkbtn">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="panel forumcreate">
      <h3 className="forumcreate-head">Create a forum</h3>
      <p className="forumcreate-sub">
        A one-time {FORUM_CREATE_FEE_XEC.toLocaleString()} XEC fee. You become the runner and earn
        the 6% engagement fee on replies and positive reactions inside your forum.
      </p>
      <label className="forumcreate-field">
        <span className="forumcreate-label">Name</span>
        <div className="forumcreate-slugwrap">
          <span className="forumcreate-slugpre">/f/</span>
          <input
            className="forumcreate-input"
            value={slug}
            onChange={(e) => setSlug(e.target.value.replace(/\s+/g, ''))}
            placeholder="bitcoin"
            maxLength={24}
            spellCheck={false}
            autoCapitalize="none"
          />
        </div>
        {slug && !slugOk ? (
          <span className="forumcreate-hint over">
            2–24 chars: letters, numbers, underscore (not leading/trailing).
          </span>
        ) : (
          <span className="forumcreate-hint">Letters, numbers, and underscore.</span>
        )}
      </label>
      <label className="forumcreate-field">
        <span className="forumcreate-label">Title</span>
        <input
          className="forumcreate-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="All things Bitcoin"
          maxLength={80}
        />
      </label>
      <label className="forumcreate-field">
        <span className="forumcreate-label">Description <span className="forumcreate-opt">(optional)</span></span>
        <textarea
          className="forumcreate-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this forum is about…"
          maxLength={500}
          rows={3}
        />
      </label>
      <div className="forumcreate-bar">
        {onCancel ? (
          <button type="button" onClick={onCancel} className="ghost">
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void startPayment()}
          className="forumcreate-pay"
          aria-label={`Create forum for ${FORUM_CREATE_FEE_XEC} XEC`}
        >
          <span aria-hidden className="forumcreate-pay-icon">
            <EcashIcon size={15} />
          </span>
          <span>Create · {FORUM_CREATE_FEE_XEC.toLocaleString()} XEC</span>
        </button>
      </div>
      {notice ? <p className="notice">{notice}</p> : null}
    </div>
  )
}
