// =============================================================================
//  app/api/translate/route.js — AI "Translate" for feed posts and articles.
//
//  Translate BY ID, never by client-supplied text: the server fetches the
//  content itself, so this endpoint can't be abused as a free translation proxy
//  on our API key. Articles run the SAME entitlement gate the reader uses
//  (preparePublicPostPageData), so a locked body is never translated for an
//  unentitled viewer — the client never holds the locked bytes.
//
//  Results are cached in Redis keyed by content hash + scope + language, so a
//  popular post in a given language is translated once, then served from cache.
//  A translation is an ephemeral, derived view — it never touches the on-chain
//  content hash / proof of writing.
// =============================================================================

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase } from '@/lib/supabase-server'
import { getPublishedPostBySlug } from '@/lib/getPublishedPostBySlug'
import { preparePublicPostPageData } from '@/lib/preparePublicPostPageData'
import { contentHashHex } from '@/lib/feedProtocol'
import { getClientIp, rateLimit, getRedis } from '@/lib/rateLimit'
import { normalizeLang, langName } from '@/lib/translateLangs'

const MODEL = 'claude-haiku-4-5'
const CACHE_TTL_SECS = 7 * 24 * 60 * 60 // 7 days
const CACHE_VERSION = 'v1'

const anthropic = new Anthropic() // reads ANTHROPIC_API_KEY

/** Pull the concatenated text out of a Messages API response. */
function textFromMessage(msg) {
  return (msg?.content ?? [])
    .filter((b) => b?.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
}

async function translatePlain(text, targetName) {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system:
      `You are a professional translator. Translate the user's message into ${targetName}. ` +
      `Output ONLY the translation — no preface, notes, or quotation marks. Preserve meaning and ` +
      `tone, and keep @mentions, #tags, URLs, and emoji unchanged. If the text is already in ` +
      `${targetName}, return it unchanged.`,
    messages: [{ role: 'user', content: text }],
  })
  return textFromMessage(res)
}

async function translateHtml(html, targetName) {
  // Stream so long article bodies don't hit the SDK's HTTP timeout.
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    system:
      `You are a professional translator. The user message is an HTML fragment. Translate only the ` +
      `human-readable text content into ${targetName}. You MUST preserve every HTML tag, attribute, ` +
      `and the overall structure exactly — do not add, remove, or reorder tags, and do not translate ` +
      `tag names, attribute names, attribute values, URLs, or class names. Output ONLY the translated ` +
      `HTML fragment, with no preface, notes, or code fences.`,
    messages: [{ role: 'user', content: html }],
  })
  const res = await stream.finalMessage()
  return textFromMessage(res)
}

async function cacheGet(key) {
  try {
    const redis = getRedis()
    if (!redis) return null
    const v = await redis.get(key)
    return typeof v === 'string' ? JSON.parse(v) : v ?? null
  } catch {
    return null // fail-open: treat as a miss
  }
}

async function cacheSet(key, value) {
  try {
    const redis = getRedis()
    if (!redis) return
    await redis.set(key, JSON.stringify(value), { ex: CACHE_TTL_SECS })
  } catch {
    /* ignore — caching is best-effort */
  }
}

export async function POST(request) {
  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 20, 60, 'translate'))) {
    return NextResponse.json(
      { ok: false, error: 'Too many requests. Please slow down.' },
      { status: 429 },
    )
  }

  const body = await request.json().catch(() => ({}))
  const kind = body?.kind === 'article' ? 'article' : body?.kind === 'feed' ? 'feed' : null
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  const lang = normalizeLang(body?.lang)

  if (!kind || !id) {
    return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 })
  }
  if (!lang) {
    return NextResponse.json({ ok: false, error: 'unsupported language' }, { status: 400 })
  }
  const targetName = langName(lang)

  // --- resolve the source text server-side, applying the paywall gate ---
  let sourceText = ''
  let sourceHtml = ''
  let title = ''
  let hash = ''
  let scope = 'pub'

  try {
    if (kind === 'feed') {
      const supabase = createServerSupabase()
      const { data: post } = await supabase
        .from('feed_posts')
        .select('content, content_hash, deleted_at')
        .eq('txid', id)
        .maybeSingle()
      if (!post || post.deleted_at) {
        return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
      }
      sourceText = typeof post.content === 'string' ? post.content : ''
      hash = post.content_hash || contentHashHex(sourceText)
    } else {
      // Current posts live at /posts/{slug} (legacy=false); imported legacy
      // posts at root /{slug} (legacy=true). Try both so the article page's
      // translate works either way.
      const data =
        (await getPublishedPostBySlug(id)) || (await getPublishedPostBySlug(id, true))
      if (!data) {
        return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
      }
      const cookieStore = await cookies()
      const prepared = await preparePublicPostPageData(data, cookieStore)
      sourceHtml = prepared.initialBodyHtml ?? '' // public-only unless entitled
      title = prepared.initialPost?.title ?? ''
      scope = prepared.initialUnlocked ? 'full' : 'pub'
      // Hash the exact bytes we're about to translate (differs by scope).
      hash = contentHashHex(`${title}\n${sourceHtml}`)
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'lookup failed' }, { status: 500 })
  }

  if (!sourceText && !sourceHtml) {
    return NextResponse.json({ ok: false, error: 'nothing to translate' }, { status: 400 })
  }

  // --- cache ---
  const cacheKey = `pow:tr:${CACHE_VERSION}:${kind}:${hash}:${scope}:${lang}`
  const cached = await cacheGet(cacheKey)
  if (cached) {
    return NextResponse.json({ ok: true, lang, cached: true, ...cached })
  }

  // --- translate ---
  try {
    let payload
    if (kind === 'feed') {
      payload = { translated: await translatePlain(sourceText, targetName) }
    } else {
      const { sanitizePostBodyHtml } = await import('@/lib/sanitizePostBodyHtml')
      const [translatedHtml, translatedTitle] = await Promise.all([
        translateHtml(sourceHtml, targetName),
        title ? translatePlain(title, targetName) : Promise.resolve(''),
      ])
      // Re-sanitize the model output before it can reach the DOM.
      payload = {
        translated: sanitizePostBodyHtml(translatedHtml),
        title: translatedTitle || title,
      }
    }
    if (!payload.translated) {
      return NextResponse.json({ ok: false, error: 'empty translation' }, { status: 502 })
    }
    await cacheSet(cacheKey, payload)
    return NextResponse.json({ ok: true, lang, cached: false, ...payload })
  } catch (err) {
    const status = err?.status === 401 || err?.status === 403 ? 503 : 502
    return NextResponse.json({ ok: false, error: 'translation unavailable' }, { status })
  }
}
