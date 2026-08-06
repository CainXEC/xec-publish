// =============================================================================
//  savePostCore.js — the one write path for article drafts and publishes.
//
//  Extracted verbatim from the savePost server action so the dashboard editor
//  (app/dashboard/savePost.js) and the agent REST routes (app/api/agent/article)
//  run the SAME transform chain — trim → transformArticleBodyLinks → teaser →
//  reading time — and the SAME publish gate. Callers own auth: they resolve the
//  session to an authorId and hand over the admin client; nothing here trusts
//  the input for identity.
// =============================================================================

import { calculateReadingTimeMinutes } from '@/lib/calculateReadingTimeMinutes'
import { generateSlug, isUrlSafeSlug } from '@/lib/generateSlug'
import { POST_SLUG_MAX } from '@/lib/postFieldLimits'
import { transformArticleBodyLinks } from '@/lib/articleBodyLinks'
import { recordArticleMentionNotifications } from '@/lib/feedNotifications'

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
 * Create or update a post owned by `authorId`. Publishing (nextPublished) is
 * gated on publish_paid so a crafted call can't go live without payment.
 *
 * Success results carry `storedBody` — the exact post-transform string written
 * to the DB. The publish contentHash is sha256 over those bytes, so a caller
 * that keeps storedBody can predict the OP_RETURN hash without a re-fetch.
 *
 * @param {object} admin - service-role Supabase client
 * @param {string} authorId - resolved from the session by the caller, never input
 * @param {{
 *   forceId?: string | null,
 *   nextPublished?: boolean,   // explicit publish action — triggers the payment gate
 *   isEditMode?: boolean,
 *   published?: boolean,       // current checkbox state (preserved on edit autosave)
 *   title?: string, slug?: string, body?: string, priceXec?: string | number,
 * }} input
 * @returns {Promise<{ ok: true, id: string | null, finalSlug: string, storedBody: string }
 *   | { ok: false, needsPayment?: boolean, id?: string, finalSlug?: string, error: string }>}
 */
export async function savePostCore(admin, authorId, input = {}) {
  const title = String(input.title ?? '').trim()
  // Bake the link policy into the stored body at write time: on-site links become
  // marked, clickable anchors; every other link is unwrapped to inert text; and
  // @handle mentions become profile links. Doing it here (not at render) is what
  // scopes the behavior to new/edited content — old articles are never touched.
  const bodyTrimmed = transformArticleBodyLinks(String(input.body ?? '').trim())
  const nextPublished = input.nextPublished === true
  // Set when this call is the article's FIRST publish (published_at newly stamped)
  // — the one moment we fire @mention notifications, so edits never re-notify.
  let firstPublish = false
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

  const payload = {
    author_id: authorId,
    title,
    slug: finalSlug,
    teaser: extractTeaserFromBody(bodyTrimmed),
    body: bodyTrimmed,
    reading_time_minutes: calculateReadingTimeMinutes(bodyTrimmed),
    price_xec: safePrice,
  }

  // `published` is written ONLY on an intentional state change: an explicit
  // publish, or the edit-mode checkbox (which is how an author unpublishes).
  // A new-mode UPDATE (autosave / re-save) must not carry it at all: the
  // editor's autosave can fire — or land, if already in flight — AFTER the
  // publish write during the post-publish navigation window, and when it
  // carried published:false it silently unpublished the just-published post
  // (published_at set + published=false was the telltale row state).
  if (nextPublished) {
    payload.published = true
  } else if (isEditMode) {
    payload.published = checkboxPublished
  } else if (!targetId) {
    payload.published = false // fresh draft insert
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
    if (!existing || existing.author_id !== authorId) {
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
      firstPublish = true
    }
  }

  // Update own post by id, or insert a new one. The author_id scope on update
  // means a crafted id can never touch another author's post.
  if (targetId) {
    const { data: updatedRow, error: updateError } = await admin
      .from('posts')
      .update(payload)
      .eq('id', targetId)
      .eq('author_id', authorId)
      .select('id')
      .maybeSingle()
    if (updateError) return { ok: false, error: updateError.message }
    if (!updatedRow) {
      return { ok: false, error: 'Post not found or not yours.' }
    }
    // First publish only → notify anyone @-tagged in the article (best-effort).
    if (firstPublish) {
      await recordArticleMentionNotifications(admin, { postId: updatedRow.id })
    }
    return { ok: true, id: updatedRow.id, finalSlug, storedBody: bodyTrimmed }
  }

  const { data: insertedRow, error: insertError } = await admin
    .from('posts')
    .insert(payload)
    .select('id')
    .single()
  if (insertError) return { ok: false, error: insertError.message }
  return {
    ok: true,
    id: insertedRow?.id ?? null,
    finalSlug,
    storedBody: bodyTrimmed,
  }
}
