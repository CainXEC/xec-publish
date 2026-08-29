import { notFound } from 'next/navigation'
import ForumPageClient from '@/components/feed/ForumPageClient'
import { adminDb } from '@/lib/db'
import { getForumBySlug } from '@/lib/forums'
import { getForumFeedPage } from '@/lib/getFeed'
import { getAuthedAccount } from '@/lib/authHelpers'
import { displayHandlesByAccountId } from '@/lib/authorDisplayHandles'
import { forumOpenGraphMetadata } from '@/lib/forumOgMetadata'

export const dynamic = 'force-dynamic'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.proofofwriting.com'

/** Share card for a forum: /f/slug, title, description, and a posts · runner
 *  footer — so a forum link unfurls with its own identity, not the site card. */
export async function generateMetadata({ params }) {
  const { slug: raw } = await params
  const slug = typeof raw === 'string' ? raw.trim() : ''
  const forum = slug ? await getForumBySlug(adminDb(), slug) : null
  if (!forum) {
    return { title: 'Forum — proofofwriting' }
  }
  const runnerMap = await displayHandlesByAccountId([forum.runner_account_id], adminDb())
  const runner = runnerMap[forum.runner_account_id]?.handle
    ? `@${runnerMap[forum.runner_account_id].handle}`
    : ''
  return forumOpenGraphMetadata({
    slug: forum.slug,
    title: forum.title,
    description: forum.description || '',
    posts: forum.post_count,
    runner,
    pageUrl: `${siteUrl}/f/${encodeURIComponent(forum.slug)}`,
  })
}

export default async function ForumPage({ params }) {
  const { slug: raw } = await params
  const slug = typeof raw === 'string' ? raw.trim() : ''
  if (!slug) notFound()

  const supabase = adminDb()
  const forum = await getForumBySlug(supabase, slug)
  if (!forum) notFound()

  const acct = await getAuthedAccount()
  const isRunner = acct?.accountId === forum.runner_account_id

  const [{ posts, nextCursor }, runnerMap, forumRowCount] = await Promise.all([
    getForumFeedPage({
      forumId: forum.id,
      viewerAddress: acct?.address ?? '',
      viewerAccountId: acct?.accountId ?? null,
    }),
    displayHandlesByAccountId([forum.runner_account_id], supabase),
    // Only the runner can delete a forum, and only while it's empty — count ALL
    // rows (any action, soft-deleted included) so the button matches the server's
    // gate. Skip the query for everyone else.
    isRunner
      ? supabase
          .from('feed_posts')
          .select('id', { count: 'exact', head: true })
          .eq('forum_id', forum.id)
          .then((r) => r.count ?? 0)
      : Promise.resolve(null),
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
        isRunner,
        canDelete: isRunner && forumRowCount === 0,
      }}
      forumId={forum.id}
      initialPosts={posts}
      initialNextCursor={nextCursor}
      viewerAccountId={acct?.accountId ?? null}
      isAuthor={acct?.authorId != null}
    />
  )
}
