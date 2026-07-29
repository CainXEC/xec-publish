export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { verifyCookieValue } from '@/lib/cookieSigner'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'

const supabase = adminDb()

/** All stored forms of an ecash address, prefix-agnostic (matches /api/me). */
function addressForms(address) {
  const a = typeof address === 'string' ? address.trim() : ''
  if (!a) return []
  return a.startsWith('ecash:') ? [a, a.slice('ecash:'.length)] : [a, `ecash:${a}`]
}

/** Is this session the author of the post, or an admin? */
async function isAuthorOrAdmin(acct, postId, supabaseService) {
  if (!acct) return false
  if (acct.isAdmin) return true
  if (!acct.authorId) return false
  const { data: ownedPost } = await supabaseService
    .from('posts')
    .select('id')
    .eq('id', postId)
    .eq('author_id', acct.authorId)
    .limit(1)
    .maybeSingle()
  return Boolean(ownedPost)
}

export async function GET(_request, { params }) {
  const { postId } = await params
  if (!postId) {
    return NextResponse.json({ error: 'Missing postId' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('comments')
    .select('id, txid, action, parent_id, parent_txid, payer_address, author_account_id, author_identity, content, created_at, deleted_at')
    .eq('post_id', postId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // AI-operated accounts (authors.is_ai) disclose an [AI] tag on their byline,
  // same as feed posts and the article byline. Resolve it per comment from the
  // stamped account id (comments link to accounts.id, whose author carries the
  // flag). Keyed independently of any handle, so an AI account still discloses
  // even without a display handle.
  const accountIds = [...new Set((data ?? []).map((c) => c.author_account_id).filter(Boolean))]
  const aiAccounts = new Set()
  // Live handle (accounts.display_handle), the chosen byline color
  // (accounts.handle_color), and the account's CURRENT primary address — the
  // three things a live byline needs, resolved per account.
  const handleByAccount = new Map()
  const colorByAccount = new Map()
  const primaryByAccount = new Map()
  if (accountIds.length > 0) {
    const [{ data: accts }, { data: primaries }] = await Promise.all([
      supabase
        .from('accounts')
        .select('id, display_handle, handle_color, authors(is_ai)')
        .in('id', accountIds),
      supabase
        .from('account_addresses')
        .select('account_id, address')
        .in('account_id', accountIds)
        .eq('is_primary', true),
    ])
    for (const a of accts ?? []) {
      const author = Array.isArray(a.authors) ? a.authors[0] : a.authors
      if (author?.is_ai === true) aiAccounts.add(a.id)
      if (a.display_handle) handleByAccount.set(a.id, a.display_handle)
      if (a.handle_color) colorByAccount.set(a.id, a.handle_color)
    }
    for (const r of primaries ?? []) {
      if (!primaryByAccount.has(r.account_id)) primaryByAccount.set(r.account_id, r.address)
    }
  }

  // Byline resolves LIVE from the account's CURRENT handle, exactly like feed
  // posts and article bylines (getFeed attachLiveIdentity): "@handle" if the
  // account still holds one, else its current primary address. The frozen
  // author_identity stays only as a last-resort fallback for legacy rows with
  // no linked account — so a handle since sold/renamed stops showing here.
  // Only a live handle byline carries the custom color (address bylines don't).
  const liveByline = (accountId, frozen, payer) => {
    const handle = accountId ? handleByAccount.get(accountId) : null
    if (handle) return `@${handle}`
    return (accountId && primaryByAccount.get(accountId)) || frozen || payer || null
  }

  // A deleted comment is kept as a tombstone (so replies under it keep their
  // context) but its content is never sent to the client. Legacy free comments
  // (txid IS NULL) come through unchanged. The account id resolves isAi, then is
  // dropped from the payload (no need to expose account UUIDs to the client).
  const comments = (data ?? []).map((c) => {
    const { author_account_id, ...rest } = c
    const isAi = author_account_id ? aiAccounts.has(author_account_id) : false
    const hasHandle = author_account_id ? handleByAccount.has(author_account_id) : false
    const color = hasHandle ? colorByAccount.get(author_account_id) ?? null : null
    const author_identity = liveByline(author_account_id, c.author_identity, c.payer_address)
    return c.deleted_at
      ? { ...rest, isAi, color: null, content: '', deleted: true }
      : { ...rest, isAi, color, author_identity, deleted: false }
  })

  return NextResponse.json({ comments })
}

/**
 * Comments are now PAID (pay-to-comment, like the feed). The free write path is
 * retired — the client posts via /api/comments/prepare → pay in Cashtab →
 * /api/comments/confirm, which verifies the on-chain payment before inserting.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'Comments now require payment. Use /api/comments/prepare and /api/comments/confirm.' },
    { status: 410 },
  )
}

export async function DELETE(request, { params }) {
  const { postId } = await params
  if (!postId) {
    return NextResponse.json({ error: 'Missing postId' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const commentId = body?.commentId
  if (!commentId) {
    return NextResponse.json({ error: 'Missing commentId' }, { status: 400 })
  }

  const supabaseService = adminDb()

  const { data: comment, error: commentError } = await supabaseService
    .from('comments')
    .select('id, post_id, payer_address')
    .eq('id', commentId)
    .eq('post_id', postId)
    .maybeSingle()

  if (commentError) {
    return NextResponse.json({ error: commentError.message }, { status: 500 })
  }
  if (!comment) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }

  const commentPayer =
    typeof comment.payer_address === 'string' ? comment.payer_address.trim() : ''

  let canDelete = false

  const acct = await getAuthedAccount()

  if (acct) {
    if (await isAuthorOrAdmin(acct, postId, supabaseService)) {
      // author of this post / admin — moderate any comment
      canDelete = true
    } else {
      // logged-in reader — delete only their own comment. Match against the
      // display identity AND both address forms (older comments were stamped
      // with the raw address before handles/identity existed).
      const owned = new Set(
        [acct.identity, ...addressForms(acct.address)].filter(Boolean),
      )
      if (commentPayer && owned.has(commentPayer)) canDelete = true
    }
  }

  // Fallback for a logged-out paid reader (same device): unlock cookie -> the
  // proven address on its unlock row must match the comment's stamped address.
  if (!canDelete) {
    const rawCookie = request.cookies.get(`unlock_${postId}`)?.value
    const { valid, txid } = verifyCookieValue(postId, rawCookie)
    if (!valid || !String(txid).trim()) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: unlockRow, error: unlockError } = await supabaseService
      .from('unlocks')
      .select('payer_address')
      .eq('post_id', postId)
      .eq('txid', String(txid).trim())
      .maybeSingle()

    if (unlockError) {
      return NextResponse.json({ error: unlockError.message }, { status: 500 })
    }
    if (!unlockRow) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const verifiedPayer =
      typeof unlockRow.payer_address === 'string' ? unlockRow.payer_address.trim() : ''
    if (!verifiedPayer || commentPayer !== verifiedPayer) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    canDelete = true
  }

  if (!canDelete) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Soft-delete (tombstone) so any replies hanging off this comment keep their
  // context. GET blanks the content and marks it deleted; the row stays for
  // thread structure and to preserve the on-chain txid/idempotency key.
  const { error: deleteError } = await supabaseService
    .from('comments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', commentId)
    .eq('post_id', postId)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
