export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { clearSessionCookie, getChallengeSession } from '@/lib/session'

export async function DELETE() {
  // Deleting an account is irreversible — it removes the author row, ALL of its
  // posts, and ALL comments on them. Require a challenge-scope session (the
  // nonce-proven login), so a weaker, race-mintable 'pay' session can never nuke
  // an account. A pay-only user is asked to log in properly first.
  const challenge = await getChallengeSession()
  if (!challenge) {
    return NextResponse.json(
      { error: 'Please log in again (a fresh wallet login) to delete your account.' },
      { status: 403 },
    )
  }

  const acct = await getAuthedAccount()
  if (!acct) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = adminDb()
  if (!admin) {
    return NextResponse.json(
      { error: 'Server configuration error: missing SUPABASE_SERVICE_ROLE_KEY' },
      { status: 500 },
    )
  }

  // Hard-delete the account and ALL of its data in one transaction, in FK-safe
  // order (see sql/delete_account.sql). This replaces the old sequential
  // per-table DELETEs, which skipped the feed tables and — because feed_posts /
  // feed_events reference accounts(id) with no ON DELETE rule — hit a FK
  // violation on the accounts delete for any feed-active account, leaving it
  // half-deleted. The RPC is atomic: on any error nothing is removed. Minted
  // handles are intentionally left untouched (on-chain NFTs, not DB-owned).
  const { error } = await admin.rpc('delete_account', { p_account_id: acct.accountId })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // log the user out (clear the session cookie)
  await clearSessionCookie()

  return NextResponse.json({ success: true })
}
