export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rateLimit'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { buildPublishFeeBip21 } from '@/lib/paymentSplit'
import { contentHashHex, encodeFeedOpReturnRaw, FEED_ACTION } from '@/lib/feedProtocol'
import {
  FORUM_CREATE_FEE_XEC,
  validateForumSlug,
  getForumBySlug,
} from '@/lib/forums'

/**
 * Build the payment request to create a forum: a one-time creation fee, 100% to
 * the platform, whose OP_RETURN commits sha256(slug) — the "proof of the name",
 * binding this payment to this exact forum. Gated to @handle-holders. Pure — the
 * forum row is created by /api/forums/create/confirm once the payment is seen.
 */
export async function POST(request) {
  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 10, 60, 'forum-create-prepare'))) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
  }

  const platformAddress = process.env.PLATFORM_XEC_ADDRESS?.trim()
  if (!platformAddress) {
    return NextResponse.json({ error: 'Platform payment address not configured' }, { status: 500 })
  }

  const acct = await getAuthedAccount()
  if (!acct) return NextResponse.json({ error: 'Log in to create a forum.' }, { status: 401 })
  if (!acct.handle) {
    return NextResponse.json({ error: 'Only @handle-holders can create a forum.' }, { status: 403 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const slug = typeof body?.slug === 'string' ? body.slug.trim() : ''
  const slugErr = validateForumSlug(slug)
  if (slugErr) return NextResponse.json({ error: slugErr }, { status: 400 })
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  if (!title || title.length > 80) {
    return NextResponse.json({ error: 'Give the forum a title (1–80 chars).' }, { status: 400 })
  }

  const supabase = adminDb()
  if (await getForumBySlug(supabase, slug)) {
    return NextResponse.json({ error: 'That forum name is taken.' }, { status: 409 })
  }

  const contentHash = contentHashHex(slug)
  let opReturnRaw
  try {
    opReturnRaw = encodeFeedOpReturnRaw({ action: FEED_ACTION.FORUM, contentHash })
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Failed to build commitment' }, { status: 500 })
  }

  const bip21Url = buildPublishFeeBip21(platformAddress, FORUM_CREATE_FEE_XEC, opReturnRaw)

  return NextResponse.json({
    ok: true,
    slug,
    contentHash,
    costXec: FORUM_CREATE_FEE_XEC,
    amountXec: FORUM_CREATE_FEE_XEC,
    bip21Url,
    payAddress: platformAddress,
    cashtabUrl: `https://cashtab.com/#/send?bip21=${bip21Url}`,
    preparedAt: Math.floor(Date.now() / 1000),
  })
}
