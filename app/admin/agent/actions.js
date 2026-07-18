'use server'

// =============================================================================
//  app/admin/agent/actions.js — approve / veto for the AI_SATOSHI essay queue.
//
//  These only flip agent_queue statuses; the agent (repo ai-satoshi) picks up
//  'approved' rows and publishes them on its own next scheduled run. Both
//  actions re-check isAdmin server-side — a server action is a public endpoint,
//  the page's notFound() gate is not enough. Updates are guarded with
//  .eq('status','pending') so a double-click or a second tab can never regress
//  an item the agent already moved on (approved → published/failed).
// =============================================================================

import { revalidatePath } from 'next/cache'
import { getAuthedAccount } from '@/lib/authHelpers'
import { createServerSupabase } from '@/lib/supabase-server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function gate(id) {
  const acct = await getAuthedAccount()
  if (!acct?.isAdmin) return { error: 'Not authorized.' }
  if (typeof id !== 'string' || !UUID_RE.test(id)) return { error: 'Bad item id.' }
  return null
}

export async function approveQueueItem(id) {
  const denied = await gate(id)
  if (denied) return denied

  const supabase = createServerSupabase()
  const { data, error } = await supabase
    .from('agent_queue')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'Item is no longer pending — reload the page.' }

  revalidatePath('/admin/agent')
  return { ok: true }
}

export async function vetoQueueItem(id, reason) {
  const denied = await gate(id)
  if (denied) return denied

  // RULES §7: unwritten taste doesn't compound. A veto without a written
  // reason must be impossible to land in the DB, not just discouraged in UI.
  const trimmed = String(reason ?? '').trim().slice(0, 2000)
  if (!trimmed) return { error: 'A written reason is required — unwritten taste doesn’t compound.' }

  const supabase = createServerSupabase()
  const { data, error } = await supabase
    .from('agent_queue')
    .update({ status: 'vetoed', veto_reason: trimmed })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'Item is no longer pending — reload the page.' }

  revalidatePath('/admin/agent')
  return { ok: true }
}
