'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { extractArticleSlug } from '@/lib/articleLinks'
import { formatReadingTimeLabel } from '@/lib/getReadingTime'

// Longer teasers are clamped inside the card; the full article is one tap away.
const TEASER_CLAMP_CHARS = 160

function priceLabel(priceXec) {
  const n = Number(priceXec)
  if (!Number.isFinite(n) || n <= 0) return 'Free'
  return `${n.toLocaleString()} XEC`
}

/**
 * A compact preview card for an on-site article linked from a feed post. Given
 * a server-resolved `card` it renders immediately; for a just-posted (optimistic)
 * entry that only carries the raw text, it derives the slug from `content` and
 * hydrates the card from /api/feed/article-card. Renders nothing until (and
 * unless) a real published article resolves.
 */
export default function ArticleCard({ card = null, content = '' }) {
  // A server-decorated post carries `card`; a just-posted (optimistic) one only
  // has the raw text, so we hydrate from the slug. Deriving `resolved` from the
  // prop (rather than mirroring it into state) keeps the only setState in the
  // async fetch callback.
  const [fetched, setFetched] = useState(null)

  useEffect(() => {
    if (card) return
    const slug = extractArticleSlug(content)
    if (!slug) return
    let alive = true
    fetch(`/api/feed/article-card?slug=${encodeURIComponent(slug)}`)
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

  const readingLabel = formatReadingTimeLabel(resolved.readingTimeMinutes)
  const infoParts = [
    resolved.author ? `@${resolved.author}` : null,
    readingLabel,
  ].filter(Boolean)

  return (
    <Link href={`/posts/${resolved.slug}`} className="artcard">
      <span className="artcard-tag">Article</span>
      <span className="artcard-title">{resolved.title || 'Read the article'}</span>
      {resolved.teaser ? (
        <span className="artcard-teaser">
          {resolved.teaser.length > TEASER_CLAMP_CHARS
            ? `${resolved.teaser.slice(0, TEASER_CLAMP_CHARS).trimEnd()}…`
            : resolved.teaser}
        </span>
      ) : null}
      <span className="artcard-meta">
        {infoParts.length > 0 ? `${infoParts.join(' · ')} · ` : ''}
        <span className="artcard-price">{priceLabel(resolved.priceXec)}</span>
      </span>
    </Link>
  )
}
