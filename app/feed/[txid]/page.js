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

  // Cheap pre-check: is this post in a forum? Decides BOTH the "← /f/<slug>" back
  // link AND the deep fetch — a forum thread pulls its WHOLE descendant tree for
  // the Reddit-style nested comment view; a feed thread keeps direct replies only.
  const { data: bare } = await adminDb()
    .from('feed_posts')
    .select('forum_id')
    .eq('txid', txid)
    .maybeSingle()
  const forumId = bare?.forum_id ?? null
  let forumSlug = null
  if (forumId) {
    const forum = await getForumById(adminDb(), forumId)
    forumSlug = forum?.slug ?? null
  }

  const thread = await getFeedThread(txid, {
    viewerAddress: acct?.address,
    viewerAccountId: acct?.accountId ?? null,
    deep: Boolean(forumId),
  })
  if (!thread) {
    notFound()
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
