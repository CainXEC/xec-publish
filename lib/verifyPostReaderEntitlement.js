import { verifyCookieValue } from '@/lib/cookieSigner'
import { createServerSupabase } from '@/lib/supabase-server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

/**
 * Server-side "is this reader entitled to full post content?"
 * Mirrors comment DELETE entitlement: author session, then signed unlock cookie
 * verified against the unlocks row by txid (see app/api/comments/[postId]/route.js).
 */
export async function verifyPostReaderEntitlement(postId, authorId, cookieStore) {
  const id = typeof postId === 'string' ? postId.trim() : ''
  if (!id) return false

  const supabaseAuth = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser()

  if (user?.id && user.id === authorId) {
    return true
  }

  const supabase = createServerSupabase()

  if (user?.id) {
    const { data: authorRow } = await supabase
      .from('authors')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle()
    if (authorRow?.is_admin === true) {
      return true
    }
  }

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
