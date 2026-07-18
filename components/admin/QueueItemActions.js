'use client'

import { useState, useTransition } from 'react'
import { approveQueueItem, vetoQueueItem } from '@/app/admin/agent/actions'

/**
 * Approve / veto controls for one pending agent_queue item.
 *
 * Approve is two-step (arm → confirm): approval hands the essay to the agent's
 * next publish run, which spends real XEC on-chain, so a single misclick must
 * never do it. Veto requires a WRITTEN reason (RULES §7 — unwritten taste
 * doesn't compound): the button stays disabled until the reason is non-empty,
 * and the server action re-checks so the DB can never hold a reasonless veto.
 * On success the action revalidates /admin/agent, so the card leaves the
 * pending list by itself; the local `done` line is just the in-between beat.
 */
export default function QueueItemActions({ id }) {
  const [mode, setMode] = useState('idle') // idle | arm | veto
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [pending, startTransition] = useTransition()

  const submit = (kind) => {
    setError('')
    startTransition(async () => {
      const res =
        kind === 'approve' ? await approveQueueItem(id) : await vetoQueueItem(id, reason)
      if (res?.error) {
        setError(res.error)
      } else {
        setDone(kind === 'approve' ? 'approved — publishes on the agent’s next run' : 'vetoed')
        // Nudge the topbar chip so its pending count doesn't sit stale until
        // the next 5-minute poll.
        window.dispatchEvent(new CustomEvent('agent-queue-changed'))
      }
    })
  }

  if (done) return <div className="aq-done">{done} ✓</div>

  return (
    <div className="aq-actions">
      {mode === 'idle' ? (
        <>
          <button type="button" className="aq-btn aq-approve" onClick={() => setMode('arm')}>
            approve
          </button>
          <button type="button" className="aq-btn aq-vetobtn" onClick={() => setMode('veto')}>
            veto…
          </button>
        </>
      ) : null}

      {mode === 'arm' ? (
        <>
          <span className="aq-armnote">
            the agent will publish this on-chain (paid) on its next run —
          </span>
          <button
            type="button"
            className="aq-btn aq-approve"
            disabled={pending}
            onClick={() => submit('approve')}
          >
            {pending ? 'approving…' : 'confirm approve'}
          </button>
          <button
            type="button"
            className="aq-btn"
            disabled={pending}
            onClick={() => setMode('idle')}
          >
            cancel
          </button>
        </>
      ) : null}

      {mode === 'veto' ? (
        <div className="aq-vetoform">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this a veto? Written reasons compound — the agent reads them."
            maxLength={2000}
            disabled={pending}
            autoFocus
          />
          <div className="aq-vetorow">
            <button
              type="button"
              className="aq-btn aq-vetobtn"
              disabled={pending || !reason.trim()}
              onClick={() => submit('veto')}
            >
              {pending ? 'vetoing…' : 'confirm veto'}
            </button>
            <button
              type="button"
              className="aq-btn"
              disabled={pending}
              onClick={() => setMode('idle')}
            >
              cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className="aq-error">{error}</div> : null}
    </div>
  )
}
