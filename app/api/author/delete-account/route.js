export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export async function DELETE() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json(
      { error: 'Server configuration error: missing SUPABASE_SERVICE_ROLE_KEY' },
      { status: 500 },
    )
  }

  const userId = user.id

  const { data: authorPosts, error: postsSelectError } = await admin
    .from('posts')
    .select('id')
    .eq('author_id', userId)

  if (postsSelectError) {
    return NextResponse.json(
      { error: postsSelectError.message },
      { status: 500 },
    )
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
    .eq('author_id', userId)

  if (postsDeleteError) {
    return NextResponse.json({ error: postsDeleteError.message }, { status: 500 })
  }

  const { error: authorDeleteError } = await admin
    .from('authors')
    .delete()
    .eq('id', userId)

  if (authorDeleteError) {
    return NextResponse.json({ error: authorDeleteError.message }, { status: 500 })
  }

  const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId)

  if (authDeleteError) {
    return NextResponse.json({ error: authDeleteError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
