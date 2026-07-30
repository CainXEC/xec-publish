'use client'

import { useState } from 'react'
import { useReactionPayment } from '@/components/feed/useReactionPayment'

// Quick-pick tip amounts (XEC) shown in the like menu; the field takes any custom
// amount. Labels abbreviate the thousands.
const TIP_PRESETS = [
  { xec: 100, label: '100' },
  { xec: 1000, label: '1K' },
  { xec: 10000, label: '10K' },
  { xec: 100000, label: '100K' },
  { xec: 1000000, label: '1M' },
]

/**
 * Like / Repost / Quote controls for a feed post. Likes and reposts are on-chain
 * paid actions (94/6 to the post's author/platform), so tapping one opens Cashtab
 * and then polls /api/feed/react/confirm until the payment is detected. The Like
 * button doubles as a tip: it opens a small menu to pick a preset or type any
 * amount (100 XEC minimum), so a like can send the author more than the floor.
 * Repost stays a flat 100 XEC. There is no undo in v1: once you've liked or
 * reposted, the button is shown as "on" and further taps are no-ops. Quote is
 * delegated to the parent (which opens a composer) via onQuote.
 *
 * The reaction flow itself lives in useReactionPayment (shared with CommentLike);
 * this component is just the feed-post presentation of it.
 */
export default function EngagementBar({
  targetTxid,
  likeCount = 0,
  repostCount = 0,
  quoteCount = 0,
  likedByViewer = false,
  repostedByViewer = false,
  canQuote = true,
  onQuote,
}) {
  const {
    likes,
    liked,
    reposts,
    reposted,
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
    endpointBase: '/api/feed/react',
    targetTxid,
    likeCount,
    repostCount,
    likedByViewer,
    repostedByViewer,
  })

  // Controlled value of the custom-tip field — pure UI state, kept local.
  const [tipAmount, setTipAmount] = useState('')
  const isLike = pending === 'like'

  return (
    <div className="engage">
      <div className="engagebar">
        <span className="likewrap">
          <button
            type="button"
            className={`likebtn${liked ? ' on' : ''}`}
            disabled={Boolean(pending) && !inPagePay}
            aria-pressed={liked}
            aria-haspopup="menu"
            aria-label={liked ? 'Liked' : 'Like'}
            title={liked ? 'You liked this' : 'Tip the author'}
          >
            <span aria-hidden className="likeico">{liked ? '♥' : '♡'}</span> {likes > 0 ? likes : ''}
          </button>
          {!liked && !pending ? (
            <div className="tipmenu" role="menu">
              <p className="tiptitle">Tip the author</p>
              <div className="tippresets">
                {TIP_PRESETS.map(({ xec, label }) => (
                  <button
                    key={xec}
                    type="button"
                    className="tippreset"
                    onClick={() => void startReaction('like', xec)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="tiprow">
                <div className="tipfield">
                  <input
                    className="tipinput"
                    value={tipAmount}
                    onChange={(e) => setTipAmount(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void startReaction('like', tipAmount)
                    }}
                    placeholder="Custom"
                    inputMode="numeric"
                    spellCheck={false}
                    aria-label="Custom tip amount in XEC"
                  />
                  <span className="tipunit">XEC</span>
                </div>
                <button
                  type="button"
                  className="tipgo"
                  onClick={() => void startReaction('like', tipAmount)}
                >
                  Tip
                </button>
              </div>
              {tipError ? <p className="notice">{tipError}</p> : null}
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

      {pending && intent && !inPagePay ? (
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
