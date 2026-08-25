// =============================================================================
//  app/api/feed/quotes/[txid]/route.js — the posts that QUOTE one post.
//
//  Powers the thread view's "N quotes" section: given a post's txid, return the
//  quote posts referencing it (newest first), decorated for the viewer so they
//  render in FeedPost exactly like any feed post — each with its own embed of the
//  original and the viewer's reaction/follow state.
//
//  no-store: the payload carries per-viewer state.
// =============================================================================

import { NextResponse } from 'next/server'
import { getPostQuotes } from '@/lib/getFeed'
import { getAuthedAccount } from '@/lib/authHelpers'

export const dynamic = 'force-dynamic'

export async function GET(_req, { params }) {
  const { txid: raw } = await params
  const txid = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(txid)) {
    return NextResponse.json({ ok: false, error: 'bad txid' }, { status: 400 })
  }

  const acct = await getAuthedAccount()
  const { posts } = await getPostQuotes(txid, {
    viewerAddress: acct?.address,
    viewerAccountId: acct?.accountId ?? null,
  })

  return NextResponse.json(
    { ok: true, posts },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
