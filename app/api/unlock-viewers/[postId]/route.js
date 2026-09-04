// =============================================================================
//  app/api/unlock-viewers/[postId]/route.js — who unlocked this article.
//
//  AUTHOR-ONLY. Reveals reader identities (who paid to unlock), so the gate is
//  strict: the session author must be THIS post's author. Anyone else — a
//  logged-out reader, another author, a plain reader — gets 403. Each unlock is
//  keyed by payer_address; we resolve it to the payer's account identity the
//  same way the feed/notifications do (current @handle → account's PRIMARY
//  address → the raw payer address for a stray wallet that never logged in).
//  Never surface the payer address itself when the account has a primary on
//  file — a Pocket-paid unlock stores the hot pocket address, not their wallet.
// =============================================================================

import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { displayHandlesByAccountId } from '@/lib/authorDisplayHandles'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bareOf = (addr) => String(addr ?? '').replace(/^ecash:/, '').toLowerCase()

export async function GET(_req, { params }) {
  const { postId: raw } = await params
  const postId = typeof raw === 'string' ? raw.trim() : ''
  if (!postId) return NextResponse.json({ ok: false, error: 'bad id' }, { status: 400 })

  const acct = await getAuthedAccount()
  if (!acct?.authorId) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })
  }

  const supabase = adminDb()

  // Gate: the requester must be the post's author. Resolve the post's author_id
  // and compare — never trust anything from the client.
  const { data: post } = await supabase
    .from('posts')
    .select('id, author_id')
    .eq('id', postId)
    .maybeSingle()
  if (!post) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  if (post.author_id !== acct.authorId) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const { data: unlockRows } = await supabase
    .from('unlocks')
    .select('payer_address, unlocked_at, amount_xec')
    .eq('post_id', postId)
    .order('unlocked_at', { ascending: false })
  const unlocks = unlockRows ?? []

  // Map every payer address (both stored forms) to its account, in one query.
  const forms = [
    ...new Set(
      unlocks
        .map((u) => bareOf(u.payer_address))
        .filter(Boolean)
        .flatMap((bare) => [bare, `ecash:${bare}`]),
    ),
  ]
  const accountByBare = new Map()
  if (forms.length > 0) {
    const { data: links } = await supabase
      .from('account_addresses')
      .select('account_id, address')
      .in('address', forms)
    for (const l of links ?? []) accountByBare.set(bareOf(l.address), l.account_id)
  }

  // Live byline (current @handle + color + AI flag) and the account's PRIMARY
  // address, for the accounts that unlocked.
  const accountIds = [...new Set([...accountByBare.values()])]
  const [handleMap, primaryRes] = await Promise.all([
    accountIds.length ? displayHandlesByAccountId(accountIds, supabase) : Promise.resolve({}),
    accountIds.length
      ? supabase
          .from('account_addresses')
          .select('account_id, address')
          .in('account_id', accountIds)
          .eq('is_primary', true)
      : Promise.resolve({ data: [] }),
  ])
  const primaryByAccount = new Map(
    (primaryRes.data ?? []).map((r) => [r.account_id, r.address]),
  )

  // One entry per unlocker (an account, or a stray wallet keyed by its address),
  // newest unlock first. A reader who paid from two linked wallets collapses to
  // one row rather than appearing twice.
  const seen = new Set()
  const viewers = []
  for (const u of unlocks) {
    const bare = bareOf(u.payer_address)
    if (!bare) continue
    const accountId = accountByBare.get(bare) ?? null
    const key = accountId ?? `addr:${bare}`
    if (seen.has(key)) continue
    seen.add(key)

    let identity
    let color = null
    let isAi = false
    if (accountId) {
      const entry = handleMap[accountId]
      if (entry?.handle) {
        identity = `@${entry.handle}`
        color = entry.color ?? null
        isAi = entry.isAi === true
      } else {
        identity = primaryByAccount.get(accountId) || `ecash:${bare}`
      }
    } else {
      identity = `ecash:${bare}` // a wallet that paid but never made an account
    }
    viewers.push({
      identity,
      color,
      isAi,
      unlockedAt: u.unlocked_at,
      amountXec: typeof u.amount_xec === 'number' ? u.amount_xec : null,
    })
  }

  return NextResponse.json({ ok: true, count: viewers.length, viewers })
}
