'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import CreateForum from '@/components/feed/CreateForum'

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

      {creating ? (
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
    </div>
  )
}
