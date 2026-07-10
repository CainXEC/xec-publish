export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getAccountRepliesPage } from '@/lib/getFeed'
import { getAuthedAccount } from '@/lib/authHelpers'
import { rateLimit, getClientIp } from '@/lib/rateLimit'

/**
 * GET /api/feed/account-replies?accountId=<id>[&cursor=<cursor>]
 *
 * One account's replies (the profile/dashboard "Replies" tab), loaded on demand
 * the first time the user switches to the tab instead of being server-rendered
 * into every profile visit. Reuses getAccountRepliesPage verbatim, so the post
 * shape is identical to what the page used to inline. Replies are public data
 * (the profile page always served them to everyone); the session only enriches
 * the viewer's own like/repost/follow state.
 */
export async function GET(request) {
  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 60, 60, 'feed-account-replies'))) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
  }

  const accountId = (request.nextUrl.searchParams.get('accountId') ?? '').trim()
  if (!accountId) {
    return NextResponse.json({ error: 'Missing accountId' }, { status: 400 })
  }
  const cursor = request.nextUrl.searchParams.get('cursor') || null

  const viewer = await getAuthedAccount()
  try {
    const page = await getAccountRepliesPage({
      accountId,
      cursor,
      viewerAddress: viewer?.address ?? '',
      viewerAccountId: viewer?.accountId ?? null,
    })
    return NextResponse.json({ ok: true, posts: page.posts, nextCursor: page.nextCursor })
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Failed to load replies' }, { status: 500 })
  }
}
