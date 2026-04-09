export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(_request, { params }) {
  const { postId } = await params
  if (!postId) {
    return NextResponse.json({ error: 'Missing postId' }, { status: 400 })
  }

  const { count, error } = await supabase
    .from('comments')
    .select('id', { count: 'exact', head: true })
    .eq('post_id', postId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ count: count ?? 0 })
}
