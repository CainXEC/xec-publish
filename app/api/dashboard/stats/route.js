export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'

export async function GET() {
  const acct = await getAuthedAccount()
  if (!acct?.authorId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const authorId = acct.authorId

  const admin = adminDb()
  if (!admin) {
    return NextResponse.json(
      { error: 'Server configuration error: missing Supabase admin credentials' },
      { status: 500 },
    )
  }
  const { data, error } = await admin
    .from('unlocks')
    .select('amount_xec, post_id, posts!inner(author_id)')
    .eq('posts.author_id', authorId)
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
