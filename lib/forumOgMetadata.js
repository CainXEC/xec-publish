import { truncateAtWord } from '@/lib/truncateAtWord'

const defaultSiteUrl = 'https://www.proofofwriting.com'

function getSiteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || defaultSiteUrl
}

// Card-template version. OG URLs are CDN-cached as immutable, so bump this
// whenever the /api/og/forum template itself changes to re-render every card.
const OG_TEMPLATE_VERSION = '1'

export function buildForumOgImageUrl({ slug, title, desc, posts, runner }) {
  const ogImageUrl = new URL('/api/og/forum', getSiteUrl())
  ogImageUrl.searchParams.set('slug', slug)
  if (title) ogImageUrl.searchParams.set('title', title)
  if (desc) ogImageUrl.searchParams.set('desc', desc)
  if (posts > 0) ogImageUrl.searchParams.set('posts', String(posts))
  if (runner) ogImageUrl.searchParams.set('runner', runner)
  ogImageUrl.searchParams.set('v', OG_TEMPLATE_VERSION)
  return ogImageUrl.toString()
}

export function forumOpenGraphMetadata({ slug, title, description, posts, runner, pageUrl }) {
  const heading = `/f/${slug}${title ? ` — ${title}` : ''}`
  const metaDescription = description
    ? truncateAtWord(description, 160)
    : `${title || `/f/${slug}`} — a forum on Proof Of Writing.`
  const ogImageUrl = buildForumOgImageUrl({ slug, title, desc: description, posts, runner })

  return {
    title: `${heading} — proofofwriting`,
    description: metaDescription,
    openGraph: {
      title: heading,
      description: metaDescription,
      url: pageUrl,
      siteName: 'Proof Of Writing',
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: heading }],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: heading,
      description: metaDescription,
      images: [ogImageUrl],
    },
  }
}
