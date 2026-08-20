export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'
import { displayHandlesByAccountId } from '@/lib/authorDisplayHandles'
import { splitForumContent } from '@/lib/forumPost'

/**
 * Resolve an on-site feed-post txid to the shallow preview QuotedEmbed renders.
 * Used to hydrate the embed for a freshly-posted feed entry that pasted a
 * /feed/<txid> link (the confirm route returns an undecorated post, so the
 * client fetches the preview here) — server-rendered feeds get the same shape
 * attached in getFeed (attachLinkedPosts + attachLiveIdentity). The byline is
 * resolved LIVE from the target's current handle, matching the feed. Returns 404
 * for an unknown txid; a deleted target resolves with content withheld.
 */
export async function GET(request) {
  const txid = request.nextUrl.searchParams.get('txid')?.trim().toLowerCase() ?? ''
  if (!/^[0-9a-f]{64}$/.test(txid)) {
    return NextResponse.json({ ok: false, error: 'Bad txid.' }, { status: 400 })
  }

  const supabase = adminDb()
  const { data: row } = await supabase
    .from('feed_posts')
    .select('txid, content, title, deleted_at, author_account_id, author_identity, payer_address')
    .eq('txid', txid)
    .maybeSingle()

  if (!row) {
    return NextResponse.json({ ok: false, error: 'Post not found.' }, { status: 404 })
  }

  const handleMap = row.author_account_id
    ? await displayHandlesByAccountId([row.author_account_id], supabase)
    : {}
  const entry = row.author_account_id ? handleMap[row.author_account_id] : null
  const displayIdentity = entry?.handle
    ? `@${entry.handle}`
    : row.payer_address || row.author_identity

  const deleted = row.deleted_at != null
  // A titled forum post stores `title \n\n body`; split so the embed leads with
  // the title and shows just the body beneath it (matches getFeed's toClientPost).
  const body = row.title != null ? splitForumContent(row.content).body : row.content
  return NextResponse.json({
    ok: true,
    post: {
      txid: row.txid,
      title: deleted ? null : (row.title ?? null),
      content: deleted ? null : body,
      deleted,
      author_identity: row.author_identity,
      displayIdentity,
      displayColor: entry?.color ?? null,
    },
  })
}
