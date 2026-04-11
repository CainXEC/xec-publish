/** PostgREST / RPC payload limits — batch large id lists. */
export const UNLOCK_COUNT_RPC_BATCH = 1000

/** Call `get_unlock_counts` in batches; returns merged `{ post_id, count }[]`. */
export async function fetchAllUnlockCountRows(supabase, postIds, since) {
  const rows = []
  for (let i = 0; i < postIds.length; i += UNLOCK_COUNT_RPC_BATCH) {
    const batch = postIds.slice(i, i + UNLOCK_COUNT_RPC_BATCH)
    const { data, error } = await supabase.rpc('get_unlock_counts', {
      post_ids: batch,
      since,
    })
    if (error) return { error, rows: null }
    if (Array.isArray(data)) rows.push(...data)
  }
  return { error: null, rows }
}
