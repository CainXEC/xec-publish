'use server'

import { revalidateTag } from 'next/cache'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthedAccount } from '@/lib/authHelpers'
import { isApprovedHandleColor } from '@/lib/handleColors'
import { FEED_CACHE_TAG } from '@/lib/getFeed'

// Color saves are FREE (session-gated only — unlike a 5.5 XEC post), so a
// crafted client could toggle colors in a loop and repeatedly bust the shared
// For You feed cache (a cache-stampede / amplification vector). Gate the feed
// invalidation behind a per-account cooldown persisted in the DB (robust across
// serverless instances, unlike in-memory), so an account can freshen the feed
// at most once per window. Normal use (an occasional pick) is still instant;
// abuse just rides the feed's own 30s revalidate window like everyone else.
const FEED_BUST_COOLDOWN_MS = 3 * 60 * 1000

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
 * @param {{ color?: string | null }} input
 * @returns {Promise<{ ok: true, color: string | null } | { ok: false, unauthorized?: boolean, error: string }>}
 */
export async function saveHandleColor(input = {}) {
  const acct = await getAuthedAccount()
  if (!acct) {
    return { ok: false, unauthorized: true, error: 'You must be signed in.' }
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return {
      ok: false,
      error: 'Server configuration error: missing Supabase admin credentials.',
    }
  }

  const raw = input.color == null ? '' : String(input.color).trim()
  const color = raw === '' ? null : raw
  if (color !== null && !isApprovedHandleColor(color)) {
    return { ok: false, error: 'Please pick one of the available handle colors.' }
  }

  // Read the current color + last feed-bust time so we can (a) skip a pointless
  // cache bust when the color didn't actually change, and (b) enforce the
  // per-account cooldown below.
  const { data: current } = await admin
    .from('accounts')
    .select('handle_color, feed_cache_busted_at')
    .eq('id', acct.accountId)
    .maybeSingle()

  const changed = (current?.handle_color ?? null) !== color
  const now = Date.now()
  const lastBust = current?.feed_cache_busted_at
    ? new Date(current.feed_cache_busted_at).getTime()
    : 0
  const mayBust = changed && now - lastBust > FEED_BUST_COOLDOWN_MS

  const update = { handle_color: color }
  if (mayBust) update.feed_cache_busted_at = new Date(now).toISOString()

  const { error } = await admin
    .from('accounts')
    .update(update)
    .eq('id', acct.accountId)
  if (error) return { ok: false, error: error.message }

  // The shared For You feed bakes each byline's color into its cached payload.
  // Drop that cache to freshen the color immediately — but only when the color
  // actually changed AND this account hasn't busted the feed within the cooldown
  // window, so free color toggling can't hammer the shared cache.
  if (mayBust) revalidateTag(FEED_CACHE_TAG)

  return { ok: true, color }
}
