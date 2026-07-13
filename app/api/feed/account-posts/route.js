export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getAccountFeedPage } from '@/lib/getFeed'
import { getAuthedAccount } from '@/lib/authHelpers'
import { rateLimit, getClientIp } from '@/lib/rateLimit'

/**
 * GET /api/feed/account-posts?accountId=<id>[&cursor=<cursor>]
 *
 * One account's top-level posts (the profile "Posts" tab), paged for infinite
 * scroll. Page 1 is server-rendered into the profile visit; this route serves
 * page 2+ as the reader scrolls, keyed on the nextCursor the previous page
 * returned. Reuses getAccountFeedPage verbatim, so the post shape matches the
 * server-rendered first page. Posts are public data; the session only enriches
 * the viewer's own like/repost/follow state.
 */
export async function GET(request) {
  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 60, 60, 'feed-account-posts'))) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
  }

  const accountId = (request.nextUrl.searchParams.get('accountId') ?? '').trim()
  if (!accountId) {
    return NextResponse.json({ error: 'Missing accountId' }, { status: 400 })
  }
  const cursor = request.nextUrl.searchParams.get('cursor') || null

  const viewer = await getAuthedAccount()
  try {
    const page = await getAccountFeedPage({
      accountId,
      cursor,
      viewerAddress: viewer?.address ?? '',
      viewerAccountId: viewer?.accountId ?? null,
    })
    return NextResponse.json({ ok: true, posts: page.posts, nextCursor: page.nextCursor })
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Failed to load posts' }, { status: 500 })
  }
}
