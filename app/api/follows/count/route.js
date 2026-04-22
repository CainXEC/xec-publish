export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export async function GET(request) {
  const authorId = request.nextUrl.searchParams.get('authorId')?.trim()

  if (typeof authorId !== 'string' || authorId.length === 0) {
    return NextResponse.json(
      { error: 'authorId is required as a non-empty string' },
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

  const { count, error } = await admin
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('author_id', authorId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ followerCount: count ?? 0 })
}
