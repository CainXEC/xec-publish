'use server'

import { revalidateTag } from 'next/cache'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { savePostCore } from '@/lib/savePostCore'
import { ARTICLES_RAIL_CACHE_TAG } from '@/app/api/articles/rail/route'

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
  // Freshen the in-pane reader's cached payload for this slug (tag matches
  // lib/readerPayload's readerCacheTag) so an edit or publish shows without
  // waiting out the 60s revalidate window. Best-effort: outside a request
  // context (e.g. unit tests) revalidateTag throws, and a stale-≤60s reader
  // pane must never fail a save that already succeeded.
  if (result.ok && result.finalSlug) {
    try {
      revalidateTag(`reader:${result.finalSlug}`)
    } catch {
      /* no request store (tests / non-request caller) — the window still covers it */
    }
  }
  // Same idea for the front page rail (see deletePost.js — this is the write
  // side of the same fix): only when this save actually touched `published`,
  // not on every autosave keystroke, or the rail cache would never hold.
  if (result.ok && result.publishedChanged) {
    try {
      revalidateTag(ARTICLES_RAIL_CACHE_TAG)
    } catch {
      /* no request store (tests / non-request caller) — the window still covers it */
    }
  }
  delete result.publishedChanged
  return result
}
