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
import { adminDb } from '@/lib/db'

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

  const supabase = adminDb()
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

/** File a commission: a subject C wants the agent to write about, optionally
 *  with up to 3 article links to read + respond to. The agent drafts the
 *  oldest open one on its next scheduled run (agent_assignments — created by
 *  ai-satoshi's sql/agent_assignments.sql), fetching the links at draft time
 *  so their text becomes the quotable 2026 fact pool. */
export async function createAssignment(subject, notes, links) {
  const acct = await getAuthedAccount()
  if (!acct?.isAdmin) return { error: 'Not authorized.' }

  const subj = String(subject ?? '').trim().slice(0, 300)
  if (!subj) return { error: 'A subject is required.' }
  const note = String(notes ?? '').trim().slice(0, 2000)

  const urls = String(links ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  if (urls.length > 3) return { error: 'At most 3 links per commission.' }
  for (const u of urls) {
    let parsed
    try {
      parsed = new URL(u)
    } catch {
      parsed = null
    }
    if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      return { error: `Not a valid link: ${u.slice(0, 80)}` }
    }
    // Podcast platforms serve show notes, not the interview — the agent can't
    // listen to audio. Refuse here with guidance rather than let the draft
    // attempt fail later (the agent refuses these too, belt and braces).
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    if (host === 'open.spotify.com' || host === 'podcasts.apple.com') {
      return {
        error:
          'Podcast audio can’t be read — link the episode’s YouTube upload instead, or a page with a published transcript.',
      }
    }
  }

  const supabase = adminDb()
  // Only send the links column when links were given — a link-less commission
  // then still works on a table created before the links ALTER ran.
  const row = { subject: subj, notes: note || null }
  if (urls.length) row.links = urls
  const { error } = await supabase.from('agent_assignments').insert(row)
  if (error) return { error: error.message }

  revalidatePath('/admin/agent')
  return { ok: true }
}

/** Withdraw a commission the agent hasn't drafted yet (or clear a failed one).
 *  Drafted assignments are final — their essay already sits in the queue. */
export async function dismissAssignment(id) {
  const denied = await gate(id)
  if (denied) return denied

  const supabase = adminDb()
  const { data, error } = await supabase
    .from('agent_assignments')
    .update({ status: 'dismissed' })
    .eq('id', id)
    .in('status', ['open', 'failed'])
    .select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'Commission already handled — reload the page.' }

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

  const supabase = adminDb()
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
