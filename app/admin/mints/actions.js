'use server'

// =============================================================================
//  app/admin/mints/actions.js — dismiss an unclaimed-payment alert.
//
//  Dismissing only closes the ALERT (mint_payment_alerts); it never delivers,
//  refunds or touches the payment. It needs a WRITTEN note (what the payment
//  was, or how it was settled — "my top-up", "refunded by hand in tx …") so
//  the record explains why money was left where it is. Re-checks isAdmin
//  server-side — a server action is a public endpoint, the page's notFound()
//  gate is not enough. Guarded on resolved_at IS NULL so a second tab can't
//  overwrite an earlier resolution.
// =============================================================================

import { revalidatePath } from 'next/cache'
import { getAuthedAccount } from '@/lib/authHelpers'
import { adminDb } from '@/lib/db'

const TXID_RE = /^[0-9a-f]{64}$/i

export async function dismissMintAlert(txid, note) {
  const acct = await getAuthedAccount()
  if (!acct?.isAdmin) return { error: 'Not authorized.' }
  if (typeof txid !== 'string' || !TXID_RE.test(txid)) return { error: 'Bad txid.' }
  const text = String(note ?? '').trim().slice(0, 1000)
  if (!text) return { error: 'Write a note: what this payment was, or how it was settled.' }

  const { data, error } = await adminDb()
    .from('mint_payment_alerts')
    .update({ resolved_at: new Date().toISOString(), resolution: 'dismissed', note: text })
    .eq('txid', txid)
    .is('resolved_at', null)
    .select('txid')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'Already resolved — reload the page.' }

  revalidatePath('/admin/mints')
  return { ok: true }
}
