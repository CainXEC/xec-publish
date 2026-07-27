'use server'

import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { isApprovedHandleColor } from '@/lib/handleColors'

/**
 * Set (or clear) the color the current wallet's handle appears in across the
 * site. Account-scoped (accounts.handle_color) and authorized by the wallet
 * session — NOT authorId — because a paid minter who holds a handle but never
 * wrote an article still needs to pick their color.
 *
 * Empty/null clears back to the default neon byline; any non-null value must be
 * one of the approved theme swatches, so a crafted call can't set an arbitrary
 * color (the DB CHECK enforces the same set as a backstop).
 *
 * No cache invalidation needed: the byline color is resolved LIVE from
 * accounts.handle_color on every feed read (outside the For You cache boundary —
 * see getCachedForYouPage), so a change here reflects immediately everywhere.
 *
 * @param {{ color?: string | null }} input
 * @returns {Promise<{ ok: true, color: string | null } | { ok: false, unauthorized?: boolean, error: string }>}
 */
export async function saveHandleColor(input = {}) {
  const acct = await getAuthedAccount()
  if (!acct) {
    return { ok: false, unauthorized: true, error: 'You must be signed in.' }
  }

  const admin = adminDb()

  const raw = input.color == null ? '' : String(input.color).trim()
  const color = raw === '' ? null : raw
  if (color !== null && !isApprovedHandleColor(color)) {
    return { ok: false, error: 'Please pick one of the available handle colors.' }
  }

  const { error } = await admin
    .from('accounts')
    .update({ handle_color: color })
    .eq('id', acct.accountId)
  if (error) return { ok: false, error: error.message }

  return { ok: true, color }
}
