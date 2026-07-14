// Shared "who is allowed to comment, and as whom" gate for the paid-comment
// routes (prepare + confirm). Extracted verbatim from the original free-comment
// POST handler so identity is decided SERVER-SIDE from proven auth only — the
// request body's address is never trusted.
//
// A commenter must be a proven reader of the article: the post's author/admin,
// a logged-in account whose address unlocked it, or (same-device fallback) the
// signed unlock cookie resolved to its proven payer address.

import { verifyCookieValue } from '@/lib/cookieSigner'
import { getAuthedAccount } from '@/lib/authHelpers'

/** All stored forms of an ecash address, prefix-agnostic (matches /api/me). */
export function addressForms(address) {
  const a = typeof address === 'string' ? address.trim() : ''
  if (!a) return []
  return a.startsWith('ecash:') ? [a, a.slice('ecash:'.length)] : [a, `ecash:${a}`]
}

/** Is this session the author of the post, or an admin? */
async function isAuthorOrAdmin(acct, postId, supabase) {
  if (!acct) return false
  if (acct.isAdmin) return true
  if (!acct.authorId) return false
  const { data: ownedPost } = await supabase
    .from('posts')
    .select('id')
    .eq('id', postId)
    .eq('author_id', acct.authorId)
    .limit(1)
    .maybeSingle()
  return Boolean(ownedPost)
}

/**
 * Resolve the verified commenter for `postId`, or a deny reason.
 * @returns {Promise<{ ok: true, identity: string, accountId: string|null, address: string|null }
 *                   | { ok: false, status: number, error: string }>}
 *   `identity` is the byline to stamp (display identity for a logged-in reader,
 *   or the proven payer address for the cookie fallback). `accountId` is set only
 *   when the commenter is a logged-in account (used for notifications / bylines).
 */
export async function resolveCommenter(request, postId, supabase) {
  const acct = await getAuthedAccount()

  if (acct) {
    if (await isAuthorOrAdmin(acct, postId, supabase)) {
      return { ok: true, identity: acct.identity, accountId: acct.accountId ?? null, address: acct.address ?? null }
    }
    // Logged-in reader — allowed only if this account's address unlocked it.
    const forms = addressForms(acct.address)
    if (forms.length) {
      const { data: unlockRow } = await supabase
        .from('unlocks')
        .select('id')
        .eq('post_id', postId)
        .in('payer_address', forms)
        .limit(1)
        .maybeSingle()
      if (unlockRow) {
        return { ok: true, identity: acct.identity, accountId: acct.accountId ?? null, address: acct.address ?? null }
      }
    }
  }

  // Same-device fallback: the signed unlock cookie → the PROVEN address on its
  // unlock row.
  const rawCookie = request.cookies.get(`unlock_${postId}`)?.value
  const { valid, txid } = verifyCookieValue(postId, rawCookie)
  if (valid && String(txid).trim()) {
    const { data: unlockRow, error } = await supabase
      .from('unlocks')
      .select('payer_address')
      .eq('post_id', postId)
      .eq('txid', String(txid).trim())
      .maybeSingle()
    if (error) return { ok: false, status: 500, error: error.message }
    const proven = typeof unlockRow?.payer_address === 'string' ? unlockRow.payer_address.trim() : ''
    if (proven) return { ok: true, identity: proven, accountId: null, address: proven }
  }

  return { ok: false, status: 403, error: 'Only unlocked readers can comment' }
}
