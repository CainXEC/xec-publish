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
import { getFeedThread, forumRootTxid } from '@/lib/getFeed'
import { getAuthedAccount } from '@/lib/authHelpers'
import { adminDb } from '@/lib/db'
import { getForumById } from '@/lib/forums'

export const dynamic = 'force-dynamic'

export async function GET(_req, { params }) {
  const { txid: raw } = await params
  const txid = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(txid)) {
    return NextResponse.json({ ok: false, error: 'bad txid' }, { status: 400 })
  }

  const acct = await getAuthedAccount()

  // Same forum pre-check as the standalone thread page (app/feed/[txid]/page.js):
  // a forum post (or a reply inside one) gets the "← /f/<slug>" back link AND the
  // deep fetch for the nested comment view — otherwise the pane renders a forum
  // thread as a plain feed thread.
  const { data: bare } = await adminDb()
    .from('feed_posts')
    .select('forum_id')
    .eq('txid', txid)
    .maybeSingle()
  const forumId = bare?.forum_id ?? null
  let forumSlug = null
  // A forum link always opens the ROOT thread (Reddit-style), never a deep
  // comment with an ancestor chain — resolve up to the top-level post first.
  let focusTxid = txid
  if (forumId) {
    const forum = await getForumById(adminDb(), forumId)
    forumSlug = forum?.slug ?? null
    focusTxid = await forumRootTxid(txid)
  }

  const thread = await getFeedThread(focusTxid, {
    viewerAddress: acct?.address,
    viewerAccountId: acct?.accountId ?? null,
    deep: Boolean(forumId),
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
      forumSlug,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
