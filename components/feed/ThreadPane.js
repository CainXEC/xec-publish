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
import FeedThreadClient from '@/components/feed/FeedThreadClient'

// Wrap an optimistic post (e.g. a just-made quote) as a thread payload so the
// pane can render it INSTANTLY — no ancestors/replies yet; the background fetch
// reconciles those in. Marked __seeded so the fetch's success can remount the
// thread with the real, fully-decorated data.
function seedToThread(seed) {
  return {
    __seeded: true,
    post: seed,
    ancestors: [],
    replies: [],
    viewerAccountId: seed.author_account_id ?? null, // it's the poster's own post
    isAuthor: true,
    forumSlug: null,
  }
}

export default function ThreadPane({ txid, seed = null, onClose, onOpenThread, onQuoted }) {
  const hasSeed = seed && seed.txid === txid
  const [state, setState] = useState(() =>
    hasSeed ? { loading: false, data: seedToThread(seed) } : { loading: true },
  )

  useEffect(() => {
    let alive = true
    const seeded = seed && seed.txid === txid
    // Seeded (an optimistic quote/post): show it NOW; the fetch below swaps in the
    // real thread once its DB row lands. Un-seeded: normal loader.
    setState(seeded ? { loading: false, data: seedToThread(seed) } : { loading: true })
    // A JUST-posted thread is broadcast optimistically, but its DB row is written
    // a beat later by the background confirm once Chronik indexes the tx (~2–3s).
    // So a not-found is RETRIED briefly before it's treated as real. When seeded we
    // keep showing the seed the whole time (and never flash an error); un-seeded, a
    // genuinely missing thread waits out the window and then shows the error.
    const RETRY_MS = 900
    const MAX_ATTEMPTS = seeded ? 12 : 6 // ~11s vs ~5s
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
          setState({ loading: false, data: j }) // real data → remounts over the seed
          return
        }
        if (res.status === 404 && attempt < MAX_ATTEMPTS) {
          attempt += 1
          setTimeout(load, RETRY_MS)
          return
        }
        // Exhausted: keep the seed on screen if we have one; else surface the error.
        if (!seeded) setState({ loading: false, error: j.error || 'Post unavailable.' })
      } catch {
        if (!alive) return
        if (attempt < MAX_ATTEMPTS) {
          attempt += 1
          setTimeout(load, RETRY_MS)
          return
        }
        if (!seeded) setState({ loading: false, error: 'Post unavailable — try again.' })
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [txid, seed])

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
      {/* No top "Copy link" here — the post's own meta row carries the copy-link
          icon, so a second one in the bar was redundant. */}
      <div className="hr-bar">
        <button type="button" className="hr-back" onClick={onClose}>← Feed</button>
      </div>

      {state.loading ? (
        <p className="hr-state">Pulling the thread…</p>
      ) : state.error ? (
        <p className="hr-state">{state.error}</p>
      ) : (
        <FeedThreadClient
          key={`${txid}${d.__seeded ? '-seed' : ''}`}
          embedded
          initialPost={d.post}
          initialAncestors={d.ancestors}
          initialReplies={d.replies}
          viewerAccountId={d.viewerAccountId}
          isAuthor={d.isAuthor}
          forumSlug={d.forumSlug ?? null}
          onOpenThread={onOpenThread}
          onQuoted={onQuoted}
        />
      )}
    </div>
  )
}
