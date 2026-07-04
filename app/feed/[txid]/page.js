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

  const thread = await getFeedThread(txid)
  if (!thread) {
    notFound()
  }

  const acct = await getAuthedAccount()

  return (
    <FeedThreadClient
      initialPost={thread.post}
      initialReplies={thread.replies}
      viewerAccountId={acct?.accountId ?? null}
    />
  )
}
