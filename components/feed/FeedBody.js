'use client'

import Link from 'next/link'
import { tokenizeMentions } from '@/lib/contentLinks'

/**
 * Render a plain-text feed body with the only inline link the feed allows:
 * @handle mentions become links to /@handle. All other text — including any
 * external URL — is emitted verbatim (JSX-escaped), so it reads as inert text.
 * On-site article/feed-post links are handled separately as embeds below the
 * body (they're stripped from this text upstream), not inline.
 */
export default function FeedBody({ text }) {
  const tokens = tokenizeMentions(text)
  if (tokens.length === 0) return null
  return tokens.map((t, i) =>
    t.type === 'mention' ? (
      <Link key={i} href={`/@${t.handle}`} className="mention" onClick={(e) => e.stopPropagation()}>
        {t.value}
      </Link>
    ) : (
      <span key={i}>{t.value}</span>
    ),
  )
}
