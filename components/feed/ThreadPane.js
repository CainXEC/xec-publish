'use client'
// =============================================================================
//  ThreadPane.js — a feed thread open in the home page's center column.
//
//  Same pattern as the article reading pane (HomeReader): pure client state,
//  the feed stays mounted underneath, and the pane hosts the REAL thread
//  component in embedded mode — ancestors, replies, the reply composer and
//  engagement bar all work exactly as on the thread page, because they ARE
//  the thread page's component. Clicking an ancestor, a reply, or finishing
//  a quote swaps the pane to that thread in place.
// =============================================================================

import { useEffect, useState } from 'react'
import CopyLinkButton from '@/components/feed/CopyLinkButton'
import FeedThreadClient from '@/components/feed/FeedThreadClient'

export default function ThreadPane({ txid, onClose, onOpenThread }) {
  const [state, setState] = useState({ loading: true })

  useEffect(() => {
    let alive = true
    setState({ loading: true })
    ;(async () => {
      try {
        const res = await fetch(`/api/feed/thread/${encodeURIComponent(txid)}`, {
          cache: 'no-store',
        })
        const j = await res.json().catch(() => ({}))
        if (!alive) return
        setState(j.ok ? { loading: false, data: j } : { loading: false, error: j.error || 'Post unavailable.' })
      } catch {
        if (alive) setState({ loading: false, error: 'Post unavailable — try again.' })
      }
    })()
    return () => {
      alive = false
    }
  }, [txid])

  // Esc turns back to the feed, matching the article pane.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const d = state.data

  return (
    <div className="homereader">
      <div className="hr-bar">
        <button type="button" className="hr-back" onClick={onClose}>← The feed</button>
        <CopyLinkButton path={`/feed/${txid}`} />
      </div>

      {state.loading ? (
        <p className="hr-state">Pulling the thread…</p>
      ) : state.error ? (
        <p className="hr-state">{state.error}</p>
      ) : (
        <FeedThreadClient
          key={txid}
          embedded
          initialPost={d.post}
          initialAncestors={d.ancestors}
          initialReplies={d.replies}
          viewerAccountId={d.viewerAccountId}
          isAuthor={d.isAuthor}
          onOpenThread={onOpenThread}
        />
      )}
    </div>
  )
}
