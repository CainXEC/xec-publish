export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export async function GET() {
  const admin = createSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json(
      { error: 'Server configuration error: missing Supabase admin credentials' },
      { status: 500 },
    )
  }

  const { data, error } = await admin
    .from('unlocks')
    .select('id, amount_xec, posts!inner(published)')
    .eq('posts.published', true)

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
