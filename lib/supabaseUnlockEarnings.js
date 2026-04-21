import { UNLOCK_COUNT_RPC_BATCH } from '@/lib/supabaseUnlockCounts'

/** Map RPC `get_unlock_earnings` rows to post_id → sum(total_amount). */
export function sumAmountRowsByPostId(rows) {
  const map = {}
  if (!Array.isArray(rows)) return map
  for (const r of rows) {
    if (r?.post_id == null) continue
    const n =
      typeof r.total_amount === 'number' ? r.total_amount : Number(r.total_amount)
    map[r.post_id] = Number.isFinite(n) ? n : 0
  }
  return map
}

/** Call `get_unlock_earnings` in batches; returns merged `{ post_id, total_amount }[]`. */
export async function fetchAllUnlockEarningsRows(supabase, postIds, since) {
  const rows = []
  for (let i = 0; i < postIds.length; i += UNLOCK_COUNT_RPC_BATCH) {
    const batch = postIds.slice(i, i + UNLOCK_COUNT_RPC_BATCH)
    const { data, error } = await supabase.rpc('get_unlock_earnings', {
      post_ids: batch,
      since,
    })
    if (error) return { error, rows: null }
    if (Array.isArray(data)) rows.push(...data)
  }
  return { error: null, rows }
}
