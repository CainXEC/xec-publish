import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { rateLimit, getClientIp } from '@/lib/rateLimit'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { recordArticleMentionNotifications } from '@/lib/feedNotifications'
import { ARTICLES_RAIL_CACHE_TAG } from '@/app/api/articles/rail/route'

// POST /api/agent/article/publish — REST publish flip for external clients
// (the AI_SATOSHI agent). Runs after the on-chain fee cleared: the agent has
// already done GET /api/publish/prepare → paid 1000 XEC with the OP_6 envelope
// → POST /api/verify-publish-payment (which sets publish_paid). This is the
// same owner check + publish_paid gate as savePost's nextPublished branch,
// then the minimal published/published_at flip — content is never touched, so
// the verified contentHash keeps matching the stored body.
//
// Body: { postId }  →  { ok, slug }
export async function POST(request) {
  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 30, 60, 'agent-article-publish'))) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 },
    )
  }

  const body = await request.json().catch(() => null)
  const postId = typeof body?.postId === 'string' ? body.postId.trim() : ''
  if (!postId) {
    return NextResponse.json({ error: 'Missing postId' }, { status: 400 })
  }

  const acct = await getAuthedAccount()
  if (!acct?.authorId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = adminDb()

  const { data: existing, error: exErr } = await admin
    .from('posts')
    .select('id, author_id, slug, publish_paid, published_at')
    .eq('id', postId)
    .maybeSingle()
  if (exErr) {
    return NextResponse.json({ error: exErr.message }, { status: 500 })
  }
  // Same shape as savePost's gate: missing and foreign posts are
  // indistinguishable to the caller.
  if (!existing || existing.author_id !== acct.authorId) {
    return NextResponse.json({ error: 'Post not found.' }, { status: 404 })
  }
  if (existing.publish_paid !== true) {
    return NextResponse.json(
      { error: 'Publish payment required.', needsPayment: true },
      { status: 402 },
    )
  }

  const payload = { published: true }
  const firstPublish = !existing.published_at
  if (firstPublish) {
    payload.published_at = new Date().toISOString()
  }

  const { data: updated, error: upErr } = await admin
    .from('posts')
    .update(payload)
    .eq('id', postId)
    .eq('author_id', acct.authorId)
    .select('id, slug')
    .maybeSingle()
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 })
  }
  if (!updated) {
    return NextResponse.json({ error: 'Post not found.' }, { status: 404 })
  }

  // First publish only → notify anyone @-tagged in the article (best-effort).
  if (firstPublish) {
    await recordArticleMentionNotifications(admin, { postId: updated.id })
  }

  // Same fix as savePost.js / deletePost.js: bust the front page rail's
  // cached list so a newly (or re-)published article shows without waiting
  // out its revalidate window.
  try {
    revalidateTag(ARTICLES_RAIL_CACHE_TAG)
  } catch {
    /* no request store (tests / non-request caller) — the window still covers it */
  }

  return NextResponse.json(
    { ok: true, slug: updated.slug ?? existing.slug ?? null },
    { status: 200 },
  )
}
