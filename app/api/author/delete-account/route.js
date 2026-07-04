export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthedAccount } from '@/lib/authHelpers'
import { clearSessionCookie } from '@/lib/session'

export async function DELETE() {
  const acct = await getAuthedAccount()
  if (!acct) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json(
      { error: 'Server configuration error: missing SUPABASE_SERVICE_ROLE_KEY' },
      { status: 500 },
    )
  }

  const { accountId, authorId } = acct

  // --- authorship cleanup (only if this account is linked to an author) ---
  if (authorId) {
    const { data: authorPosts, error: postsSelectError } = await admin
      .from('posts')
      .select('id')
      .eq('author_id', authorId)

    if (postsSelectError) {
      return NextResponse.json({ error: postsSelectError.message }, { status: 500 })
    }

    const postIds = (authorPosts ?? []).map((p) => p.id).filter(Boolean)
    if (postIds.length > 0) {
      const { error: commentsError } = await admin
        .from('comments')
        .delete()
        .in('post_id', postIds)
      if (commentsError) {
        return NextResponse.json({ error: commentsError.message }, { status: 500 })
      }
    }

    const { error: postsDeleteError } = await admin
      .from('posts')
      .delete()
      .eq('author_id', authorId)
    if (postsDeleteError) {
      return NextResponse.json({ error: postsDeleteError.message }, { status: 500 })
    }

    const { error: authorDeleteError } = await admin
      .from('authors')
      .delete()
      .eq('id', authorId)
    if (authorDeleteError) {
      return NextResponse.json({ error: authorDeleteError.message }, { status: 500 })
    }
  }

  // --- wallet identity cleanup (FK-safe order: addresses before the account) ---
  const { error: addrError } = await admin
    .from('account_addresses')
    .delete()
    .eq('account_id', accountId)
  if (addrError) {
    return NextResponse.json({ error: addrError.message }, { status: 500 })
  }

  const { error: acctError } = await admin
    .from('accounts')
    .delete()
    .eq('id', accountId)
  if (acctError) {
    return NextResponse.json({ error: acctError.message }, { status: 500 })
  }

  // log the user out (clear the session cookie)
  await clearSessionCookie()

  return NextResponse.json({ success: true })
}
