'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { extractForumSlug } from '@/lib/forumLinks'

// Longer descriptions are clamped inside the card; the full forum is one tap away.
const DESC_CLAMP_CHARS = 160

/**
 * A compact preview card for an on-site forum linked from a feed post. Given a
 * server-resolved `card` it renders immediately; for a just-posted (optimistic)
 * entry that only carries the raw text, it derives the slug from `content` and
 * hydrates from /api/feed/forum-card. Mirrors ArticleCard. Renders nothing until
 * (and unless) a real forum resolves.
 */
export default function ForumCard({ card = null, content = '' }) {
  const [fetched, setFetched] = useState(null)

  useEffect(() => {
    if (card) return
    const slug = extractForumSlug(content)
    if (!slug) return
    let alive = true
    fetch(`/api/feed/forum-card?slug=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j?.ok && j.card) setFetched(j.card)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [card, content])

  const resolved = card ?? fetched
  if (!resolved) return null

  const posts = resolved.postCount ?? 0
  const metaParts = [
    `${posts.toLocaleString()} post${posts === 1 ? '' : 's'}`,
    resolved.runner ? `runner ${resolved.runner}` : null,
  ].filter(Boolean)

  return (
    <Link href={`/f/${resolved.slug}`} className="artcard forumembed">
      <span className="artcard-tag">Forum</span>
      <span className="artcard-title">
        /f/{resolved.slug}
        {resolved.title ? ` · ${resolved.title}` : ''}
      </span>
      {resolved.description ? (
        <span className="artcard-teaser">
          {resolved.description.length > DESC_CLAMP_CHARS
            ? `${resolved.description.slice(0, DESC_CLAMP_CHARS).trimEnd()}…`
            : resolved.description}
        </span>
      ) : null}
      <span className="artcard-meta">{metaParts.join(' · ')}</span>
    </Link>
  )
}
