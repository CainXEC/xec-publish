export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rateLimit'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'

/**
 * Toggle a feed-native block: the signed-in account blocks/unblocks another
 * account by id (accounts(id) on both sides — see sql/feed_blocks.sql).
 *
 * A block is directional as an action but mutual in effect (neither sees the
 * other; the blocked party can't reply). Blocking also drops any follow edge in
 * EITHER direction so a blocked account can't linger in a Following feed.
 *
 * Session-authorized (no payment): only the account in the session cookie can
 * change its own blocks. Returns { ok, blocked } where `blocked` is the state
 * AFTER the toggle.
 */
export async function POST(request) {
  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 60, 60, 'feed-block'))) {
    return NextResponse.json({ ok: false, error: 'Too many requests.' }, { status: 429 })
  }

  const acct = await getAuthedAccount()
  if (!acct) {
    return NextResponse.json({ ok: false, error: 'Sign in to block.' }, { status: 401 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  }

  const blockedAccountId =
    typeof body?.blockedAccountId === 'string' ? body.blockedAccountId.trim() : ''
  if (!blockedAccountId) {
    return NextResponse.json({ ok: false, error: 'Missing account to block.' }, { status: 400 })
  }
  if (blockedAccountId === acct.accountId) {
    return NextResponse.json({ ok: false, error: "You can't block yourself." }, { status: 400 })
  }

  const supabase = adminDb()

  const { data: existing, error: existingErr } = await supabase
    .from('feed_blocks')
    .select('blocked_account_id')
    .eq('blocker_account_id', acct.accountId)
    .eq('blocked_account_id', blockedAccountId)
    .maybeSingle()
  if (existingErr) {
    return NextResponse.json({ ok: false, error: existingErr.message }, { status: 500 })
  }

  if (existing) {
    const { error: deleteErr } = await supabase
      .from('feed_blocks')
      .delete()
      .eq('blocker_account_id', acct.accountId)
      .eq('blocked_account_id', blockedAccountId)
    if (deleteErr) {
      return NextResponse.json({ ok: false, error: deleteErr.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, blocked: false })
  }

  const { error: insertErr } = await supabase.from('feed_blocks').insert({
    blocker_account_id: acct.accountId,
    blocked_account_id: blockedAccountId,
  })
  // A concurrent insert can lose the PK race; treat the resulting duplicate as
  // the desired end state (blocked) rather than an error.
  if (insertErr && insertErr.code !== '23505') {
    return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 })
  }

  // Blocking severs any follow edge in either direction (best-effort — the block
  // is what matters, so a follow-delete hiccup shouldn't fail the request). Two
  // explicit deletes rather than an interpolated .or() filter, so a crafted id
  // can never smuggle extra PostgREST filter syntax.
  const [{ error: unfollowMineErr }, { error: unfollowTheirsErr }] = await Promise.all([
    supabase
      .from('feed_follows')
      .delete()
      .eq('follower_account_id', acct.accountId)
      .eq('followee_account_id', blockedAccountId),
    supabase
      .from('feed_follows')
      .delete()
      .eq('follower_account_id', blockedAccountId)
      .eq('followee_account_id', acct.accountId),
  ])
  if (unfollowMineErr || unfollowTheirsErr) {
    console.error(
      '[feed-block] follow cleanup failed (block still applied)',
      unfollowMineErr || unfollowTheirsErr,
    )
  }

  return NextResponse.json({ ok: true, blocked: true })
}
