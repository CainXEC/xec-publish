export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthedAccount } from '@/lib/authHelpers'

// Mark notifications read for the signed-in author. Called two ways:
//   • dashboard "Mark all read"  -> body {}           -> mark every unread one
//   • viewing your own post      -> body { post_id }  -> mark that post's ones
export async function POST(request) {
  const acct = await getAuthedAccount()
  if (!acct?.authorId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'Unavailable' }, { status: 503 })
  }

  let postId = null
  try {
    const body = await request.json()
    const raw = body?.post_id
    if (raw != null && raw !== '') postId = raw
  } catch {
    /* empty / non-JSON body -> mark all */
  }

  let query = admin
    .from('notifications')
    .update({ read: true })
    .eq('author_id', acct.authorId)
    .eq('read', false)

  if (postId != null) {
    query = query.eq('post_id', postId)
  }

  const { error } = await query
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
