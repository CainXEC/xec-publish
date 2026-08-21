import { notFound } from 'next/navigation'
import FeedThreadClient from '@/components/feed/FeedThreadClient'
import { getFeedThread } from '@/lib/getFeed'
import { getAuthedAccount } from '@/lib/authHelpers'
import { adminDb } from '@/lib/db'
import { getForumById } from '@/lib/forums'

export const dynamic = 'force-dynamic'

export default async function FeedThreadPage({ params }) {
  const { txid: raw } = await params
  const txid = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(txid)) {
    notFound()
  }

  const acct = await getAuthedAccount()

  const thread = await getFeedThread(txid, {
    viewerAddress: acct?.address,
    viewerAccountId: acct?.accountId ?? null,
  })
  if (!thread) {
    notFound()
  }

  // A forum post (or a reply inside one — replies inherit forum_id) gets a
  // "← /f/<slug>" back link to its forum, so the thread doesn't dead-end on the
  // global feed.
  const forumId = thread.post?.forum_id ?? null
  let forumSlug = null
  if (forumId) {
    const forum = await getForumById(adminDb(), forumId)
    forumSlug = forum?.slug ?? null
  }

  return (
    <FeedThreadClient
      initialPost={thread.post}
      initialAncestors={thread.ancestors}
      initialReplies={thread.replies}
      viewerAccountId={acct?.accountId ?? null}
      isAuthor={acct?.authorId != null}
      forumSlug={forumSlug}
    />
  )
}
