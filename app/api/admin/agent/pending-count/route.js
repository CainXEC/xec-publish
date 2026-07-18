import { NextResponse } from 'next/server'
import { getAuthedAccount } from '@/lib/authHelpers'
import { createServerSupabase } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/agent/pending-count — how many AI_SATOSHI drafts await review.
 * Feeds the topbar AdminQueueChip. Non-admins (and signed-out) get a 404, the
 * same shape as the /admin/agent page itself — the route doesn't admit the
 * admin surface exists.
 */
export async function GET() {
  const acct = await getAuthedAccount()
  if (!acct?.isAdmin) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const supabase = createServerSupabase()
  const { count, error } = await supabase
    .from('agent_queue')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ count: count ?? 0 })
}
