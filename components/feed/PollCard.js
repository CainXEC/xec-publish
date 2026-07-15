'use client'
// =============================================================================
//  PollCard — the poll body for a feed post whose card_kind === 'poll'.
//
//  The question is rendered by FeedPost as the normal post text; this card sits
//  below it and owns the options + results. It reads live state from
//  /api/feed/poll/[txid] on mount (counts + this viewer's vote + eligibility) —
//  deliberately NOT baked into the cached feed, mirroring how likes/follows are
//  layered per-viewer. Eligible, not-yet-voted viewers see clickable options;
//  everyone else (voted, logged out, or not a handle-holder for a handle-only
//  poll) sees read-only result bars. The server is the authority on eligibility;
//  this just reflects it.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'

const pct = (n, total) => (total > 0 ? Math.round((n / total) * 100) : 0)

export default function PollCard({ post }) {
  const txid = post?.txid
  // Seed options from card_meta so the card paints instantly (labels don't need
  // the network); counts/vote fill in when the fetch lands.
  const seedOptions = Array.isArray(post?.card_meta?.options) ? post.card_meta.options : []
  const seedEligibility = post?.card_meta?.eligibility === 'handle' ? 'handle' : 'account'

  const [state, setState] = useState(null)
  const [voting, setVoting] = useState(null)
  const [note, setNote] = useState('')
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (!txid) return
    ;(async () => {
      try {
        const res = await fetch(`/api/feed/poll/${txid}`, { cache: 'no-store' })
        const data = await res.json()
        if (alive.current && data?.ok) setState(data)
      } catch {
        /* keep the seeded skeleton; a re-render or the next mount retries */
      }
    })()
  }, [txid])

  const vote = useCallback(
    async (optionId) => {
      if (!txid || voting) return
      setVoting(optionId)
      setNote('')
      try {
        const res = await fetch(`/api/feed/poll/${txid}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ optionId }),
        })
        const data = await res.json()
        if (!alive.current) return
        if (data?.ok) {
          setState(data)
        } else {
          setNote(data?.error || 'Could not record your vote.')
        }
      } catch {
        if (alive.current) setNote('Network hiccup — try again.')
      } finally {
        if (alive.current) setVoting(null)
      }
    },
    [txid, voting],
  )

  const options = state?.options?.length ? state.options : seedOptions
  const eligibility = state?.eligibility ?? seedEligibility
  const counts = state?.counts ?? {}
  const total = state?.total ?? 0
  const yourVote = state?.yourVote ?? null
  const loading = state === null

  // Show clickable options only to an eligible viewer who hasn't voted; everyone
  // else (voted / logged out / not a handle-holder) sees read-only results.
  const canVote = Boolean(state?.eligible) && !yourVote && !loading

  const audienceLabel =
    eligibility === 'handle' ? 'Handle-holders only' : 'Open to all members'
  const votesLabel = `${total.toLocaleString()} vote${total === 1 ? '' : 's'}`

  let hint = ''
  if (!loading && !yourVote) {
    if (!state?.loggedIn) hint = 'Log in to vote.'
    else if (!state?.eligible) hint = 'Only handle-holders can vote in this poll.'
  }

  // Stop clicks inside the poll from bubbling up to the post's open-thread
  // handler — voting shouldn't navigate.
  const swallow = (e) => e.stopPropagation()

  return (
    <div className="pollcard" onClick={swallow}>
      {canVote ? (
        <div className="poll-opts">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              className="poll-opt"
              disabled={Boolean(voting)}
              onClick={() => void vote(o.id)}
            >
              <span className="poll-opt-text">{o.text}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="poll-results">
          {options.map((o) => {
            const c = counts[o.id] ?? 0
            const p = pct(c, total)
            const mine = o.id === yourVote
            return (
              <div key={o.id} className={`poll-res${mine ? ' mine' : ''}`}>
                <div className="poll-res-fill" style={{ width: `${p}%` }} aria-hidden />
                <span className="poll-res-text">
                  {o.text}
                  {mine ? ' ✓' : ''}
                </span>
                <span className="poll-res-pct">{p}%</span>
              </div>
            )
          })}
        </div>
      )}

      <div className="poll-meta">
        <span>{votesLabel}</span>
        <span className="poll-dot" aria-hidden>
          ·
        </span>
        <span>{audienceLabel}</span>
        {hint ? <span className="poll-hint">{hint}</span> : null}
      </div>
      {note ? <p className="poll-note">{note}</p> : null}
    </div>
  )
}
