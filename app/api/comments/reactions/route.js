export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { rateLimit, getClientIp } from '@/lib/rateLimit'

/**
 * Who reacted to a COMMENT, and with what — the comment analogue of
 * /api/feed/reactions. Author-only: reactions are on-chain (the payer is public),
 * but we surface the reactor list only to the comment's own author, so an author
 * can see who reacted rather than being offered a pointless "react to yourself".
 * Newest first.
 *
 * GET ?txid=<64hex comment txid>  ->  { ok, reactors: [{ identity, emoji, at }] }
 */
export async function GET(request) {
  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 60, 60, 'comment-reactions-list'))) {
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
  const { data: comment } = await supabase
    .from('comments')
    .select('author_account_id')
    .eq('txid', txid)
    .maybeSingle()
  if (!comment) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  }
  if (comment.author_account_id !== acct.accountId) {
    return NextResponse.json({ ok: false, error: 'not your comment' }, { status: 403 })
  }

  const { data: rows } = await supabase
    .from('comment_events')
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
