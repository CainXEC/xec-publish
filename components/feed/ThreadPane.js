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
    // A JUST-posted thread (e.g. you quote a post and jump to your new quote) is
    // broadcast optimistically, but its DB row is written a beat later by the
    // background confirm once Chronik indexes the tx (~2–3s). Opening the pane in
    // that window would 404 → "Post not found", so a not-found is RETRIED briefly
    // before it's treated as real. A genuinely missing thread just waits out the
    // window (a few seconds) and then shows the error.
    const RETRY_MS = 900
    const MAX_ATTEMPTS = 6 // ~5s, comfortably past a normal confirm
    let attempt = 0
    const load = async () => {
      if (!alive) return
      try {
        const res = await fetch(`/api/feed/thread/${encodeURIComponent(txid)}`, {
          cache: 'no-store',
        })
        const j = await res.json().catch(() => ({}))
        if (!alive) return
        if (j.ok) {
          setState({ loading: false, data: j })
          return
        }
        if (res.status === 404 && attempt < MAX_ATTEMPTS) {
          attempt += 1
          setTimeout(load, RETRY_MS)
          return
        }
        setState({ loading: false, error: j.error || 'Post unavailable.' })
      } catch {
        if (!alive) return
        if (attempt < MAX_ATTEMPTS) {
          attempt += 1
          setTimeout(load, RETRY_MS)
          return
        }
        setState({ loading: false, error: 'Post unavailable — try again.' })
      }
    }
    void load()
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
        <button type="button" className="hr-back" onClick={onClose}>← Feed</button>
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
          forumSlug={d.forumSlug ?? null}
          onOpenThread={onOpenThread}
        />
      )}
    </div>
  )
}
