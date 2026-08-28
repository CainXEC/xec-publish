// =============================================================================
//  lib/onboarding.js — server helpers for the walletless-onboarding funnel.
//
//  A brand-new visitor makes a free Cashtab web wallet (42 XEC free), logs in
//  (a 6-XEC challenge leaves ~36 — below the 100-XEC action floor), then shares
//  their profile on X so the founder can hand-tip them starter XEC. Until that
//  tip lands they see a "Claim starter XEC" card; after it they're funded and
//  the card disappears.
//
//  "Funded" is detected by an ACTIVITY PROXY, not an on-chain balance read: the
//  manual welcome tip is a feed_tips row (to_account_id), so the moment the
//  founder tips them the signal flips off — before they can even act. We also
//  treat any prior paid activity (a post or a reaction) as funded, so an already
//  active account never sees the card. Three cheap, account-keyed existence
//  checks, run in parallel; no Chronik. The one accepted edge: someone who
//  already holds XEC but hasn't acted yet briefly sees the card (harmless — they
//  ignore it).
// =============================================================================

import { adminDb } from '@/lib/db'

/**
 * True when `accountId` is a brand-new, unfunded account: it has never received
 * a tip and has never posted or reacted. Any of those three flips it to false.
 * @param {string|null|undefined} accountId
 * @returns {Promise<boolean>}
 */
export async function isBrandNewUnfunded(accountId) {
  const id = typeof accountId === 'string' ? accountId.trim() : ''
  if (!id) return false
  const db = adminDb()
  const has = async (query) => {
    const { data, error } = await query.limit(1)
    if (error) return true // fail "already funded" — never nag on a query hiccup
    return (data?.length ?? 0) > 0
  }
  const [tipped, posted, reacted] = await Promise.all([
    has(db.from('feed_tips').select('to_account_id').eq('to_account_id', id)),
    has(db.from('feed_posts').select('id').eq('author_account_id', id)),
    has(db.from('feed_events').select('actor_account_id').eq('actor_account_id', id)),
  ])
  return !tipped && !posted && !reacted
}

/**
 * The on-site profile path for an account — its live @handle if it holds one,
 * else its bare eCash address (the /@<address> route resolves either to the
 * account, matching components/ArticleComments.js profileHref). Returns null if
 * there's nothing linkable. This is the link that rides in the X share so the
 * founder knows which account to tip.
 * @param {{ handle?: string|null, address?: string|null }} account
 * @returns {string|null}
 */
export function accountProfilePath({ handle, address } = {}) {
  const h = typeof handle === 'string' ? handle.trim() : ''
  if (h) return `/@${encodeURIComponent(h)}`
  const bare = String(address ?? '').toLowerCase().replace(/^ecash:/, '')
  return /^[a-z0-9]{42}$/.test(bare) ? `/@${bare}` : null
}
