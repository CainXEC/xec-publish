'use client'

import Link from 'next/link'
import { tokenizeContent } from '@/lib/contentLinks'

/**
 * Render a plain-text feed body with the inline links the feed allows:
 * @handle mentions link to /@handle, same-site URLs (proofofwriting.com) link to
 * their relative path, and an X/Twitter URL is a live OUTBOUND link (opens the
 * tweet in a new tab — the one external host allowed, no embed). All other text —
 * including any other EXTERNAL URL — is emitted verbatim (JSX-escaped), so it
 * reads as inert text. The FIRST on-site article/feed-post link is handled
 * separately as an embed below the body (it's stripped from this text upstream);
 * anything left here linkifies inline.
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
    if (t.type === 'xlink') {
      // Outbound X/Twitter link — new tab, and rel guards against tab-nabbing +
      // referrer/SEO leakage. The href is always an absolute http(s) URL.
      return (
        <a
          key={i}
          href={t.href}
          className="mention extlink"
          target="_blank"
          rel="noopener noreferrer nofollow"
          onClick={(e) => e.stopPropagation()}
        >
          {t.value}
        </a>
      )
    }
    return <span key={i}>{t.value}</span>
  })
}
