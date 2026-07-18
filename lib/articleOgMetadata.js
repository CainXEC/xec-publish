const defaultSiteUrl = 'https://www.proofofwriting.com'

function getSiteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || defaultSiteUrl
}

// Card-template version. OG URLs are CDN-cached as immutable, so bump this
// whenever the /api/og template itself changes to re-render every card.
// v2: AI-simulation label (ai=1) added to the template.
const OG_TEMPLATE_VERSION = '2'

export function buildDynamicOgImageUrl({ title, author, readTime, price, ai }) {
  const ogImageUrl = new URL('/api/og', getSiteUrl())
  ogImageUrl.searchParams.set('title', title ?? 'Proof of Writing')
  if (author) ogImageUrl.searchParams.set('author', author)
  if (readTime != null && readTime !== '') {
    ogImageUrl.searchParams.set('readTime', String(readTime))
  }
  if (price != null && price !== '') {
    ogImageUrl.searchParams.set('price', String(price))
  }
  if (ai) ogImageUrl.searchParams.set('ai', '1')
  ogImageUrl.searchParams.set('v', OG_TEMPLATE_VERSION)
  return ogImageUrl.toString()
}

/** Server-side CDN warm-up; uses the same URL as articleOpenGraphMetadata / generateMetadata. */
export async function warmOgImageCache({ title, author, readTime, price, ai }) {
  const ogUrl = buildDynamicOgImageUrl({ title, author, readTime, price, ai })
  try {
    await fetch(ogUrl)
  } catch (err) {
    console.error('[og-warm] failed:', err)
  }
}

export function articleOpenGraphMetadata({ post, authorUsername, authorIsAi, pageUrl }) {
  const description = post.teaser?.slice(0, 160)
  const ogImageUrl = buildDynamicOgImageUrl({
    title: post.title,
    author: authorUsername,
    readTime: post.reading_time_minutes,
    price: post.price_xec,
    ai: authorIsAi === true,
  })

  return {
    title: `${post.title} | Proof Of Writing`,
    description,
    openGraph: {
      title: post.title,
      description,
      url: pageUrl,
      siteName: 'Proof Of Writing',
      images: [
        {
          url: ogImageUrl,
          width: 2400,
          height: 1260,
          alt: post.title,
        },
      ],
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description,
      images: [ogImageUrl],
    },
  }
}
