export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rateLimit'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { contentHashHex, FEED_ACTION } from '@/lib/feedProtocol'
import { findFeedPayment, verifyFeedTxid } from '@/lib/verifyFeedPost'
import {
  FORUM_CREATE_FEE_XEC,
  validateForumSlug,
  forumSkeleton,
  getForumBySlug,
} from '@/lib/forums'

const FORUM_COLUMNS = 'id, slug, title, description, runner_account_id, created_at, post_count'

/**
 * Detect the forum-creation payment and create the forum. Gated to @handle-
 * holders; the caller becomes the runner. Idempotent: a re-poll after the forum
 * exists returns it (when the caller owns it). The OP_RETURN commits sha256(slug),
 * so a given payment can only create the forum with that exact name.
 */
export async function POST(request) {
  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 30, 60, 'forum-create-confirm'))) {
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
  if (validateForumSlug(slug)) {
    return NextResponse.json({ error: 'Invalid forum name' }, { status: 400 })
  }
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  if (!title || title.length > 80) {
    return NextResponse.json({ error: 'Give the forum a title (1–80 chars).' }, { status: 400 })
  }
  const description =
    typeof body?.description === 'string' ? body.description.trim().slice(0, 500) : null

  const supabase = adminDb()

  // Idempotent: the forum already exists. If the caller owns it, return it (a
  // re-poll after a successful create); otherwise the name is taken.
  const existing = await getForumBySlug(supabase, slug)
  if (existing) {
    if (existing.runner_account_id === acct.accountId) {
      return NextResponse.json({ ok: true, status: 'created', forum: existing })
    }
    return NextResponse.json({ error: 'That forum name is taken.' }, { status: 409 })
  }

  const expected = {
    action: FEED_ACTION.FORUM,
    parentTxid: null,
    contentHash: contentHashHex(slug),
    platformAddress,
    payoutAddress: null,
    costXec: FORUM_CREATE_FEE_XEC,
    platformOnly: true,
  }

  const providedTxid =
    typeof body?.txid === 'string' && /^[0-9a-f]{64}$/i.test(body.txid.trim())
      ? body.txid.trim().toLowerCase()
      : null
  const sinceUnix = Number(body?.since) || 0

  const match = providedTxid
    ? await verifyFeedTxid(providedTxid, expected)
    : await findFeedPayment(expected, { sinceUnix, excludeTxids: new Set() })

  if (!match) {
    return NextResponse.json({ ok: true, status: 'awaiting_payment' })
  }

  const { data: inserted, error } = await supabase
    .from('forums')
    .insert({
      slug,
      slug_skeleton: forumSkeleton(slug),
      title,
      description,
      runner_account_id: acct.accountId,
      // The on-chain creation tx — lets the Live rail link "@runner created /f/…".
      genesis_txid: match.txid,
    })
    .select(FORUM_COLUMNS)
    .single()

  if (error) {
    // 23505: the skeleton unique index — someone created this name in the race.
    if (error.code === '23505') {
      const now = await getForumBySlug(supabase, slug)
      if (now?.runner_account_id === acct.accountId) {
        return NextResponse.json({ ok: true, status: 'created', forum: now })
      }
      return NextResponse.json({ error: 'That forum name is taken.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, status: 'created', forum: inserted })
}
