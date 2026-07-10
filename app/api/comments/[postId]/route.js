export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { verifyCookieValue } from '@/lib/cookieSigner'
import { createServerSupabase } from '@/lib/supabase-server'
import { getAuthedAccount } from '@/lib/authHelpers'

const supabase = createServerSupabase()

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
    .select('id, payer_address, content, created_at')
    .eq('post_id', postId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ comments: data ?? [] })
}

export async function POST(request, { params }) {
  const { postId } = await params
  if (!postId) {
    return NextResponse.json({ error: 'Missing postId' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const rawContent = typeof body?.content === 'string' ? body.content : ''
  if (rawContent.length > 500) {
    return NextResponse.json(
      { error: 'Comment must be 500 characters or less' },
      { status: 400 },
    )
  }
  const content = rawContent.trim()
  if (!content) {
    return NextResponse.json({ error: 'Comment content is required' }, { status: 400 })
  }

  const supabaseService = createServerSupabase()

  // Identity is decided SERVER-SIDE and stamped from proven auth only — the
  // request body's payer_address is never trusted.
  let verified = false
  let payerAddress = null

  const acct = await getAuthedAccount()

  if (acct) {
    if (await isAuthorOrAdmin(acct, postId, supabaseService)) {
      // author of this post / admin — stamp their display identity
      verified = true
      payerAddress = acct.identity
    } else {
      // logged-in reader — allowed only if this account's address unlocked it
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
          verified = true
          payerAddress = acct.identity
        }
      }
    }
  }

  // Fallback for a paid reader who isn't logged in as a session (same device):
  // the signed unlock cookie -> stamp the PROVEN address from its unlock row.
  if (!verified) {
    const rawCookie = request.cookies.get(`unlock_${postId}`)?.value
    const { valid, txid } = verifyCookieValue(postId, rawCookie)
    if (valid && String(txid).trim()) {
      const { data: unlockRow, error: unlockError } = await supabaseService
        .from('unlocks')
        .select('payer_address')
        .eq('post_id', postId)
        .eq('txid', String(txid).trim())
        .maybeSingle()
      if (unlockError) {
        return NextResponse.json({ error: unlockError.message }, { status: 500 })
      }
      const proven =
        typeof unlockRow?.payer_address === 'string'
          ? unlockRow.payer_address.trim()
          : ''
      if (proven) {
        verified = true
        payerAddress = proven
      }
    }
  }

  if (!verified) {
    return NextResponse.json(
      { error: 'Only unlocked readers can post comments' },
      { status: 403 },
    )
  }

  const { data: inserted, error: insertError } = await supabase
    .from('comments')
    .insert({
      post_id: postId,
      payer_address: payerAddress,
      content,
    })
    .select('id, payer_address, content, created_at')
    .single()

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ comment: inserted })
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

  const supabaseService = createServerSupabase()

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

  const { error: deleteError } = await supabaseService
    .from('comments')
    .delete()
    .eq('id', commentId)
    .eq('post_id', postId)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
