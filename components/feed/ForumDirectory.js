'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import CreateForum from '@/components/feed/CreateForum'
import { loadPendingForum } from '@/lib/forums/pendingForumCreate'
import { confirmForumInBackground } from '@/lib/forums/confirmForumInBackground'

/**
 * The Forums tab: a directory of every forum + a "Create forum" panel. Not a post
 * feed — each forum links to /f/<slug>, where its own posts live. Creating a forum
 * is gated to @handle-holders (the server enforces; a non-holder just gets a 403
 * inside the create flow).
 */
export default function ForumDirectory({ signedIn }) {
  const [forums, setForums] = useState(null) // null = loading
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  // Mobile shows the create flow in a bottom sheet (opened by the floating
  // pen-nib button); desktop keeps it inline under the header.
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia('(max-width:600px)')
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/forums', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(data.error || 'Could not load forums.')
        setForums([])
        return
      }
      setError('')
      setForums(data.forums || [])
    } catch {
      setError('Could not load forums.')
      setForums([])
    }
  }, [])

  // Fetch the directory on mount (and after a create). load()'s first setState is
  // behind an await, so this is a real external fetch, not a synchronous cascade.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!cancelled) await load()
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  const onCreated = useCallback(
    (forum) => {
      setCreating(false)
      // Optimistically show it at the top, then reload for the canonical list.
      setForums((prev) => {
        const row = {
          slug: forum.slug,
          title: forum.title,
          description: forum.description,
          postCount: forum.post_count ?? 0,
          runner: null,
        }
        return [row, ...(prev || []).filter((f) => f.slug !== forum.slug)]
      })
      void load()
    },
    [load],
  )

  // Recovery: if a forum was paid for but its confirm was interrupted (unmount /
  // navigate-away / mobile page-reload after Cashtab), the payload is stashed in
  // localStorage — finish it here, the natural place the user comes to look for
  // their forum. The confirm is idempotent, so this is safe to fire on every
  // Forums visit; it self-clears the stash on success (or once it gives up).
  const resumedRef = useRef(false)
  useEffect(() => {
    if (resumedRef.current || !signedIn) return
    const pending = loadPendingForum()
    if (!pending) return
    resumedRef.current = true
    confirmForumInBackground(pending, { onCreated })
  }, [signedIn, onCreated])

  return (
    <div className="forumdir">
      <div className="forumdir-head">
        <p className="forumdir-sub">
          Topic communities. Post, reply, and react inside a forum — the runner earns the 6%
          engagement fee.
        </p>
        {signedIn ? (
          <div className="forumdir-create">
            <button type="button" className="btn" onClick={() => setCreating((v) => !v)}>
              {creating ? 'Close' : 'Create forum'}
            </button>
          </div>
        ) : null}
      </div>

      {creating && !isMobile ? (
        <CreateForum onCreated={onCreated} onCancel={() => setCreating(false)} />
      ) : null}

      {error ? <div className="error">{error}</div> : null}

      {forums === null ? (
        <div className="empty">Loading…</div>
      ) : forums.length === 0 ? (
        <div className="empty">No forums yet. {signedIn ? 'Create the first one.' : ''}</div>
      ) : (
        <ul className="panel forumlist">
          {forums.map((f) => (
            <li key={f.slug} className="forumrow">
              <Link href={`/f/${f.slug}`} className="forumrow-link">
                <div className="forumrow-main">
                  <span className="forumrow-name">/f/{f.slug}</span>
                  <span className="forumrow-titletext">{f.title}</span>
                </div>
                {f.description ? <p className="forumrow-desc">{f.description}</p> : null}
                <div className="forumrow-meta">
                  <span>
                    {f.postCount} post{f.postCount === 1 ? '' : 's'}
                  </span>
                  {f.runner ? <span className="forumrow-runner">runner {f.runner}</span> : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Mobile: the same floating pen-nib button the feed uses, here creating a
          forum (opens the create flow as a bottom sheet). CSS-hidden ≥600px, where
          the header's "Create forum" button takes over. Only for signed-in users. */}
      {signedIn ? (
        <button
          type="button"
          className="feed-fab"
          aria-label="Create forum"
          onClick={() => setCreating(true)}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path className="pnib" d="M4 20l1.2-4L15 6.2l2.8 2.8L8 18.8 4 20z" />
            <path className="pcut" d="M5.2 16L8 18.8" />
            <path className="pnib" d="M15 6.2l2-2a2 2 0 012.8 2.8l-2 2" />
          </svg>
        </button>
      ) : null}

      {creating && isMobile ? (
        <div className="feed-sheet-backdrop" onClick={() => setCreating(false)}>
          <div className="feed-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="feed-sheet-head">
              <button
                type="button"
                className="feed-sheet-close"
                aria-label="Close"
                onClick={() => setCreating(false)}
              >
                ✕
              </button>
            </div>
            <CreateForum onCreated={onCreated} onCancel={() => setCreating(false)} />
          </div>
        </div>
      ) : null}
    </div>
  )
}
