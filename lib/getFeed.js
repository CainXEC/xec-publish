import { createServerSupabase } from '@/lib/supabase-server'

const FEED_POST_COLUMNS =
  'id, txid, action, parent_txid, content, content_hash, author_account_id, author_identity, payer_address, payout_address, amount_sats, created_at, deleted_at'

/** Shape a DB row for the client. A soft-deleted post keeps its slot (so threads
 *  stay navigable) but its content is withheld and flagged as a tombstone. */
function toClientPost(row) {
  if (!row) return row
  const deleted = row.deleted_at != null
  return {
    ...row,
    content: deleted ? null : row.content,
    deleted,
  }
}

function replyCountsByTxid(rows) {
  const map = {}
  if (!Array.isArray(rows)) return map
  for (const r of rows) {
    if (r?.parent_txid == null) continue
    const n = typeof r.count === 'number' ? r.count : Number(r.count)
    map[r.parent_txid] = Number.isFinite(n) ? n : 0
  }
  return map
}

async function attachReplyCounts(supabase, posts) {
  const txids = posts.map((p) => p.txid).filter(Boolean)
  if (txids.length === 0) return posts.map((p) => ({ ...toClientPost(p), replyCount: 0 }))
  const { data } = await supabase.rpc('get_feed_reply_counts', { post_txids: txids })
  const counts = replyCountsByTxid(data ?? [])
  return posts.map((p) => ({ ...toClientPost(p), replyCount: counts[p.txid] ?? 0 }))
}

/**
 * Newest-first page of top-level feed posts (action = 1).
 * @returns {Promise<{ posts: object[], hasNextPage: boolean }>}
 */
export async function getFeedPage({ page = 1, pageSize = 25 } = {}) {
  const pageNum = Math.max(1, Number(page) || 1)
  const pageSizeNum = Math.max(1, Number(pageSize) || 25)
  const start = (pageNum - 1) * pageSizeNum
  const end = start + pageSizeNum - 1

  const supabase = createServerSupabase()
  const { data: rows, error } = await supabase
    .from('feed_posts')
    .select(FEED_POST_COLUMNS)
    .eq('action', 1)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(start, end)

  if (error) {
    throw new Error(error.message)
  }

  const rowsList = rows ?? []
  const posts = await attachReplyCounts(supabase, rowsList)
  return { posts, hasNextPage: rowsList.length === pageSizeNum }
}

/**
 * A single post plus its direct replies (oldest-first, conversation order).
 * @returns {Promise<{ post: object, replies: object[] } | null>}
 */
export async function getFeedThread(txid) {
  const clean = typeof txid === 'string' ? txid.trim().toLowerCase() : ''
  if (!clean) return null

  const supabase = createServerSupabase()
  const { data: postRow, error: postError } = await supabase
    .from('feed_posts')
    .select(FEED_POST_COLUMNS)
    .eq('txid', clean)
    .maybeSingle()

  if (postError) throw new Error(postError.message)
  if (!postRow) return null

  const { data: replyRows, error: replyError } = await supabase
    .from('feed_posts')
    .select(FEED_POST_COLUMNS)
    .eq('action', 2)
    .eq('parent_txid', clean)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (replyError) throw new Error(replyError.message)

  const [post] = await attachReplyCounts(supabase, [postRow])
  const replies = await attachReplyCounts(supabase, replyRows ?? [])
  return { post, replies }
}
