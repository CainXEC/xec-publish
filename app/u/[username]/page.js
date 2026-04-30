import { notFound } from 'next/navigation'
import AuthorProfilePageClient from '@/components/AuthorProfilePageClient'
import { loadAuthorProfileByUsername } from '@/lib/loadAuthorProfile'

export default async function AuthorProfilePage({ params }) {
  const { username: raw } = await params
  if (typeof raw !== 'string' || !raw.trim()) {
    notFound()
  }

  const username = decodeURIComponent(raw.trim())

  const { error, author, posts: postList, totalUnlocks, totalEarnings } =
    await loadAuthorProfileByUsername(username)

  if (!author) {
    notFound()
  }

  const postsErrorMessage = error || null

  return (
    <AuthorProfilePageClient
      author={author}
      initialPosts={postList}
      totalUnlocks={totalUnlocks}
      totalEarnings={totalEarnings}
      postsErrorMessage={postsErrorMessage}
    />
  )
}
