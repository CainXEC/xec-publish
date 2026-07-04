import { verifyCookieValue } from '@/lib/cookieSigner'
import { createServerSupabase } from '@/lib/supabase-server'
import { getAuthedAccount } from '@/lib/authHelpers'

/**
 * Server-side "is this reader entitled to full post content?"
 *
 * Author (own post) and admin are recognized via the wallet session
 * (pow_session / getAuthedAccount) — this is what decides whether the SSR
 * response includes the locked body, so it must run server-side. Otherwise
 * fall back to the signed unlock cookie verified against the unlocks row by
 * txid (mirrors comment DELETE entitlement).
 */
export async function verifyPostReaderEntitlement(postId, authorId, cookieStore) {
  const id = typeof postId === 'string' ? postId.trim() : ''
  if (!id) return false

  // author (own post) or admin — proven by the wallet session, server-side
  const acct = await getAuthedAccount()
  if (acct) {
    if (acct.authorId && authorId && acct.authorId === authorId) return true
    if (acct.isAdmin) return true
  }

  // reader — signed unlock cookie verified against the unlocks row by txid
  const rawCookie = cookieStore.get(`unlock_${id}`)?.value
  const { valid, txid } = verifyCookieValue(id, rawCookie)
  if (!valid || !String(txid).trim()) {
    return false
  }

  const txidTrim = String(txid).trim()
  const supabase = createServerSupabase()
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
