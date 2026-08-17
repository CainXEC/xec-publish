import { truncateAtWord } from '@/lib/truncateAtWord'

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

// Card-template version. OG URLs are CDN-cached as immutable, so bump this
// whenever the /api/og/feed template itself changes to re-render every card.
// v2: AI-simulation label (ai=1) added to the template.
// v3: word-aware clipping — cards cut at 280 kept their last word broken in
//     half AND arrived at the template already exactly 280 chars, so the
//     template's own "…" guard never fired and the card looked complete.
// v4: render at 1200x630 (was 2400x1260) — the 2x card took ~4s and overran
// social crawlers' timeout, so X dropped it.
const OG_TEMPLATE_VERSION = '4'

// Tweet-length preview on the card, and the OG description under it. Both are
// clipped at a WORD, with the "…" the reader needs to know there's more.
const CARD_TEXT_MAX = 280
const DESCRIPTION_MAX = 200

/** Build the absolute /api/og/feed image URL for a feed post's share card. */
export function buildFeedOgImageUrl({ text, author, action, id, ai }) {
  const url = new URL('/api/og/feed', getSiteUrl())
  const clipped = truncateAtWord((text ?? '').replace(/\s+/g, ' ').trim(), CARD_TEXT_MAX)
  url.searchParams.set('text', clipped)
  if (author) url.searchParams.set('author', author)
  if (action != null && action !== '') url.searchParams.set('action', String(action))
  // A short txid slice keys the CDN cache per post and lets a single card be
  // busted without touching the others.
  if (id) url.searchParams.set('id', id)
  if (ai) url.searchParams.set('ai', '1')
  url.searchParams.set('v', OG_TEMPLATE_VERSION)
  return url.toString()
}

/**
 * OpenGraph/Twitter metadata for a single feed post permalink (/feed/[txid]).
 * `post` is the shape returned by getFeedPostForCard: { txid, action, content,
 * handle, displayIdentity, isAi }. Byline resolves the same way as the in-app feed —
 * @handle when held, else the raw address — so the shared card matches what
 * readers see.
 */
export function feedOpenGraphMetadata({ post, pageUrl }) {
  const name = post.handle ? `@${post.handle}` : shortenIdentity(post.displayIdentity)
  const text = (post.content ?? '').replace(/\s+/g, ' ').trim()
  const title = name ? `${name} on Proof Of Writing` : 'Proof Of Writing'
  const description = text ? truncateAtWord(text, DESCRIPTION_MAX) : 'A post on Proof Of Writing.'

  const ogImageUrl = buildFeedOgImageUrl({
    text,
    author: name,
    action: post.action,
    id: typeof post.txid === 'string' ? post.txid.slice(0, 10) : undefined,
    ai: post.isAi === true,
  })

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: 'Proof Of Writing',
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: title }],
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
