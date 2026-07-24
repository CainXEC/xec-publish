'use client'

import Link from 'next/link'
import { tokenizeContent } from '@/lib/contentLinks'

/**
 * Render a plain-text feed body with the inline links the feed allows:
 * @handle mentions link to /@handle, and any same-site URL (proofofwriting.com)
 * links to its relative path. All other text — including any EXTERNAL URL — is
 * emitted verbatim (JSX-escaped), so it reads as inert text. The FIRST on-site
 * article/feed-post link is handled separately as an embed below the body (it's
 * stripped from this text upstream); anything left here linkifies inline.
 */
export default function FeedBody({ text }) {
  const tokens = tokenizeContent(text)
  if (tokens.length === 0) return null
  return tokens.map((t, i) => {
    if (t.type === 'mention') {
      return (
        <Link key={i} href={`/@${t.handle}`} className="mention" onClick={(e) => e.stopPropagation()}>
          {t.value}
        </Link>
      )
    }
    if (t.type === 'link') {
      return (
        <Link key={i} href={t.href} className="mention" onClick={(e) => e.stopPropagation()}>
          {t.value}
        </Link>
      )
    }
    return <span key={i}>{t.value}</span>
  })
}
