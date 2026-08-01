export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { profileCacheTag } from '@/lib/getFeed'
import { FEED_ACTION } from '@/lib/feedProtocol'

// Only top-level posts show in the profile's Posts feed, so only those are
// pinnable (a reply lives in the Replies tab). Mirrors TOP_LEVEL_ACTIONS in getFeed.
const PINNABLE_ACTIONS = [FEED_ACTION.POST, FEED_ACTION.QUOTE]

/**
 * Pin / unpin one of YOUR OWN feed posts to the top of your profile timeline.
 * One pin per account (accounts.pinned_post_txid) — pinning replaces any prior
 * pin. Only the author (session account == author_account_id) may pin their post.
 *
 * Body: { txid, pinned }. pinned:true validates ownership of txid and stores it;
 * pinned:false clears the account's pin. The profile own-posts cache is
 * revalidated so the change shows promptly.
 */
export async function POST(request) {
  const acct = await getAuthedAccount()
  if (!acct?.accountId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const pinned = body?.pinned !== false // default to pin
  const supabase = adminDb()

  if (!pinned) {
    // Unpin: clear this account's pin (no txid needed).
    const { error } = await supabase
      .from('accounts')
      .update({ pinned_post_txid: null })
      .eq('id', acct.accountId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    revalidateTag(profileCacheTag(acct.accountId))
    return NextResponse.json({ ok: true, pinned: false })
  }

  const txid = typeof body?.txid === 'string' ? body.txid.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(txid)) {
    return NextResponse.json({ error: 'Invalid post' }, { status: 400 })
  }

  // The post must be the caller's OWN, live, top-level feed post.
  const { data: post, error: fetchError } = await supabase
    .from('feed_posts')
    .select('author_account_id, deleted_at, action')
    .eq('txid', txid)
    .maybeSingle()
  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }
  if (!post || post.deleted_at) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }
  if (post.author_account_id !== acct.accountId) {
    return NextResponse.json({ error: 'You can only pin your own post' }, { status: 403 })
  }
  if (!PINNABLE_ACTIONS.includes(post.action)) {
    return NextResponse.json({ error: 'Only a post can be pinned' }, { status: 400 })
  }

  const { error: updateError } = await supabase
    .from('accounts')
    .update({ pinned_post_txid: txid })
    .eq('id', acct.accountId)
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  revalidateTag(profileCacheTag(acct.accountId))
  return NextResponse.json({ ok: true, pinned: true, txid })
}
