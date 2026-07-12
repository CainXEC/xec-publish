// =============================================================================
//  app/api/feed/thread/[txid]/route.js — the home page's thread reading pane.
//
//  Exactly the data the thread page's server component assembles (getFeedThread
//  with the viewer's session for liked/reposted flags), as JSON, so the feed
//  can swap a thread into its center column without leaving the page.
//
//  no-store: the payload carries per-viewer state (likedByViewer etc.).
// =============================================================================

import { NextResponse } from 'next/server'
import { getFeedThread } from '@/lib/getFeed'
import { getAuthedAccount } from '@/lib/authHelpers'

export const dynamic = 'force-dynamic'

export async function GET(_req, { params }) {
  const { txid: raw } = await params
  const txid = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(txid)) {
    return NextResponse.json({ ok: false, error: 'bad txid' }, { status: 400 })
  }

  const acct = await getAuthedAccount()
  const thread = await getFeedThread(txid, {
    viewerAddress: acct?.address,
    viewerAccountId: acct?.accountId ?? null,
  })
  if (!thread) {
    return NextResponse.json({ ok: false, error: 'Post not found' }, { status: 404 })
  }

  return NextResponse.json(
    {
      ok: true,
      post: thread.post,
      ancestors: thread.ancestors,
      replies: thread.replies,
      viewerAccountId: acct?.accountId ?? null,
      isAuthor: acct?.authorId != null,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
