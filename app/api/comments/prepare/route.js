export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rateLimit'
import { createServerSupabase } from '@/lib/supabase-server'
import { priceFeedPost } from '@/lib/feedPricing'
import { computePaymentSplit, buildPaywallBip21 } from '@/lib/paymentSplit'
import { contentHashHex, encodeFeedOpReturnRaw, FEED_ACTION } from '@/lib/feedProtocol'
import { resolveCommenter, resolveParentPayout, toEcashAddr } from '@/lib/commentGate'

/**
 * Build the payment request (BIP21 + OP_RETURN) for a paid article comment.
 * A top-level comment pays the ARTICLE author 94/6 (POST action); a reply pays
 * the PARENT comment's author 94/6 (REPLY action, targeting the parent txid).
 * Pure — no DB write. The content hash is re-derived + checked on-chain at
 * /api/comments/confirm.
 */
export async function POST(request) {
  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 30, 60, 'comment-prepare'))) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
  }

  const platformAddress = process.env.PLATFORM_XEC_ADDRESS?.trim()
  if (!platformAddress) {
    return NextResponse.json({ error: 'Platform payment address not configured' }, { status: 500 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const postId = typeof body?.postId === 'string' ? body.postId.trim() : ''
  if (!postId) {
    return NextResponse.json({ error: 'Missing postId' }, { status: 400 })
  }

  const supabase = createServerSupabase()

  // Must be a proven reader of the article to comment.
  const who = await resolveCommenter(request, postId, supabase)
  if (!who.ok) {
    return NextResponse.json({ error: who.error }, { status: who.status })
  }

  const priced = priceFeedPost(body?.content)
  if (!priced.ok) {
    return NextResponse.json({ error: priced.error, chars: priced.chars }, { status: 400 })
  }
  const { chars, costXec } = priced
  const contentHash = contentHashHex(body.content)

  // Resolve the payee: a reply pays the parent comment's author (paid or legacy);
  // a top-level comment pays the article author. Threading is by parent_id, so
  // ANY comment can be replied to.
  const parentId =
    typeof body?.parentId === 'string' && body.parentId.trim() ? body.parentId.trim() : null

  let action
  let payoutAddress
  let parentTxid = null
  if (parentId) {
    const { data: parent, error } = await supabase
      .from('comments')
      .select('id, txid, payout_address, author_account_id, payer_address, post_id, deleted_at')
      .eq('id', parentId)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!parent || parent.deleted_at || String(parent.post_id) !== String(postId)) {
      return NextResponse.json({ error: 'Parent comment not found' }, { status: 404 })
    }
    const payee = await resolveParentPayout(parent)
    if (!payee?.payoutAddress) {
      return NextResponse.json(
        { error: "Can't reply to this comment — its author can't be paid." },
        { status: 409 },
      )
    }
    payoutAddress = payee.payoutAddress
    parentTxid = payee.parentTxid
    // A paid parent has a txid to target on-chain (REPLY); a legacy free parent
    // doesn't, so the reply is a plain POST that still splits to that author.
    action = parentTxid ? FEED_ACTION.REPLY : FEED_ACTION.POST
  } else {
    action = FEED_ACTION.POST
    const { data: post, error } = await supabase
      .from('posts')
      .select('author_id')
      .eq('id', postId)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!post?.author_id) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 })
    }
    const { data: author } = await supabase
      .from('authors')
      .select('xec_address')
      .eq('id', post.author_id)
      .maybeSingle()
    payoutAddress = toEcashAddr(author?.xec_address)
    if (!payoutAddress) {
      return NextResponse.json({ error: "This article's author can't receive comments yet" }, { status: 409 })
    }
  }

  const split = computePaymentSplit(costXec)
  if (!split) {
    return NextResponse.json({ error: 'Invalid price' }, { status: 500 })
  }

  let opReturnRaw
  try {
    opReturnRaw = encodeFeedOpReturnRaw({
      action,
      targetTxid: parentTxid ?? undefined,
      contentHash,
    })
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Failed to build commitment' }, { status: 500 })
  }

  const bip21Url = buildPaywallBip21(
    payoutAddress,
    platformAddress,
    split.authorAmount,
    split.platformAmount,
    opReturnRaw,
  )

  return NextResponse.json({
    ok: true,
    action,
    parentId,
    chars,
    costXec,
    amountXec: costXec,
    contentHash,
    bip21Url,
    payAddress: payoutAddress,
    cashtabUrl: `https://cashtab.com/#/send?bip21=${bip21Url}`,
    preparedAt: Math.floor(Date.now() / 1000),
  })
}
