import { verifyCookieValue } from '@/lib/cookieSigner'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { accountUnlockAddressForms } from '@/lib/accountUnlockAddresses'

/**
 * Server-side "is this reader entitled to full post content?"
 *
 * The AUTHOR of a post reads their own locked content free — recognized via
 * the wallet session (pow_session / getAuthedAccount), server-side, since this
 * is what decides whether the SSR response includes the locked body. Everyone
 * ELSE — admins included — pays: on-brand for "proof of writing" (nobody is
 * exempt from the paywall, so reader counts and the Live rail stay honest), and
 * an admin's real unlock pays the author and counts like any reader.
 *
 * A reader is entitled two ways, checked in order:
 *  1. Their logged-in ACCOUNT has an unlock on record — matched against the
 *     unlock's payer_address over every address the account has proven (login
 *     wallet, still-linked old wallet, Pocket). This makes an unlock follow the
 *     account across devices and cookie loss: once you've paid from any wallet
 *     you've proven, a signed-in you reads it everywhere on the FIRST render,
 *     no paywall flash and no accidental re-purchase. Same trust model as
 *     /api/check-unlock (proven addresses only — never a client-named one).
 *  2. Fallback: the signed unlock cookie verified against the unlocks row by
 *     txid (mirrors comment DELETE entitlement) — covers logged-out readers on
 *     the device that paid.
 */
export async function verifyPostReaderEntitlement(postId, authorId, cookieStore) {
  const id = typeof postId === 'string' ? postId.trim() : ''
  if (!id) return false

  const supabase = adminDb()

  // author reading their OWN post — proven by the wallet session, server-side.
  // (Admins are deliberately NOT exempt: they pay to unlock like everyone else.)
  const acct = await getAuthedAccount()
  if (acct) {
    if (acct.authorId && authorId && acct.authorId === authorId) return true

    // reader — the logged-in account itself has unlocked this post from one of
    // its proven addresses (any device, cookie or not).
    if (acct.accountId) {
      const forms = await accountUnlockAddressForms(supabase, acct.accountId, acct.address)
      if (forms.length) {
        const { data: accountUnlock } = await supabase
          .from('unlocks')
          .select('id')
          .eq('post_id', id)
          .in('payer_address', forms)
          .limit(1)
          .maybeSingle()
        if (accountUnlock) return true
      }
    }
  }

  // reader — signed unlock cookie verified against the unlocks row by txid
  const rawCookie = cookieStore.get(`unlock_${id}`)?.value
  const { valid, txid } = verifyCookieValue(id, rawCookie)
  if (!valid || !String(txid).trim()) {
    return false
  }

  const txidTrim = String(txid).trim()
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
