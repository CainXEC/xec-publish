'use server'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthedAccount } from '@/lib/authHelpers'

/**
 * Update the current author's profile (username + bio). Authorization is the
 * wallet session; the row is scoped to the session's authorId, so a crafted
 * call can't touch another author. Payout address (authors.xec_address) is NOT
 * editable here — it mirrors the proven login wallet by construction.
 *
 * @param {{ username?: string, bio?: string }} input
 * @returns {Promise<{ ok: true } | { ok: false, unauthorized?: boolean, field?: 'username', error: string }>}
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

  const username = String(input.username ?? '').trim()
  const bio = String(input.bio ?? '').trim()

  if (!username) {
    return { ok: false, field: 'username', error: 'Username is required.' }
  }
  if (!/^[a-z0-9_]+$/i.test(username)) {
    return {
      ok: false,
      field: 'username',
      error: 'Username can only contain letters, numbers, and underscores.',
    }
  }

  const { error: updateError } = await admin
    .from('authors')
    .update({ username, bio })
    .eq('id', acct.authorId)

  if (updateError) {
    // 23505 = unique_violation (username already taken)
    if (updateError.code === '23505') {
      return { ok: false, field: 'username', error: 'That username is already taken.' }
    }
    return { ok: false, error: updateError.message }
  }

  return { ok: true }
}
