export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// =============================================================================
//  /api/feed/poll/[txid] — read poll state (GET) and cast a vote (POST).
//
//  A poll is a feed_posts row with card_kind='poll' and
//  card_meta = { options:[{id,text}], eligibility:'handle'|'account' }. Voting
//  is FREE but account-gated: any logged-in account for 'account' polls, only
//  handle-holders for 'handle' polls. One immutable vote per account. The feed
//  cache never carries per-viewer vote state — the PollCard reads it live here.
// =============================================================================

import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { rateLimit, getClientIp } from '@/lib/rateLimit'

const isTxid = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/i.test(s)

// Load the poll's card_meta + tally its votes. Returns null if the txid isn't a
// live poll. Counts are keyed by option id; every option is present (0 default).
async function loadPoll(supabase, txid) {
  const { data: post } = await supabase
    .from('feed_posts')
    .select('txid, card_kind, card_meta, deleted_at')
    .eq('txid', txid)
    .maybeSingle()
  if (!post || post.card_kind !== 'poll' || post.deleted_at) return null

  const meta = post.card_meta ?? {}
  const options = Array.isArray(meta.options) ? meta.options : []
  const eligibility = meta.eligibility === 'handle' ? 'handle' : 'account'
  const optionIds = new Set(options.map((o) => o.id))

  const { data: votes } = await supabase
    .from('feed_poll_votes')
    .select('option_id')
    .eq('poll_txid', txid)

  const counts = Object.fromEntries(options.map((o) => [o.id, 0]))
  let total = 0
  for (const v of votes ?? []) {
    if (optionIds.has(v.option_id)) {
      counts[v.option_id] += 1
      total += 1
    }
  }
  return { options, eligibility, counts, total }
}

// Viewer-facing state layered on top of the tally: whether they're logged in,
// whether they're allowed to vote this poll, and which option they already
// picked (null if none). `acct` may be null (logged out).
async function viewerState(supabase, txid, poll, acct) {
  const loggedIn = Boolean(acct?.accountId)
  const eligible = loggedIn && (poll.eligibility === 'account' || Boolean(acct.handle))
  let yourVote = null
  if (loggedIn) {
    const { data: mine } = await supabase
      .from('feed_poll_votes')
      .select('option_id')
      .eq('poll_txid', txid)
      .eq('voter_account_id', acct.accountId)
      .maybeSingle()
    yourVote = mine?.option_id ?? null
  }
  return { loggedIn, eligible, yourVote }
}

export async function GET(_request, { params }) {
  const { txid } = await params
  if (!isTxid(txid)) {
    return NextResponse.json({ error: 'Invalid poll id' }, { status: 400 })
  }
  const supabase = adminDb()
  const poll = await loadPoll(supabase, txid)
  if (!poll) return NextResponse.json({ error: 'Poll not found' }, { status: 404 })

  const acct = await getAuthedAccount().catch(() => null)
  const viewer = await viewerState(supabase, txid, poll, acct)
  return NextResponse.json({ ok: true, ...poll, ...viewer })
}

export async function POST(request, { params }) {
  const { txid } = await params
  if (!isTxid(txid)) {
    return NextResponse.json({ error: 'Invalid poll id' }, { status: 400 })
  }

  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 30, 60, 'poll-vote'))) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
  }

  const acct = await getAuthedAccount().catch(() => null)
  if (!acct?.accountId) {
    return NextResponse.json({ error: 'Log in to vote.' }, { status: 401 })
  }

  let optionId = ''
  try {
    const body = await request.json()
    optionId = String(body?.optionId ?? '')
  } catch {
    /* handled below */
  }

  const supabase = adminDb()
  const poll = await loadPoll(supabase, txid)
  if (!poll) return NextResponse.json({ error: 'Poll not found' }, { status: 404 })

  if (!poll.options.some((o) => o.id === optionId)) {
    return NextResponse.json({ error: 'Unknown option' }, { status: 400 })
  }
  if (poll.eligibility === 'handle' && !acct.handle) {
    return NextResponse.json(
      { error: 'This poll is for handle-holders only.', code: 'needs_handle' },
      { status: 403 },
    )
  }

  // One immutable vote per account. If they already voted, don't change it —
  // just return the live state (idempotent). The UNIQUE(poll,voter) index is the
  // real guard against a race between the check and the insert.
  const { error: insErr } = await supabase
    .from('feed_poll_votes')
    .insert({ poll_txid: txid, voter_account_id: acct.accountId, option_id: optionId })
  if (insErr && insErr.code !== '23505') {
    return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  const fresh = await loadPoll(supabase, txid)
  const viewer = await viewerState(supabase, txid, fresh, acct)
  return NextResponse.json({ ok: true, ...fresh, ...viewer })
}
