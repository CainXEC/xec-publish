export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { recordFeedNotification, resolveAccountByAddress } from '@/lib/feedNotifications'

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

async function fetchFollowerCount(admin, authorId) {
  const { count, error } = await admin
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('author_id', authorId)

  if (error) return { error }
  return { followerCount: count ?? 0 }
}

export async function GET(request) {
  const walletAddress = request.nextUrl.searchParams.get('walletAddress')?.trim()
  const authorId = request.nextUrl.searchParams.get('authorId')?.trim()

  if (!isNonEmptyString(walletAddress) || !isNonEmptyString(authorId)) {
    return NextResponse.json(
      { error: 'walletAddress and authorId are required non-empty strings' },
      { status: 400 },
    )
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json(
      { error: 'Server configuration error: missing Supabase admin credentials' },
      { status: 500 },
    )
  }

  const { data: row, error: rowError } = await admin
    .from('follows')
    .select('author_id')
    .eq('reader_wallet_address', walletAddress)
    .eq('author_id', authorId)
    .maybeSingle()

  if (rowError) {
    return NextResponse.json({ error: rowError.message }, { status: 500 })
  }

  const { followerCount, error: countError } = await fetchFollowerCount(admin, authorId)
  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 })
  }

  return NextResponse.json({
    following: Boolean(row),
    followerCount,
  })
}

export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const walletAddress =
    typeof body?.walletAddress === 'string' ? body.walletAddress.trim() : ''
  const authorId = typeof body?.authorId === 'string' ? body.authorId.trim() : ''

  if (!isNonEmptyString(walletAddress) || !isNonEmptyString(authorId)) {
    return NextResponse.json(
      { error: 'walletAddress and authorId are required non-empty strings' },
      { status: 400 },
    )
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json(
      { error: 'Server configuration error: missing Supabase admin credentials' },
      { status: 500 },
    )
  }

  const { data: existing, error: existingError } = await admin
    .from('follows')
    .select('author_id')
    .eq('reader_wallet_address', walletAddress)
    .eq('author_id', authorId)
    .maybeSingle()

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 })
  }

  if (existing) {
    const { error: deleteError } = await admin
      .from('follows')
      .delete()
      .eq('reader_wallet_address', walletAddress)
      .eq('author_id', authorId)

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    const { followerCount, error: countError } = await fetchFollowerCount(admin, authorId)
    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 })
    }

    return NextResponse.json({ following: false, followerCount })
  }

  const { error: insertError } = await admin.from('follows').insert({
    reader_wallet_address: walletAddress,
    author_id: authorId,
  })

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Surface the follow in the account's unified bell (feed_notifications), the
  // single notification store — the legacy author-keyed `notifications` table is
  // retired. Best-effort: resolve the author to its account (recipient) and the
  // reader wallet to its account + byline (actor). If the reader has no account
  // (a stray wallet that never logged in), we can't attribute it, so we skip —
  // same silent no-op the feed bell already tolerates.
  try {
    const [{ data: recipientAcct }, actor] = await Promise.all([
      admin.from('accounts').select('id').eq('author_id', authorId).maybeSingle(),
      resolveAccountByAddress(admin, walletAddress),
    ])
    if (recipientAcct?.id && actor) {
      await recordFeedNotification(admin, {
        recipientAccountId: recipientAcct.id,
        actorAccountId: actor.accountId,
        actorIdentity: actor.identity,
        type: 'follow',
      })
    }
  } catch {
    /* best-effort; the follow itself already succeeded */
  }

  const { followerCount, error: countError } = await fetchFollowerCount(admin, authorId)
  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 })
  }

  return NextResponse.json({ following: true, followerCount })
}
