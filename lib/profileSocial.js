// =============================================================================
//  lib/profileSocial.js
//  Profile-page social data keyed by ACCOUNT id (the feed_follows / feed_posts
//  world), resolved from the on-chain holder address of the handle being viewed.
//
//  A profile centers on whoever currently holds the handle. To wire it into the
//  account-keyed follow graph we map that holder address -> account id, then read
//  follower counts and the viewer's own follow state against feed_follows. A
//  holder with no proofofwriting account (a fresh paid mint that never logged in)
//  has no account id -> zero followers, no follow button.
// =============================================================================

import { createServerSupabase } from '@/lib/supabase-server'
import { normalizeAddress } from '@/lib/resolveProfile'

/** Both stored forms of an address, so lookups match whether or not the column
 *  keeps the "ecash:" prefix. */
function addressForms(bare) {
  return [bare, `ecash:${bare}`]
}

/** The account id linked to a wallet address, or null if none is bound. */
export async function accountIdForAddress(addressRaw) {
  const bare = normalizeAddress(addressRaw)
  if (!bare) return null
  const supabase = createServerSupabase()
  const { data } = await supabase
    .from('account_addresses')
    .select('account_id')
    .in('address', addressForms(bare))
    .limit(1)
  return data?.[0]?.account_id ?? null
}

/** How many accounts follow this one (feed_follows.followee_account_id). */
export async function followerCountForAccount(accountId) {
  if (!accountId) return 0
  const supabase = createServerSupabase()
  const { count } = await supabase
    .from('feed_follows')
    .select('followee_account_id', { count: 'exact', head: true })
    .eq('followee_account_id', accountId)
  return count ?? 0
}

/** Whether the signed-in viewer already follows this account. Own profile → false. */
export async function viewerFollowsAccount(viewerAccountId, followeeAccountId) {
  if (!viewerAccountId || !followeeAccountId || viewerAccountId === followeeAccountId) {
    return false
  }
  const supabase = createServerSupabase()
  const { data } = await supabase
    .from('feed_follows')
    .select('followee_account_id')
    .eq('follower_account_id', viewerAccountId)
    .eq('followee_account_id', followeeAccountId)
    .maybeSingle()
  return Boolean(data)
}
