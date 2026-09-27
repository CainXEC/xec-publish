// =============================================================================
//  lib/onboarding.js — server helpers for the walletless-onboarding funnel.
//
//  A brand-new visitor makes a free Cashtab web wallet (42 XEC free), logs in
//  (a 6-XEC challenge leaves ~36 — below the 100-XEC action floor), then claims
//  the welcome gift (XEC + POW) from the new-user faucet (lib/faucet.ts) via the
//  card at the top of the feed. The card stays until they act on the site.
//
//  "Brand-new" is an ACTIVITY PROXY, not an on-chain balance read: never tipped
//  (feed_tips.to_account_id), never posted, never reacted. Any of those flips it
//  off, so an already-active account never sees the card. Three cheap, account-
//  keyed existence checks, run in parallel; no Chronik. The faucet itself adds
//  the on-chain Cashtab-origin check before paying anything.
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
