export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rateLimit'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthedAccount } from '@/lib/authHelpers'
import { encodeFeedOpReturnRaw, contentHashHex, FEED_ACTION } from '@/lib/feedProtocol'

// GET /api/publish/prepare?postId=<uuid>
//
// Returns the POWR publish envelope (OP_6) the paywall should hand to Cashtab.
// The contentHash is computed here from the CANONICAL stored body so it always
// matches what verify-publish-payment recomputes — the client never hashes, so
// there's no client/server drift. Authed to the owning author only.
export async function GET(request) {
  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 30, 60, 'publish-prepare'))) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 },
    )
  }

  const postId = request.nextUrl.searchParams.get('postId')?.trim()
  if (!postId) {
    return NextResponse.json({ error: 'Missing postId' }, { status: 400 })
  }

  const acct = await getAuthedAccount()
  if (!acct?.authorId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json(
      { error: 'Server configuration error: missing Supabase admin credentials' },
      { status: 500 },
    )
  }

  const { data: post, error } = await admin
    .from('posts')
    .select('id, author_id, body')
    .eq('id', postId)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }
  if (post.author_id !== acct.authorId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const contentHash = contentHashHex(post.body ?? '')
  const opReturnRaw = encodeFeedOpReturnRaw({
    action: FEED_ACTION.PUBLISH,
    contentHash,
  })

  return NextResponse.json({ ok: true, opReturnRaw }, { status: 200 })
}
