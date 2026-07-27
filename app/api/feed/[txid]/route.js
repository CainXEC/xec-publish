export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { FEED_CACHE_TAG } from '@/lib/getFeed'

/**
 * Soft-delete a feed post/reply. Only the author (session account ==
 * author_account_id) may delete. The on-chain tx and its content hash are
 * permanent; this only tombstones the Supabase mirror so the content stops
 * being served. Idempotent — deleting an already-deleted post is a no-op.
 */
export async function DELETE(_request, context) {
  const raw = (await context.params)?.txid
  const txid = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(txid)) {
    return NextResponse.json({ error: 'Invalid post' }, { status: 400 })
  }

  const acct = await getAuthedAccount()
  if (!acct) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = adminDb()
  const { data: post, error: fetchError } = await supabase
    .from('feed_posts')
    .select('author_account_id, deleted_at')
    .eq('txid', txid)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }
  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }
  if (post.author_account_id !== acct.accountId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (post.deleted_at) {
    return NextResponse.json({ ok: true, status: 'deleted' })
  }

  const { error: updateError } = await supabase
    .from('feed_posts')
    .update({ deleted_at: new Date().toISOString() })
    .eq('txid', txid)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // Drop the deleted post from the shared For You cache promptly.
  revalidateTag(FEED_CACHE_TAG)

  return NextResponse.json({ ok: true, status: 'deleted' })
}
