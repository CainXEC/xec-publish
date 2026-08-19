import { notFound } from 'next/navigation'
import ForumPageClient from '@/components/feed/ForumPageClient'
import { adminDb } from '@/lib/db'
import { getForumBySlug } from '@/lib/forums'
import { getForumFeedPage } from '@/lib/getFeed'
import { getAuthedAccount } from '@/lib/authHelpers'
import { displayHandlesByAccountId } from '@/lib/authorDisplayHandles'

export const dynamic = 'force-dynamic'

export default async function ForumPage({ params }) {
  const { slug: raw } = await params
  const slug = typeof raw === 'string' ? raw.trim() : ''
  if (!slug) notFound()

  const supabase = adminDb()
  const forum = await getForumBySlug(supabase, slug)
  if (!forum) notFound()

  const acct = await getAuthedAccount()

  const [{ posts, nextCursor }, runnerMap] = await Promise.all([
    getForumFeedPage({
      forumId: forum.id,
      viewerAddress: acct?.address ?? '',
      viewerAccountId: acct?.accountId ?? null,
    }),
    displayHandlesByAccountId([forum.runner_account_id], supabase),
  ])

  const runnerHandle = runnerMap[forum.runner_account_id]?.handle
    ? `@${runnerMap[forum.runner_account_id].handle}`
    : null

  return (
    <ForumPageClient
      forum={{
        slug: forum.slug,
        title: forum.title,
        description: forum.description,
        postCount: forum.post_count,
        runner: runnerHandle,
        isRunner: acct?.accountId === forum.runner_account_id,
      }}
      forumId={forum.id}
      initialPosts={posts}
      initialNextCursor={nextCursor}
      viewerAccountId={acct?.accountId ?? null}
      isAuthor={acct?.authorId != null}
    />
  )
}
