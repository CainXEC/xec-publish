const defaultSiteUrl = 'https://www.proofofwriting.com'

function getSiteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || defaultSiteUrl
}

/**
 * Compact a byline for a title/card: a live "@handle" is shown as-is; a raw
 * eCash address (the fallback for handle-less accounts) is elided to
 * `ecash:qq…wxyz` so it doesn't blow out the card or the <title>.
 */
export function shortenIdentity(identity) {
  const s = typeof identity === 'string' ? identity.trim() : ''
  if (!s) return ''
  if (s.startsWith('@')) return s
  if (s.length <= 22) return s
  return `${s.slice(0, 14)}…${s.slice(-4)}`
}

/** Build the absolute /api/og/feed image URL for a feed post's share card. */
export function buildFeedOgImageUrl({ text, author, action, id }) {
  const url = new URL('/api/og/feed', getSiteUrl())
  const clipped = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 280)
  url.searchParams.set('text', clipped)
  if (author) url.searchParams.set('author', author)
  if (action != null && action !== '') url.searchParams.set('action', String(action))
  // A short txid slice keys the CDN cache per post and lets a single card be
  // busted without touching the others.
  if (id) url.searchParams.set('id', id)
  return url.toString()
}

/**
 * OpenGraph/Twitter metadata for a single feed post permalink (/feed/[txid]).
 * `post` is the shape returned by getFeedPostForCard: { txid, action, content,
 * handle, displayIdentity }. Byline resolves the same way as the in-app feed —
 * @handle when held, else the raw address — so the shared card matches what
 * readers see.
 */
export function feedOpenGraphMetadata({ post, pageUrl }) {
  const name = post.handle ? `@${post.handle}` : shortenIdentity(post.displayIdentity)
  const text = (post.content ?? '').replace(/\s+/g, ' ').trim()
  const title = name ? `${name} on Proof Of Writing` : 'Proof Of Writing'
  const description = text ? text.slice(0, 200) : 'A post on Proof Of Writing.'

  const ogImageUrl = buildFeedOgImageUrl({
    text,
    author: name,
    action: post.action,
    id: typeof post.txid === 'string' ? post.txid.slice(0, 10) : undefined,
  })

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: 'Proof Of Writing',
      images: [{ url: ogImageUrl, width: 2400, height: 1260, alt: title }],
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl],
    },
  }
}
