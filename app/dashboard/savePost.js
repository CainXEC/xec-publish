'use server'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthedAccount } from '@/lib/authHelpers'
import { calculateReadingTimeMinutes } from '@/lib/calculateReadingTimeMinutes'
import { generateSlug, isUrlSafeSlug } from '@/lib/generateSlug'
import { POST_SLUG_MAX } from '@/lib/postFieldLimits'

const PAYWALL_MARKER = '<div data-paywall-break="true"></div>'

function extractTeaserFromBody(html) {
  const src = String(html ?? '')
  const markerIdx = src.indexOf(PAYWALL_MARKER)
  const preview = markerIdx === -1 ? src : src.slice(0, markerIdx)
  const plain = preview
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.slice(0, 300)
}

/**
 * Create or update a post the current author owns. Authorization is the wallet
 * session (getAuthedAccount); author_id is stamped from the session, never the
 * client. Publishing (nextPublished) is gated server-side on publish_paid so a
 * crafted call can't go live without payment.
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

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return {
      ok: false,
      error: 'Server configuration error: missing Supabase admin credentials.',
    }
  }

  const title = String(input.title ?? '').trim()
  const bodyTrimmed = String(input.body ?? '').trim()
  const nextPublished = input.nextPublished === true
  const isEditMode = input.isEditMode === true
  const checkboxPublished = input.published === true
  const targetId =
    typeof input.forceId === 'string' && input.forceId ? input.forceId : null

  let finalSlug = String(input.slug ?? '').trim().slice(0, POST_SLUG_MAX)
  if (!finalSlug || !isUrlSafeSlug(finalSlug)) {
    finalSlug = generateSlug(title).slice(0, POST_SLUG_MAX)
  }

  const priceNum = Number(input.priceXec)
  const safePrice = Number.isFinite(priceNum) ? priceNum : 100

  // Same rule as the old client: explicit publish -> true; otherwise an edit
  // preserves its checkbox state, a new draft stays false.
  const publishedForPayload = nextPublished
    ? true
    : isEditMode
      ? checkboxPublished
      : false

  const payload = {
    author_id: acct.authorId,
    title,
    slug: finalSlug,
    teaser: extractTeaserFromBody(bodyTrimmed),
    body: bodyTrimmed,
    reading_time_minutes: calculateReadingTimeMinutes(bodyTrimmed),
    price_xec: safePrice,
    published: publishedForPayload,
  }

  // Server-enforced publish gate: going live requires a paid, owned draft.
  if (nextPublished) {
    if (!targetId) {
      return { ok: false, error: 'Save the draft before publishing.' }
    }
    const { data: existing, error: exErr } = await admin
      .from('posts')
      .select('id, author_id, publish_paid, published_at')
      .eq('id', targetId)
      .maybeSingle()
    if (exErr) return { ok: false, error: exErr.message }
    if (!existing || existing.author_id !== acct.authorId) {
      return { ok: false, error: 'Post not found.' }
    }
    if (existing.publish_paid !== true) {
      return {
        ok: false,
        needsPayment: true,
        id: targetId,
        finalSlug,
        error: 'Publish payment required.',
      }
    }
    if (!existing.published_at) {
      payload.published_at = new Date().toISOString()
    }
  }

  // Update own post by id, or insert a new one. The author_id scope on update
  // means a crafted id can never touch another author's post.
  if (targetId) {
    const { data: updatedRow, error: updateError } = await admin
      .from('posts')
      .update(payload)
      .eq('id', targetId)
      .eq('author_id', acct.authorId)
      .select('id')
      .maybeSingle()
    if (updateError) return { ok: false, error: updateError.message }
    if (!updatedRow) {
      return { ok: false, error: 'Post not found or not yours.' }
    }
    return { ok: true, id: updatedRow.id, finalSlug }
  }

  const { data: insertedRow, error: insertError } = await admin
    .from('posts')
    .insert(payload)
    .select('id')
    .single()
  if (insertError) return { ok: false, error: insertError.message }
  return { ok: true, id: insertedRow?.id ?? null, finalSlug }
}
