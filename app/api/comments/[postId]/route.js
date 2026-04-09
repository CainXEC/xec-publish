export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { verifyCookieValue } from '@/lib/cookieSigner'
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
  const content = typeof body?.content === 'string' ? body.content.trim() : ''
  const payerAddress = truncateWallet(body?.payer_address)

  if (!content) {
    return NextResponse.json({ error: 'Comment content is required' }, { status: 400 })
  }

  let verified = false

  const rawCookie = request.cookies.get(`unlock_${postId}`)?.value
  if (rawCookie) {
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
  const payerAddress = truncateWallet(body?.payer_address)

  if (!commentId) {
    return NextResponse.json({ error: 'Missing commentId' }, { status: 400 })
  }

  const { data: comment, error: commentError } = await supabase
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
  if (payerAddress && comment.payer_address && payerAddress === comment.payer_address) {
    canDelete = true
  }

  if (!canDelete) {
    const authHeader = request.headers.get('authorization') || ''
    const match = authHeader.match(/^Bearer\s+(.+)$/i)
    const accessToken = match?.[1]
    if (accessToken) {
      const { data: userData, error: userError } = await supabase.auth.getUser(accessToken)
      if (!userError && userData?.user?.id) {
        const { data: ownedPost, error: postError } = await supabase
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
  }

  if (!canDelete) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error: deleteError } = await supabase
    .from('comments')
    .delete()
    .eq('id', commentId)
    .eq('post_id', postId)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
