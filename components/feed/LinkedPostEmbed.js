'use client'

import { useEffect, useState } from 'react'
import QuotedEmbed from '@/components/feed/QuotedEmbed'
import { extractFeedPostTxid } from '@/lib/contentLinks'

/**
 * The quoted embed for a pasted on-site feed-post link. A server-rendered post
 * carries the resolved target in `linkedPost` (object, or null if missing/deleted)
 * and renders immediately. A just-posted (optimistic) entry has no such field
 * (undefined), so we hydrate the preview from the txid in `content` via
 * /api/feed/linked-post — mirroring how ArticleCard hydrates its card. Renders
 * nothing while that fetch is in flight, so there's no "unavailable" flash.
 */
export default function LinkedPostEmbed({ linkedPost, content }) {
  const needFetch = linkedPost === undefined
  const [fetched, setFetched] = useState(undefined)

  useEffect(() => {
    if (!needFetch) return
    const txid = extractFeedPostTxid(content)
    if (!txid) return
    let alive = true
    fetch(`/api/feed/linked-post?txid=${txid}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive) setFetched(j?.ok ? j.post ?? null : null)
      })
      .catch(() => {
        if (alive) setFetched(null)
      })
    return () => {
      alive = false
    }
  }, [needFetch, content])

  if (!needFetch) return <QuotedEmbed post={linkedPost} />
  // Optimistic: nothing until the fetch resolves (object or null).
  if (fetched === undefined) return null
  return <QuotedEmbed post={fetched} />
}
