'use client'

import { useState } from 'react'
import { useTipPayment } from '@/components/feed/useTipPayment'

// Quick-pick tip amounts (XEC); the field takes any custom amount. Mirrors the
// feed like menu (EngagementBar) so tipping feels the same everywhere.
const TIP_PRESETS = [
  { xec: 100, label: '100' },
  { xec: 1000, label: '1K' },
  { xec: 10000, label: '10K' },
  { xec: 100000, label: '100K' },
  { xec: 1000000, label: '1M' },
]

/**
 * The "Tip" button for an author's profile, sitting next to Follow. A tip is an
 * on-chain paid action — 100% to the author, NO platform fee — that targets the
 * PERSON, not a post, and is repeatable. It reuses the same Pocket↔Cashtab
 * payment path and confirm poll as the feed like (via useTipPayment), and the
 * same hover/focus tip menu presentation (the .likewrap/.tipmenu classes from
 * the shared feed CSS, which the profile page already loads).
 *
 * `toAccountId` is the profile account being tipped; the caller only renders this
 * for OTHER people's profiles (never your own).
 */
export default function TipButton({ toAccountId }) {
  const {
    pending,
    intent,
    inPagePay,
    notice,
    txidInput,
    setTxidInput,
    tipError,
    justTipped,
    startTip,
    verifyManual,
    cancel,
  } = useTipPayment({ toAccountId })

  // Controlled value of the custom-tip field — pure UI state, kept local.
  const [tipAmount, setTipAmount] = useState('')

  return (
    <>
      <span className="likewrap tipwrap">
        <button
          type="button"
          className="tipbtn"
          disabled={pending && !inPagePay}
          aria-haspopup="menu"
          aria-label="Tip this author"
          title="Tip this author — 100% goes to them"
        >
          {pending ? 'Sending…' : justTipped ? 'Tipped ✓' : '💸 Tip'}
        </button>
        {!pending && !justTipped ? (
          <div className="tipmenu" role="menu">
            <p className="tiptitle">Tip this author · 100% goes to them</p>
            <div className="tippresets">
              {TIP_PRESETS.map(({ xec, label }) => (
                <button
                  key={xec}
                  type="button"
                  className="tippreset"
                  onClick={() => void startTip(xec)}
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
                    if (e.key === 'Enter') void startTip(tipAmount)
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
                onClick={() => void startTip(tipAmount)}
              >
                Tip
              </button>
            </div>
            {tipError ? <p className="notice">{tipError}</p> : null}
          </div>
        ) : null}
      </span>

      {pending && intent && !inPagePay ? (
        <div className="reactpay">
          <p className="poll">
            Confirm <strong>{intent.amountXec} XEC</strong> in Cashtab to tip this author…
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
    </>
  )
}
