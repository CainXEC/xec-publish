import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import PostPageClient from '../posts/[slug]/PostPageClient'
import { getPublishedPostBySlug } from '@/lib/getPublishedPostBySlug'
import { preparePublicPostPageData } from '@/lib/preparePublicPostPageData'

/**
 * Legacy root URLs (`/{slug}`, e.g. `/1`, `/00`): published posts with
 * `legacy = true` only. Current posts live at `/posts/{slug}`. This dynamic
 * segment only matches root paths not claimed by a more specific route, so it
 * safely serves the imported legacy archive at its original permalinks.
 */
export default async function LegacyRootPostPage({ params }) {
  const { slug: raw } = await params
  const slug = typeof raw === 'string' ? raw : ''
  const data = await getPublishedPostBySlug(slug, true)
  if (!data) {
    notFound()
  }

  const cookieStore = await cookies()
  const pageProps = await preparePublicPostPageData(data, cookieStore)

  return <PostPageClient {...pageProps} />
}
