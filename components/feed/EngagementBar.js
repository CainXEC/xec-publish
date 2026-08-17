'use client'

import { useEffect, useMemo, useState } from 'react'
import { useReactionPayment } from '@/components/feed/useReactionPayment'
import { REACTIONS } from '@/lib/reactions'

/**
 * Reaction / Repost / Quote controls for a feed post. Reactions are on-chain paid
 * actions: tapping an emoji sends a flat 100 XEC (94/6 to the author, or 100% to
 * the platform for 👎), opens Cashtab/Pocket, and polls /api/feed/react/confirm.
 * Unlike the old ♥ like, you can react as MANY times as you like (paying each) —
 * so there's no "already reacted" lock; the post carries per-emoji pill counts.
 * Repost stays a flat one-per-wallet 100 XEC. Quote is delegated via onQuote.
 *
 * The payment flow lives in useReactionPayment (shared with repost + article
 * comments); this component owns the picker, the pills, and their optimism.
 */
export default function EngagementBar({
  targetTxid,
  reactionCounts = {},
  repostCount = 0,
  quoteCount = 0,
  repostedByViewer = false,
  canQuote = true,
  onQuote,
}) {
  // Per-emoji counts shown as pills. Seeded from the server truth and re-seeded
  // when it changes; an optimistic tap bumps locally until the next feed read
  // catches up (same pattern the like counter used). Key the re-seed on the
  // VALUE — the prop is a fresh object each render, so depending on its identity
  // would loop forever.
  const rcKey = JSON.stringify(reactionCounts || {})
  const [counts, setCounts] = useState(reactionCounts || {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setCounts(reactionCounts || {})
  }, [rcKey])
  const bump = (emoji, delta) =>
    setCounts((c) => {
      const next = { ...c, [emoji]: Math.max(0, (c[emoji] || 0) + delta) }
      if (next[emoji] === 0) delete next[emoji]
      return next
    })

  const {
    reposts,
    reposted,
    pending,
    intent,
    inPagePay,
    notice,
    txidInput,
    setTxidInput,
    startReaction,
    verifyManual,
    cancel,
  } = useReactionPayment({
    endpointBase: '/api/feed/react',
    targetTxid,
    repostCount,
    repostedByViewer,
    onReacted: () => {}, // pill already bumped optimistically; server reconciles
    onReactFailed: (emoji) => bump(emoji, -1), // payment cancelled/failed → undo
  })

  const react = (emoji) => {
    if (pending) return
    bump(emoji, +1) // optimistic
    void startReaction('like', undefined, emoji)
  }

  // Pills: emojis with a count, most-used first.
  const pills = useMemo(
    () =>
      Object.entries(counts)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1]),
    [counts],
  )

  return (
    <div className="engage">
      <div className="engagebar">
        {/* The picker reveals on hover / focus of this wrap (CSS), like the old
            tip menu — a transparent bridge spans the gap so the pointer can
            travel from the button up into the picker without the hover dropping. */}
        <span className="reactwrap">
          <button
            type="button"
            className="reactbtn"
            disabled={Boolean(pending) && !inPagePay}
            aria-haspopup="menu"
            aria-label="React · 100 XEC"
            title="React · 100 XEC"
          >
            ☺+
          </button>
          {!pending ? (
            <div className="reactpicker" role="menu">
              {REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="reactopt"
                  role="menuitem"
                  onClick={() => react(emoji)}
                  title={`${emoji} · 100 XEC`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
        </span>

        <button
          type="button"
          className={`repostbtn${reposted ? ' on' : ''}`}
          onClick={() => void startReaction('repost')}
          disabled={Boolean(pending)}
          aria-pressed={reposted}
          aria-label="Repost"
          title={reposted ? 'You reposted this' : 'Repost · 100 XEC to the author'}
        >
          🔁 {reposts > 0 ? reposts : ''}
        </button>

        {canQuote ? (
          <button
            type="button"
            className="quotebtn"
            onClick={() => onQuote?.()}
            aria-label="Quote"
            title="Quote this post"
          >
            <span aria-hidden className="qico">❝</span> {quoteCount > 0 ? quoteCount : ''}
          </button>
        ) : null}
      </div>

      {/* Pills live OUTSIDE .engagebar (at the .engage display:contents level) with
          a high CSS order, so they sit to the RIGHT of the translate button rather
          than embedded between the action icons. */}
      {pills.length > 0 ? (
        <span className="reactpills">
          {pills.map(([emoji, n]) => (
            <button
              key={emoji}
              type="button"
              className="reactpill"
              disabled={Boolean(pending) && !inPagePay}
              onClick={() => react(emoji)}
              title={`React ${emoji} · 100 XEC`}
            >
              <span aria-hidden>{emoji}</span> {n}
            </button>
          ))}
        </span>
      ) : null}

      {pending && intent && !inPagePay ? (
        <div className="reactpay">
          <p className="poll">
            Confirm <strong>{intent.amountXec} XEC</strong> in Cashtab to{' '}
            {intent.emoji ? `react ${intent.emoji}` : pending === 'repost' ? 'repost' : 'react'}…
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
