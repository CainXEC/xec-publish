'use client'

import { useState } from 'react'
import { useReactionPayment } from '@/components/feed/useReactionPayment'

// Same quick-pick tips as the feed like; the field takes any custom amount.
const TIP_PRESETS = [
  { xec: 100, label: '100' },
  { xec: 1000, label: '1K' },
  { xec: 10000, label: '10K' },
  { xec: 100000, label: '100K' },
  { xec: 1000000, label: '1M' },
]

/**
 * Like control for a single article comment. A comment like is the same paid,
 * on-chain reaction as a feed-post like (94/6 to the commenter), so this reuses
 * the shared useReactionPayment flow pointed at /api/comments/react. Like-only —
 * comments have no repost/quote. The heart opens a small tip popover (100 XEC
 * floor or a custom amount); once liked it just shows the filled heart + count.
 * There is no undo, matching the feed.
 */
export default function CommentLike({ targetTxid, likeCount = 0, likedByViewer = false }) {
  const {
    likes,
    liked,
    pending,
    intent,
    inPagePay,
    notice,
    txidInput,
    setTxidInput,
    tipError,
    startReaction,
    verifyManual,
    cancel,
  } = useReactionPayment({
    endpointBase: '/api/comments/react',
    targetTxid,
    likeCount,
    likedByViewer,
  })

  const [open, setOpen] = useState(false)
  const [tipAmount, setTipAmount] = useState('')

  const like = (xec) => {
    setOpen(false)
    void startReaction('like', xec)
  }

  return (
    <span className="clike">
      <button
        type="button"
        className={`clikebtn${liked ? ' on' : ''}`}
        disabled={Boolean(pending) && !inPagePay}
        aria-pressed={liked}
        aria-haspopup={liked ? undefined : 'menu'}
        aria-expanded={liked ? undefined : open}
        onClick={() => {
          if (!liked && !pending) setOpen((o) => !o)
        }}
        title={liked ? 'You liked this comment' : 'Tip the commenter'}
      >
        <span aria-hidden className="clikeico">{liked ? '♥' : '♡'}</span>
        {likes > 0 ? ` ${likes}` : ''}
      </button>

      {open && !liked && !pending ? (
        <div className="cliketip" role="menu">
          <p className="cliketip-title">Tip the commenter</p>
          <div className="cliketip-presets">
            {TIP_PRESETS.map(({ xec, label }) => (
              <button
                key={xec}
                type="button"
                className="cliketip-preset"
                onClick={() => like(xec)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="cliketip-row">
            <input
              className="cliketip-input"
              value={tipAmount}
              onChange={(e) => setTipAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') like(tipAmount)
              }}
              placeholder="Custom"
              inputMode="numeric"
              spellCheck={false}
              aria-label="Custom tip amount in XEC"
            />
            <span className="cliketip-unit">XEC</span>
            <button type="button" className="cliketip-go" onClick={() => like(tipAmount)}>
              Tip
            </button>
          </div>
          {tipError ? <p className="clike-notice">{tipError}</p> : null}
        </div>
      ) : null}

      {pending && intent && !inPagePay ? (
        <div className="clikepay">
          <p>
            Confirm <strong>{intent.amountXec} XEC</strong> in Cashtab to like this comment…
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
