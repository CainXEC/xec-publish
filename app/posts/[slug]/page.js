import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import PostPageClient from './PostPageClient'
import { getPublishedPostBySlug } from '@/lib/getPublishedPostBySlug'
import { preparePublicPostPageData } from '@/lib/preparePublicPostPageData'

export default async function PublicPostPage({ params }) {
  const { slug: raw } = await params
  const slug = typeof raw === 'string' ? raw : ''
  const data = await getPublishedPostBySlug(slug)
  if (!data) {
    notFound()
  }

  const cookieStore = await cookies()
  const pageProps = await preparePublicPostPageData(data, cookieStore)

  return <PostPageClient {...pageProps} slug={slug} />
}
