export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'

const supabase = createServerSupabase()

export async function GET(_request, { params }) {
  const { postId } = await params
  if (!postId) {
    return NextResponse.json({ error: 'Missing postId' }, { status: 400 })
  }

  const { count, error } = await supabase
    .from('comments')
    .select('id', { count: 'exact', head: true })
    .eq('post_id', postId)
    .is('deleted_at', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ count: count ?? 0 })
}
