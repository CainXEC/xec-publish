export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) {
    return NextResponse.json({ error: userError.message }, { status: 500 })
  }

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json(
      { error: 'Server configuration error: missing Supabase admin credentials' },
      { status: 500 },
    )
  }

  const { data, error } = await admin
    .from('unlocks')
    .select('amount_xec, post_id, posts!inner(author_id, legacy)')
    .eq('posts.author_id', user.id)
    .eq('posts.legacy', false)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = data ?? []
  let totalXec = 0
  for (const r of rows) {
    const s = Number(r.amount_xec)
    if (Number.isFinite(s)) totalXec += s
  }

  return NextResponse.json({
    total_unlocks: rows.length,
    total_xec: totalXec,
  })
}
