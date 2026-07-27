'use server'

import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { savePostCore } from '@/lib/savePostCore'

/**
 * Create or update a post the current author owns. Authorization is the wallet
 * session (getAuthedAccount); author_id is stamped from the session, never the
 * client. Publishing (nextPublished) is gated server-side on publish_paid so a
 * crafted call can't go live without payment.
 *
 * The write itself lives in lib/savePostCore.js, shared with the agent REST
 * routes (app/api/agent/article) so both paths run the identical transform
 * chain and publish gate.
 *
 * @param {{
 *   forceId?: string | null,
 *   nextPublished?: boolean,   // explicit publish action — triggers the payment gate
 *   isEditMode?: boolean,
 *   published?: boolean,       // current checkbox state (preserved on edit autosave)
 *   title?: string, slug?: string, body?: string, priceXec?: string | number,
 * }} input
 * @returns {Promise<{ ok: true, id: string | null, finalSlug: string }
 *   | { ok: false, unauthorized?: boolean, needsPayment?: boolean, id?: string, finalSlug?: string, error: string }>}
 */
export async function savePost(input = {}) {
  const acct = await getAuthedAccount()
  if (!acct?.authorId) {
    return { ok: false, unauthorized: true, error: 'You must be signed in.' }
  }

  const admin = adminDb()

  const result = await savePostCore(admin, acct.authorId, input)
  // storedBody is for the REST callers; the editor autosaves through this
  // action constantly, so don't echo the whole article back over the wire.
  delete result.storedBody
  return result
}
