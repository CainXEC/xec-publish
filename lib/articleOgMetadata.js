const defaultSiteUrl = 'https://www.proofofwriting.com'

function getSiteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || defaultSiteUrl
}

export function buildDynamicOgImageUrl({ title, author, readTime, price }) {
  const ogImageUrl = new URL('/api/og', getSiteUrl())
  ogImageUrl.searchParams.set('title', title ?? 'Proof of Writing')
  if (author) ogImageUrl.searchParams.set('author', author)
  if (readTime != null && readTime !== '') {
    ogImageUrl.searchParams.set('readTime', String(readTime))
  }
  if (price != null && price !== '') {
    ogImageUrl.searchParams.set('price', String(price))
  }
  return ogImageUrl.toString()
}

/** Server-side CDN warm-up; uses the same URL as articleOpenGraphMetadata / generateMetadata. */
export async function warmOgImageCache({ title, author, readTime, price }) {
  const ogUrl = buildDynamicOgImageUrl({ title, author, readTime, price })
  try {
    await fetch(ogUrl)
  } catch (err) {
    console.error('[og-warm] failed:', err)
  }
}

export function articleOpenGraphMetadata({ post, authorUsername, pageUrl }) {
  const description = post.teaser?.slice(0, 160)
  const ogImageUrl = buildDynamicOgImageUrl({
    title: post.title,
    author: authorUsername,
    readTime: post.reading_time_minutes,
    price: post.price_xec,
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
          width: 1200,
          height: 630,
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
