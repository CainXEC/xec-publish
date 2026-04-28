export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { verifyCookieValue } from '@/lib/cookieSigner'
import { createServerSupabase } from '@/lib/supabase-server'
import { supabase } from '@/lib/supabase'

function truncateWallet(address) {
  if (!address || typeof address !== 'string') return null
  const trimmed = address.trim()
  return trimmed || null
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
  let payerAddress = truncateWallet(body?.payer_address)

  if (!content) {
    return NextResponse.json({ error: 'Comment content is required' }, { status: 400 })
  }

  let verified = false

  const authHeader = request.headers.get('authorization') || ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  const accessToken = match?.[1]
  if (accessToken) {
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken)
    if (!userError && userData?.user?.id) {
      const supabaseService = createServerSupabase()
      const { data: ownedPost, error: postError } = await supabaseService
        .from('posts')
        .select('id')
        .eq('id', postId)
        .eq('author_id', userData.user.id)
        .limit(1)
        .maybeSingle()
      if (!postError && ownedPost) {
        verified = true
        if (!payerAddress) {
          const { data: authorRow } = await supabaseService
            .from('authors')
            .select('username')
            .eq('id', userData.user.id)
            .maybeSingle()
          const username = String(authorRow?.username ?? '').trim()
          if (username) {
            payerAddress = `@${username}`
          }
        }
      }
    }
  }

  const rawCookie = request.cookies.get(`unlock_${postId}`)?.value
  if (!verified && rawCookie) {
    const { valid } = verifyCookieValue(postId, rawCookie)
    if (valid) verified = true
  }

  if (!verified && payerAddress) {
    const { data: unlockRow, error: unlockError } = await supabase
      .from('unlocks')
      .select('id')
      .eq('post_id', postId)
      .eq('payer_address', payerAddress)
      .limit(1)
      .maybeSingle()

    if (unlockError) {
      return NextResponse.json({ error: unlockError.message }, { status: 500 })
    }

    verified = Boolean(unlockRow)
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

  let canDelete = false

  const authHeader = request.headers.get('authorization') || ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  const accessToken = match?.[1]
  if (accessToken) {
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken)
    if (!userError && userData?.user?.id) {
      const { data: ownedPost, error: postError } = await supabaseService
        .from('posts')
        .select('id')
        .eq('id', postId)
        .eq('author_id', userData.user.id)
        .limit(1)
        .maybeSingle()
      if (!postError && ownedPost) {
        canDelete = true
      }
    }
  }

  if (!canDelete) {
    const rawCookie = request.cookies.get(`unlock_${postId}`)?.value
    const { valid, txid } = verifyCookieValue(postId, rawCookie)
    if (!valid || !String(txid).trim()) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const txidTrim = String(txid).trim()
    const { data: unlockRow, error: unlockError } = await supabaseService
      .from('unlocks')
      .select('payer_address')
      .eq('post_id', postId)
      .eq('txid', txidTrim)
      .maybeSingle()

    if (unlockError) {
      return NextResponse.json({ error: unlockError.message }, { status: 500 })
    }
    if (!unlockRow) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const verifiedPayer =
      typeof unlockRow.payer_address === 'string' ? unlockRow.payer_address.trim() : ''
    const commentPayer =
      typeof comment.payer_address === 'string' ? comment.payer_address.trim() : ''

    if (commentPayer !== verifiedPayer) {
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
