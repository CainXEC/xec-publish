'use client'

import { useState, useTransition } from 'react'
import { dismissMintAlert } from '@/app/admin/mints/actions'

/**
 * Dismiss control for one unclaimed-payment alert on /admin/mints. Two-step
 * (open → write a note → confirm): the note is required, and the server action
 * re-checks, so the record always says why the payment was left alone. Closing
 * the alert never moves any money.
 */
export default function DismissMintAlert({ txid }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [pending, startTransition] = useTransition()

  const submit = () => {
    setError('')
    startTransition(async () => {
      const res = await dismissMintAlert(txid, note)
      if (res?.error) {
        setError(res.error)
      } else {
        setDone(true)
        // Nudge the bell so its count drops now, not on the next poll.
        window.dispatchEvent(new CustomEvent('mint-alerts-changed'))
      }
    })
  }

  if (done) return <div className="aq-done">dismissed ✓</div>

  if (!open) {
    return (
      <div className="aq-actions">
        <button type="button" className="aq-btn" onClick={() => setOpen(true)}>
          dismiss…
        </button>
      </div>
    )
  }

  return (
    <div className="aq-actions">
      <div className="aq-vetoform">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What was this payment, or how was it settled? (e.g. my own top-up · refunded by hand in tx …)"
          maxLength={1000}
          autoFocus
        />
        <div className="aq-vetorow">
          <button type="button" className="aq-btn" disabled={pending || !note.trim()} onClick={submit}>
            {pending ? 'saving…' : 'dismiss alert'}
          </button>
          <button type="button" className="aq-btn" disabled={pending} onClick={() => setOpen(false)}>
            cancel
          </button>
        </div>
        {error ? <div className="aq-error">{error}</div> : null}
      </div>
    </div>
  )
}
