'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Like / Repost / Quote controls for a feed post. Likes and reposts are on-chain
 * paid actions (flat 100 XEC, 94/6 to the post's author/platform), so tapping
 * one opens Cashtab and then polls /api/feed/react/confirm until the payment is
 * detected. There is no undo in v1: once you've liked or reposted, the button is
 * shown as "on" and further taps are no-ops. Quote is delegated to the parent
 * (which opens a composer) via onQuote.
 */
export default function EngagementBar({
  targetTxid,
  likeCount = 0,
  repostCount = 0,
  likedByViewer = false,
  repostedByViewer = false,
  canQuote = true,
  onQuote,
}) {
  const [likes, setLikes] = useState(likeCount)
  const [reposts, setReposts] = useState(repostCount)
  const [liked, setLiked] = useState(likedByViewer)
  const [reposted, setReposted] = useState(repostedByViewer)

  // Which reaction is mid-payment, if any: 'like' | 'repost' | null.
  const [pending, setPending] = useState(null)
  const [intent, setIntent] = useState(null)
  const [notice, setNotice] = useState('')
  const [txidInput, setTxidInput] = useState('')
  const startingRef = useRef(false)

  const isLike = pending === 'like'

  const startReaction = useCallback(
    async (action) => {
      if (startingRef.current || pending) return
      if (action === 'like' && liked) return
      if (action === 'repost' && reposted) return
      startingRef.current = true
      setNotice('')
      // Open the tab synchronously inside the click gesture (popup blockers
      // swallow a window.open that happens after an await), then point it at
      // Cashtab once /prepare returns.
      const payWindow =
        typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null
      if (payWindow) payWindow.opener = null
      try {
        const res = await fetch('/api/feed/react/prepare', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, targetTxid }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) {
          payWindow?.close()
          setNotice(data.error || 'Could not start the payment. Try again.')
          return
        }
        if (payWindow) payWindow.location.href = data.cashtabUrl
        setIntent(data)
        setPending(action)
      } catch {
        payWindow?.close()
        setNotice('Network hiccup — try again.')
      } finally {
        startingRef.current = false
      }
    },
    [pending, liked, reposted, targetTxid],
  )

  const applyReacted = useCallback((action) => {
    if (action === 'like') {
      setLiked((was) => {
        if (!was) setLikes((n) => n + 1)
        return true
      })
    } else {
      setReposted((was) => {
        if (!was) setReposts((n) => n + 1)
        return true
      })
    }
    setPending(null)
    setIntent(null)
    setTxidInput('')
    setNotice('')
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sessionChanged'))
    }
  }, [])

  // Poll for the on-chain reaction while a payment is pending.
  useEffect(() => {
    if (!pending || !intent) return undefined
    let stopped = false
    const check = async (manualTxid) => {
      try {
        const res = await fetch('/api/feed/react/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: pending,
            targetTxid,
            since: intent.preparedAt,
            ...(manualTxid ? { txid: manualTxid } : {}),
          }),
        })
        const data = await res.json()
        if (stopped) return
        if (data.status === 'reacted') {
          stopped = true
          applyReacted(pending)
        } else if (data.status === 'finalizing') {
          setNotice('Finalizing payment…')
        } else if (!res.ok) {
          setNotice(data.error || 'Verification failed.')
        }
      } catch {
        /* keep polling */
      }
    }
    check()
    const id = setInterval(() => !stopped && check(), 2500)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [pending, intent, targetTxid, applyReacted])

  const verifyManual = useCallback(async () => {
    const t = txidInput.trim()
    if (!/^[0-9a-f]{64}$/i.test(t)) {
      setNotice('Enter a valid 64-character transaction ID.')
      return
    }
    setNotice('Checking that transaction…')
    try {
      const res = await fetch('/api/feed/react/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: pending, targetTxid, txid: t }),
      })
      const data = await res.json()
      if (data.status === 'reacted') {
        applyReacted(pending)
      } else if (data.status === 'finalizing') {
        setNotice('Payment seen — finalizing. This clears in a few seconds.')
      } else if (data.status === 'awaiting_payment') {
        setNotice("That transaction doesn't match this reaction yet.")
      } else {
        setNotice(data.error || 'Could not verify that transaction.')
      }
    } catch {
      setNotice('Network hiccup — try again.')
    }
  }, [txidInput, pending, targetTxid, applyReacted])

  const cancel = useCallback(() => {
    setPending(null)
    setIntent(null)
    setTxidInput('')
    setNotice('')
  }, [])

  return (
    <div className="engage">
      <div className="engagebar">
        <button
          type="button"
          className={`likebtn${liked ? ' on' : ''}`}
          onClick={() => void startReaction('like')}
          disabled={Boolean(pending)}
          aria-pressed={liked}
          title={liked ? 'You liked this' : 'Like · 100 XEC to the author'}
        >
          {liked ? '♥' : '♡'} {likes > 0 ? likes : ''} Like
        </button>

        <button
          type="button"
          className={`repostbtn${reposted ? ' on' : ''}`}
          onClick={() => void startReaction('repost')}
          disabled={Boolean(pending)}
          aria-pressed={reposted}
          title={reposted ? 'You reposted this' : 'Repost · 100 XEC to the author'}
        >
          🔁 {reposts > 0 ? reposts : ''} Repost
        </button>

        {canQuote ? (
          <button
            type="button"
            className="quotebtn"
            onClick={() => onQuote?.()}
            title="Quote this post"
          >
            Quote
          </button>
        ) : null}
      </div>

      {pending && intent ? (
        <div className="reactpay">
          <p className="poll">
            Confirm <strong>{intent.amountXec} XEC</strong> in Cashtab to{' '}
            {isLike ? 'like' : 'repost'} this post…
          </p>
          <details className="manual">
            <summary>Cashtab didn&apos;t open, or already paid?</summary>
            <div style={{ textAlign: 'center', margin: '10px 0 0' }}>
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
          <div style={{ marginTop: '10px' }}>
            <button type="button" onClick={cancel} className="linkbtn">
              Cancel
            </button>
          </div>
        </div>
      ) : notice ? (
        <p className="notice">{notice}</p>
      ) : null}
    </div>
  )
}
