'use client'

import { useState, useTransition } from 'react'
import { createAssignment, dismissAssignment } from '@/app/admin/agent/actions'

/**
 * The commission box on /admin/agent: C names a subject (plus optional angle
 * notes) and the agent drafts it on its next scheduled run — with
 * AUTONOMOUS_TOPICS off this is the ONLY way essays get drafted. On success
 * the action revalidates the page, so the new commission appears in the list
 * below the form.
 */
export default function CommissionForm() {
  const [subject, setSubject] = useState('')
  const [notes, setNotes] = useState('')
  const [links, setLinks] = useState('')
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')
  const [pending, startTransition] = useTransition()

  const submit = () => {
    setError('')
    setFlash('')
    startTransition(async () => {
      const res = await createAssignment(subject, notes, links)
      if (res?.error) {
        setError(res.error)
      } else {
        setSubject('')
        setNotes('')
        setLinks('')
        setFlash('commissioned — the agent drafts it on its next run')
      }
    })
  }

  return (
    <div className="aq-comm">
      <input
        className="aq-comm-subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        maxLength={300}
        placeholder="Subject — what should Satoshi write about?"
        disabled={pending}
      />
      <textarea
        className="aq-comm-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={2000}
        rows={2}
        placeholder="Optional notes — the angle to take, what to avoid…"
        disabled={pending}
      />
      <textarea
        className="aq-comm-links"
        value={links}
        onChange={(e) => setLinks(e.target.value)}
        rows={2}
        placeholder={'Optional links — up to 3, one per line: articles or YouTube videos (the agent reads the captions). Podcast audio can’t be read — use the episode’s YouTube upload.'}
        disabled={pending}
      />
      <div className="aq-commrow">
        <button
          type="button"
          className="aq-btn aq-approve"
          disabled={pending || !subject.trim()}
          onClick={submit}
        >
          {pending ? 'filing…' : 'commission'}
        </button>
        {flash ? <span className="aq-flash">{flash} ✓</span> : null}
      </div>
      {error ? <div className="aq-error">{error}</div> : null}
    </div>
  )
}

/** Withdraw an open (or failed) commission. */
export function DismissAssignmentButton({ id }) {
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  return (
    <>
      <button
        type="button"
        className="aq-btn aq-dismiss"
        disabled={pending}
        onClick={() => {
          setError('')
          startTransition(async () => {
            const res = await dismissAssignment(id)
            if (res?.error) setError(res.error)
          })
        }}
      >
        {pending ? '…' : 'dismiss'}
      </button>
      {error ? <span className="aq-error">{error}</span> : null}
    </>
  )
}
