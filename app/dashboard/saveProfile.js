'use server'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthedAccount } from '@/lib/authHelpers'

/**
 * Update the current author's profile (bio only). Authorization is the wallet
 * session; the row is scoped to the session's authorId, so a crafted call can't
 * touch another author. Username is now fixed and the payout address
 * (authors.xec_address) mirrors the proven login wallet by construction — neither
 * is editable here. Handle color lives in its own account-scoped action
 * (saveHandleColor) so reader-only holders can set it too.
 *
 * @param {{ bio?: string }} input
 * @returns {Promise<{ ok: true } | { ok: false, unauthorized?: boolean, error: string }>}
 */
export async function saveProfile(input = {}) {
  const acct = await getAuthedAccount()
  if (!acct?.authorId) {
    return { ok: false, unauthorized: true, error: 'You must be signed in.' }
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return {
      ok: false,
      error: 'Server configuration error: missing Supabase admin credentials.',
    }
  }

  const bio = String(input.bio ?? '').trim()

  const { error: updateError } = await admin
    .from('authors')
    .update({ bio })
    .eq('id', acct.authorId)
  if (updateError) {
    return { ok: false, error: updateError.message }
  }

  return { ok: true }
}
