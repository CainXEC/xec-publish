import { notFound } from 'next/navigation'
import PostPageClient from './PostPageClient'
import { getPublishedPostBySlug } from '@/lib/getPublishedPostBySlug'

export default async function PublicPostPage({ params }) {
  const { slug: raw } = await params
  const slug = typeof raw === 'string' ? raw : ''
  const data = await getPublishedPostBySlug(slug)
  if (!data) {
    notFound()
  }

  return (
    <PostPageClient
      initialPost={data.post}
      initialAuthor={data.author}
      initialUnlockCount={data.unlockCount}
      initialCommentCount={data.commentCount}
    />
  )
}
