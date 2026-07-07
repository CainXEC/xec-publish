import { notFound } from 'next/navigation'
import FeedThreadClient from '@/components/feed/FeedThreadClient'
import { getFeedThread } from '@/lib/getFeed'
import { getAuthedAccount } from '@/lib/authHelpers'

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

  return (
    <FeedThreadClient
      initialPost={thread.post}
      initialAncestors={thread.ancestors}
      initialReplies={thread.replies}
      viewerAccountId={acct?.accountId ?? null}
      isAuthor={acct?.authorId != null}
    />
  )
}
