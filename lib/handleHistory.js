// =============================================================================
//  lib/handleHistory.js
//  "Previously known as" for the profile header. Derived — no new table — from
//  the author_identity SNAPSHOT frozen onto every post/comment at write time, so
//  it reflects the handles an account has actually displayed over time and works
//  retroactively. Cheap: reads only identity + created_at for the one account.
//
//  Returns null when there's nothing to show (the account has only ever used one
//  handle, or none). Otherwise: the immediately-previous handle, when the current
//  one took over (the switch date), and how many distinct handles in total.
// =============================================================================

import { adminDb } from '@/lib/db'

// Generous ceiling on rows scanned per source. An account's handle history is a
// handful of names; this only bounds a pathologically prolific poster.
const ROW_CAP = 10000

const shortDateUTC = (ms) =>
  new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })

/**
 * @param {string|null} accountId  the profile's account id
 * @param {string|null} currentIdentity  the live byline ("@handle" or an address)
 * @returns {Promise<null | { previous: string, changedLabel: string|null, changedIso: string|null, totalHandles: number }>}
 */
export async function getHandleHistory(accountId, currentIdentity) {
  if (!accountId) return null
  const db = adminDb()

  const [posts, comments] = await Promise.all([
    db
      .from('feed_posts')
      .select('author_identity, created_at')
      .eq('author_account_id', accountId)
      .like('author_identity', '@%')
      .order('created_at', { ascending: true })
      .limit(ROW_CAP),
    db
      .from('comments')
      .select('author_identity, created_at')
      .eq('author_account_id', accountId)
      .like('author_identity', '@%')
      .not('txid', 'is', null)
      .order('created_at', { ascending: true })
      .limit(ROW_CAP),
  ])

  // One time-ordered stream of every @handle this account posted/commented under.
  const events = []
  const ingest = (rows) => {
    for (const r of rows ?? []) {
      const h = String(r.author_identity ?? '').trim()
      if (!h.startsWith('@')) continue
      const ms = Date.parse(r.created_at)
      if (Number.isFinite(ms)) events.push({ h, ms })
    }
  }
  ingest(posts.data)
  ingest(comments.data)
  events.sort((a, b) => a.ms - b.ms)

  // The live byline may be a handle they've not posted under yet (just switched),
  // so fold it into the distinct set even if it has no snapshot.
  const current = typeof currentIdentity === 'string' && currentIdentity.startsWith('@') ? currentIdentity : null
  const distinct = new Set(events.map((e) => e.h))
  if (current) distinct.add(current)
  if (distinct.size < 2) return null // only one handle ever (or none) — nothing to show

  let previous = null
  let changedMs = null
  const last = events[events.length - 1]
  if (current && last && last.h === current) {
    // The current byline IS what they most recently posted under: find where that
    // trailing run began — the most RECENT switch to the current handle — and the
    // handle immediately before it. Correct even when handles are cycled/reused.
    let i = events.length - 1
    while (i > 0 && events[i - 1].h === current) i--
    changedMs = events[i].ms
    previous = i > 0 ? events[i - 1].h : null
  } else {
    // Byline is an address, or a handle they've not posted under yet — we can't
    // date the switch, so just name the most recent handle that isn't the current.
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].h !== current) { previous = events[i].h; break }
    }
  }
  if (!previous) return null

  return {
    previous,
    changedLabel: changedMs != null ? shortDateUTC(changedMs) : null,
    changedIso: changedMs != null ? new Date(changedMs).toISOString() : null,
    totalHandles: distinct.size,
  }
}
