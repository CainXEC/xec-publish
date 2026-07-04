import { notFound } from 'next/navigation'
import FeedThreadClient from '@/components/feed/FeedThreadClient'
import { getFeedThread } from '@/lib/getFeed'

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

  return <FeedThreadClient initialPost={thread.post} initialReplies={thread.replies} />
}
