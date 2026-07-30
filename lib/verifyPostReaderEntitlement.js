import { verifyCookieValue } from '@/lib/cookieSigner'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'

/**
 * Server-side "is this reader entitled to full post content?"
 *
 * The AUTHOR of a post reads their own locked content free — recognized via
 * the wallet session (pow_session / getAuthedAccount), server-side, since this
 * is what decides whether the SSR response includes the locked body. Everyone
 * ELSE — admins included — pays: on-brand for "proof of writing" (nobody is
 * exempt from the paywall, so reader counts and the Live rail stay honest), and
 * an admin's real unlock pays the author and counts like any reader. Otherwise
 * fall back to the signed unlock cookie verified against the unlocks row by
 * txid (mirrors comment DELETE entitlement).
 */
export async function verifyPostReaderEntitlement(postId, authorId, cookieStore) {
  const id = typeof postId === 'string' ? postId.trim() : ''
  if (!id) return false

  // author reading their OWN post — proven by the wallet session, server-side.
  // (Admins are deliberately NOT exempt: they pay to unlock like everyone else.)
  const acct = await getAuthedAccount()
  if (acct) {
    if (acct.authorId && authorId && acct.authorId === authorId) return true
  }

  // reader — signed unlock cookie verified against the unlocks row by txid
  const rawCookie = cookieStore.get(`unlock_${id}`)?.value
  const { valid, txid } = verifyCookieValue(id, rawCookie)
  if (!valid || !String(txid).trim()) {
    return false
  }

  const txidTrim = String(txid).trim()
  const supabase = adminDb()
  const { data: unlockRow, error: unlockError } = await supabase
    .from('unlocks')
    .select('id')
    .eq('post_id', id)
    .eq('txid', txidTrim)
    .maybeSingle()

  if (unlockError || !unlockRow) {
    return false
  }

  return true
}
