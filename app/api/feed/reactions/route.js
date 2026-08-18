export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { rateLimit, getClientIp } from '@/lib/rateLimit'

/**
 * Who reacted to a feed post, and with what. Author-only: reactions are on-chain
 * (the payer is public), but we surface the reactor list only to the post's own
 * author — so a post owner can see who reacted rather than being offered a
 * pointless "react to your own post". Newest first.
 *
 * GET ?txid=<64hex>  ->  { ok, reactors: [{ identity, emoji, at }] }
 */
export async function GET(request) {
  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 60, 60, 'feed-reactions-list'))) {
    return NextResponse.json({ ok: false, error: 'Too many requests' }, { status: 429 })
  }

  const txid = String(new URL(request.url).searchParams.get('txid') ?? '')
    .trim()
    .toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(txid)) {
    return NextResponse.json({ ok: false, error: 'bad txid' }, { status: 400 })
  }

  const acct = await getAuthedAccount()
  if (!acct) {
    return NextResponse.json({ ok: false, error: 'auth required' }, { status: 401 })
  }

  const supabase = adminDb()
  const { data: post } = await supabase
    .from('feed_posts')
    .select('author_account_id')
    .eq('txid', txid)
    .maybeSingle()
  if (!post) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  }
  if (post.author_account_id !== acct.accountId) {
    return NextResponse.json({ ok: false, error: 'not your post' }, { status: 403 })
  }

  const { data: rows } = await supabase
    .from('feed_events')
    .select('actor_identity, emoji, created_at')
    .eq('action', 5)
    .eq('target_txid', txid)
    .order('created_at', { ascending: false })
    .limit(200)

  const reactors = (rows ?? []).map((r) => ({
    identity: r.actor_identity,
    emoji: r.emoji || '❤️', // legacy ♥ likes (null) show as ❤️
    at: r.created_at,
  }))

  return NextResponse.json({ ok: true, reactors })
}
