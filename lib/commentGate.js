// Shared "who is allowed to comment, and as whom" gate for the paid-comment
// routes (prepare + confirm). Extracted verbatim from the original free-comment
// POST handler so identity is decided SERVER-SIDE from proven auth only — the
// request body's address is never trusted.
//
// A commenter must be a proven reader of the article: the post's author, a
// logged-in account whose address unlocked it, or (same-device fallback) the
// signed unlock cookie resolved to its proven payer address. Admins are NOT
// exempt — they unlock like any reader (comment moderation is separate).

import { verifyCookieValue } from '@/lib/cookieSigner'
import { getAuthedAccount } from '@/lib/authHelpers'
import { resolveProfileByIdentifier } from '@/lib/resolveProfile'

/** Ensure an ecash address is in `ecash:`-prefixed form (what on-chain verify
 *  compares against). BIP21 builders strip the prefix themselves. */
export function toEcashAddr(a) {
  const s = typeof a === 'string' ? a.trim() : ''
  if (!s) return ''
  return s.startsWith('ecash:') ? s : `ecash:${s}`
}

/**
 * Resolve who a reply to `parent` should pay (94/6), for any comment — paid or
 * legacy free. Returns { payoutAddress, parentTxid, parentAccountId } or null if
 * the parent's author can't be paid.
 *   - Paid comment: payout_address snapshot + its txid (on-chain REPLY target).
 *   - Legacy free comment: no snapshot/txid — resolve the stored payer identity
 *     ("@handle" or a raw address) to a payable address; the reply is a plain
 *     POST on-chain (no target) that still splits 94/6 to that address.
 */
export async function resolveParentPayout(parent) {
  if (!parent) return null

  if (parent.payout_address) {
    return {
      payoutAddress: toEcashAddr(parent.payout_address),
      parentTxid: parent.txid || null,
      parentAccountId: parent.author_account_id || null,
    }
  }

  const raw = typeof parent.payer_address === 'string' ? parent.payer_address.trim() : ''
  if (!raw) return null
  const bare = raw.startsWith('@') ? raw.slice(1) : raw
  const profile = await resolveProfileByIdentifier(bare).catch(() => null)
  const resolved = profile?.author?.xec_address || profile?.holderAddress || null
  // If the stored value was itself an address and nothing resolved, pay it directly.
  const looksLikeAddress = /^(ecash:)?[a-z0-9]{40,}$/i.test(raw)
  const payout = resolved || (looksLikeAddress ? raw : null)
  if (!payout) return null
  return { payoutAddress: toEcashAddr(payout), parentTxid: parent.txid || null, parentAccountId: null }
}

/** All stored forms of an ecash address, prefix-agnostic (matches /api/me). */
export function addressForms(address) {
  const a = typeof address === 'string' ? address.trim() : ''
  if (!a) return []
  return a.startsWith('ecash:') ? [a, a.slice('ecash:'.length)] : [a, `ecash:${a}`]
}

/** Is this session the author of the post? Author-only by design: commenting
 *  requires having unlocked the post (paid), and admins are NOT exempt from that
 *  — same "nobody bypasses the paywall" rule as article reads. An admin comments
 *  by unlocking first, like any reader. (Comment MODERATION/deletion keeps its
 *  own admin power in app/api/comments/[postId]/route.js — that's oversight, not
 *  a paid action.) The author writes their own post, so they comment free. */
async function isPostAuthor(acct, postId, supabase) {
  if (!acct?.authorId) return false
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
    if (await isPostAuthor(acct, postId, supabase)) {
      return { ok: true, identity: acct.identity, accountId: acct.accountId ?? null, address: acct.address ?? null }
    }
    // Logged-in reader (admins included) — allowed only if this account's
    // address unlocked the post.
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
