'use client'

import { useMemo, useState } from 'react'
import { useReactionPayment } from '@/components/feed/useReactionPayment'
import { REACTIONS } from '@/lib/reactions'

/**
 * Emoji reactions for a single article comment — the comment analogue of the
 * feed's EngagementBar (no repost/quote). Tapping an emoji sends a flat 100 XEC
 * (94/6 to the commenter, or 100% to the platform for 👎) via the shared
 * useReactionPayment flow pointed at /api/comments/react, and the comment carries
 * per-emoji pill counts. Multi-react: you can react as many times as you pay.
 * On your OWN comment the pills are read-only (you can't react to yourself).
 */
export default function CommentReactions({ targetTxid, reactionCounts = {}, isOwn = false }) {
  // Per-emoji counts shown as pills. Seeded from the server truth and re-seeded
  // when it changes — using the "adjust state when a prop changes during render"
  // pattern (keyed on the VALUE, since the prop is a fresh object each render), so
  // an optimistic tap bumps locally until the next server read catches up.
  const rcKey = JSON.stringify(reactionCounts || {})
  const [counts, setCounts] = useState(reactionCounts || {})
  const [seededKey, setSeededKey] = useState(rcKey)
  if (rcKey !== seededKey) {
    setSeededKey(rcKey)
    setCounts(reactionCounts || {})
  }
  const bump = (emoji, delta) =>
    setCounts((c) => {
      const next = { ...c, [emoji]: Math.max(0, (c[emoji] || 0) + delta) }
      if (next[emoji] === 0) delete next[emoji]
      return next
    })

  const {
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
    endpointBase: '/api/comments/react',
    targetTxid,
    onReacted: () => {}, // pill already bumped optimistically; server reconciles
    onReactFailed: (emoji) => bump(emoji, -1), // payment cancelled/failed → undo
  })

  const react = (emoji) => {
    if (pending || isOwn) return
    bump(emoji, +1) // optimistic
    void startReaction('like', undefined, emoji)
  }

  const pills = useMemo(
    () =>
      Object.entries(counts)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1]),
    [counts],
  )

  return (
    <span className="creact">
      {!isOwn ? (
        // The picker reveals on HOVER / focus of this wrap (CSS), like the feed —
        // a transparent bridge spans the gap so the pointer can travel from the
        // button up into the picker without the hover dropping.
        <span className="creactwrap">
          <button
            type="button"
            className="creactbtn"
            disabled={Boolean(pending) && !inPagePay}
            aria-haspopup="menu"
            aria-label="React · 100 XEC"
            title="React · 100 XEC"
          >
            ☺+
          </button>
          {!pending ? (
            <div className="creactpicker" role="menu">
              {REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="creactopt"
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
      ) : null}

      {pills.map(([emoji, n]) => (
        <button
          key={emoji}
          type="button"
          className="creactpill"
          disabled={isOwn || (Boolean(pending) && !inPagePay)}
          onClick={() => react(emoji)}
          aria-label={isOwn ? `${emoji} reactions` : `React ${emoji}`}
          title={isOwn ? `${emoji} ${n}` : `React ${emoji} · 100 XEC`}
        >
          {emoji} {n}
        </button>
      ))}

      {pending && intent && !inPagePay ? (
        <div className="clikepay">
          <p>
            Confirm <strong>{intent.amountXec} XEC</strong> in Cashtab to react
            {intent.emoji ? ` ${intent.emoji}` : ''}…
          </p>
          <details className="clikepay-manual">
            <summary>Cashtab didn&apos;t open, or already paid?</summary>
            <div style={{ textAlign: 'center', margin: '8px 0 0' }}>
              <a href={intent.cashtabUrl} target="_blank" rel="noreferrer">
                Open in Cashtab
              </a>
            </div>
            <div className="clikepay-row">
              <input
                value={txidInput}
                onChange={(e) => setTxidInput(e.target.value)}
                placeholder="Paste the transaction ID"
                spellCheck={false}
              />
              <button type="button" onClick={() => void verifyManual()}>
                Verify
              </button>
            </div>
          </details>
          {notice ? <p className="clike-notice">{notice}</p> : null}
          <button type="button" className="clike-cancel" onClick={cancel}>
            Cancel
          </button>
        </div>
      ) : notice ? (
        <p className="clike-notice">{notice}</p>
      ) : null}
    </span>
  )
}
