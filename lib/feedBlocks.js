// =============================================================================
//  lib/feedBlocks.js
//  The block graph (public.feed_blocks), keyed by accounts(id) on both sides.
//
//  A block is directional as an action but MUTUAL in effect: if A blocked B (or
//  B blocked A), neither should see the other's posts/replies and B can't reply
//  to A. So the read/reply paths care about the block relationship in EITHER
//  direction — that's what these helpers resolve.
// =============================================================================

/**
 * The set of account ids in a block relationship with `viewerAccountId` in
 * either direction — accounts the viewer has blocked, plus accounts that have
 * blocked the viewer. Feeds filter posts whose author is in this set. No viewer
 * id → empty set (nothing to hide).
 * @returns {Promise<Set<string>>}
 */
export async function blockedAccountIds(supabase, viewerAccountId) {
  const viewer = typeof viewerAccountId === 'string' ? viewerAccountId.trim() : ''
  if (!viewer) return new Set()

  const ids = new Set()
  const [{ data: iBlocked }, { data: blockedMe }] = await Promise.all([
    supabase.from('feed_blocks').select('blocked_account_id').eq('blocker_account_id', viewer),
    supabase.from('feed_blocks').select('blocker_account_id').eq('blocked_account_id', viewer),
  ])
  for (const r of iBlocked ?? []) if (r.blocked_account_id) ids.add(r.blocked_account_id)
  for (const r of blockedMe ?? []) if (r.blocker_account_id) ids.add(r.blocker_account_id)
  return ids
}

/**
 * Whether accounts `a` and `b` are in a block relationship in either direction.
 * Used to reject a reply when either party has blocked the other. Because a≠b is
 * required and both columns are constrained to the pair, a single row match in
 * either direction is enough.
 * @returns {Promise<boolean>}
 */
export async function isBlockedPair(supabase, a, b) {
  const x = typeof a === 'string' ? a.trim() : ''
  const y = typeof b === 'string' ? b.trim() : ''
  if (!x || !y || x === y) return false
  const { data } = await supabase
    .from('feed_blocks')
    .select('blocker_account_id')
    .in('blocker_account_id', [x, y])
    .in('blocked_account_id', [x, y])
    .limit(1)
  return (data?.length ?? 0) > 0
}

/**
 * Whether `viewerAccountId` has blocked `targetAccountId` (directional — the
 * "Unblock" affordance on a profile only shows when the viewer is the blocker).
 * @returns {Promise<boolean>}
 */
export async function viewerBlocksAccount(supabase, viewerAccountId, targetAccountId) {
  const viewer = typeof viewerAccountId === 'string' ? viewerAccountId.trim() : ''
  const target = typeof targetAccountId === 'string' ? targetAccountId.trim() : ''
  if (!viewer || !target || viewer === target) return false
  const { data } = await supabase
    .from('feed_blocks')
    .select('blocked_account_id')
    .eq('blocker_account_id', viewer)
    .eq('blocked_account_id', target)
    .maybeSingle()
  return Boolean(data)
}
