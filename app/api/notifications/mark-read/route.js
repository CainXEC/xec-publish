export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthedAccount } from '@/lib/authHelpers'

export async function GET() {
  const acct = await getAuthedAccount()
  if (!acct?.authorId) {
    return NextResponse.json({ count: 0 })
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({ count: 0 })
  }

  const { count, error } = await admin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('author_id', acct.authorId)
    .eq('read', false)

  if (error) {
    return NextResponse.json({ count: 0 })
  }

  return NextResponse.json({ count: count ?? 0 })
}
