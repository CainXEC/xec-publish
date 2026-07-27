export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rateLimit'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { recordFeedNotification } from '@/lib/feedNotifications'

/**
 * Toggle a feed-native follow: the signed-in account follows/unfollows another
 * account by id. Keyed by accounts(id) on both sides (see sql/feed_follows.sql),
 * because feed_posts.author_account_id is an accounts(id) and most feed posters
 * are reader-only accounts with no author_id (so the legacy `follows` table,
 * keyed by author_id, can't represent them).
 *
 * Session-authorized (no payment): only the account in the session cookie can
 * change its own follows. Returns { ok, following } where `following` is the
 * state AFTER the toggle.
 */
export async function POST(request) {
  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 60, 60, 'feed-follow'))) {
    return NextResponse.json({ ok: false, error: 'Too many requests.' }, { status: 429 })
  }

  const acct = await getAuthedAccount()
  if (!acct) {
    return NextResponse.json({ ok: false, error: 'Sign in to follow.' }, { status: 401 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  }

  const followeeAccountId =
    typeof body?.followeeAccountId === 'string' ? body.followeeAccountId.trim() : ''
  if (!followeeAccountId) {
    return NextResponse.json({ ok: false, error: 'Missing account to follow.' }, { status: 400 })
  }
  if (followeeAccountId === acct.accountId) {
    return NextResponse.json({ ok: false, error: "You can't follow yourself." }, { status: 400 })
  }

  const supabase = adminDb()

  const { data: existing, error: existingErr } = await supabase
    .from('feed_follows')
    .select('followee_account_id')
    .eq('follower_account_id', acct.accountId)
    .eq('followee_account_id', followeeAccountId)
    .maybeSingle()
  if (existingErr) {
    return NextResponse.json({ ok: false, error: existingErr.message }, { status: 500 })
  }

  if (existing) {
    const { error: deleteErr } = await supabase
      .from('feed_follows')
      .delete()
      .eq('follower_account_id', acct.accountId)
      .eq('followee_account_id', followeeAccountId)
    if (deleteErr) {
      return NextResponse.json({ ok: false, error: deleteErr.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, following: false })
  }

  const { error: insertErr } = await supabase.from('feed_follows').insert({
    follower_account_id: acct.accountId,
    followee_account_id: followeeAccountId,
  })
  // A concurrent insert can lose the PK race; treat the resulting duplicate as
  // the desired end state (following) rather than an error.
  if (insertErr && insertErr.code !== '23505') {
    return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 })
  }

  // Notify the followee (best-effort; skipped on a duplicate re-follow race).
  if (!insertErr) {
    await recordFeedNotification(supabase, {
      recipientAccountId: followeeAccountId,
      actorAccountId: acct.accountId,
      actorIdentity: acct.identity,
      type: 'follow',
    })
  }

  return NextResponse.json({ ok: true, following: true })
}
