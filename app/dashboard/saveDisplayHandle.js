'use server'

import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { addressHoldsToken } from '@/lib/heldHandles'

/**
 * Set (or clear) which handle the current wallet displays as its identity.
 *
 * A wallet can hold several handle NFTs but shows exactly one byline. This
 * binds `accounts.active_handle_token_id` + `display_handle` to the chosen
 * token, or clears them (display the raw address) when `tokenId` is null.
 *
 * Authorization is the wallet session — NOT authorId — because a paid-minter
 * who never wrote an article still needs to choose their display handle. The
 * decisive security check is ON-CHAIN: the session's proven address must
 * actually hold the token, so a crafted call can't claim a handle it doesn't
 * own. We also confirm the token is one of OUR handles before binding.
 *
 * @param {{ tokenId?: string | null }} input
 * @returns {Promise<{ ok: true, handle: string | null } | { ok: false, unauthorized?: boolean, error: string }>}
 */
export async function saveDisplayHandle(input = {}) {
  const acct = await getAuthedAccount()
  if (!acct) {
    return { ok: false, unauthorized: true, error: 'You must be signed in.' }
  }

  const admin = adminDb()

  const now = new Date().toISOString()
  const rawTokenId = input.tokenId
  const tokenId =
    rawTokenId == null || String(rawTokenId).trim() === ''
      ? null
      : String(rawTokenId).trim()

  // "Display as address" — clear the binding.
  if (tokenId === null) {
    const { error } = await admin
      .from('accounts')
      .update({
        active_handle_token_id: null,
        display_handle: null,
        display_handle_checked_at: now,
      })
      .eq('id', acct.accountId)
    if (error) return { ok: false, error: error.message }
    return { ok: true, handle: null }
  }

  // The token must be one of our handles.
  const { data: h } = await admin
    .from('handles')
    .select('handle')
    .eq('token_id', tokenId)
    .maybeSingle()
  if (!h?.handle) {
    return { ok: false, error: 'That handle was not found.' }
  }

  // The decisive check: does the proven wallet actually hold this token now?
  const holdsIt = await addressHoldsToken(acct.address, tokenId)
  if (!holdsIt) {
    return { ok: false, error: 'Your wallet does not currently hold that handle.' }
  }

  const { error } = await admin
    .from('accounts')
    .update({
      active_handle_token_id: tokenId,
      display_handle: h.handle,
      display_handle_checked_at: now,
    })
    .eq('id', acct.accountId)
  if (error) return { ok: false, error: error.message }

  return { ok: true, handle: h.handle }
}
