// =============================================================================
//  app/api/posts/reader/[slug]/route.js — the home page's reading pane.
//
//  Same server-side preparation the article page uses (getPublishedPostBySlug
//  + preparePublicPostPageData with the viewer's cookies), returned as JSON so
//  the feed can swap a story into its center column without leaving the page.
//  The paywall split happens in that shared lib, so locked content can never
//  reach an unentitled reader here either — this route only ever re-serializes
//  what the article page itself would have rendered for this viewer.
//
//  no-store: entitlement is per-viewer (cookie), never CDN-cacheable.
// =============================================================================

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { verifyPostReaderEntitlement } from '@/lib/verifyPostReaderEntitlement'
import { getCachedPublicReaderPayload, fullReaderBodyHtml } from '@/lib/readerPayload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req, { params }) {
  const { slug: raw } = await params
  const slug = typeof raw === 'string' ? raw.trim() : ''
  if (!slug) {
    return NextResponse.json({ ok: false, error: 'bad slug' }, { status: 400 })
  }

  // Viewer-NEUTRAL payload (metadata, author, counts, sanitized PUBLIC body),
  // cached per slug — legacy fallback handled inside. Contains no locked content.
  const cached = await getCachedPublicReaderPayload(slug)
  if (!cached) {
    return NextResponse.json({ ok: false, error: 'Story not found' }, { status: 404 })
  }

  const p = cached.post

  // Per-viewer entitlement (never cached). Only an entitled viewer gets the full
  // body, and that body is prepared FRESH here — the cache only ever holds the
  // public preview, so locked content can't leak through the shared cache.
  const cookieStore = await cookies()
  const entitled = await verifyPostReaderEntitlement(p.id, p.author_id, cookieStore)
  const bodyHtml = entitled
    ? (await fullReaderBodyHtml(p.id)) ?? cached.publicBodyHtml
    : cached.publicBodyHtml

  // Byline fallback for wallet-native authors with no handle and no legacy
  // username: the shortened eCash address (mirrors the article page + rail).
  const author = cached.author
  const bareAddr = (author?.xec_address ?? '')
    .trim()
    .toLowerCase()
    .replace(/^ecash:/, '')
  const shortAddr = bareAddr ? `${bareAddr.slice(0, 8)}…${bareAddr.slice(-4)}` : null

  return NextResponse.json(
    {
      ok: true,
      slug,
      legacy: cached.legacy,
      postId: p.id ?? null,
      authorId: p.author_id ?? null,
      title: p.title ?? '',
      bodyHtml: bodyHtml ?? '',
      unlocked: entitled,
      hasPaywall: Boolean(cached.hasPaywall),
      hasLockedContent: Boolean(cached.hasLockedContent),
      priceXec: p.price_xec ?? null,
      readMinutes: p.reading_time_minutes ?? null,
      publishedAt: p.published_at ?? p.created_at ?? null,
      unlockCount: Number(cached.unlockCount) || 0,
      commentCount: Number(cached.commentCount) || 0,
      author: {
        handle: author?.display_handle?.trim() || null,
        username: author?.username?.trim() || null,
        name:
          author?.display_handle?.trim() ||
          author?.username?.trim() ||
          shortAddr,
        color: author?.handle_color ?? null,
        // AI-operated author (authors.is_ai) — the pane byline wears [AI].
        isAi: author?.is_ai === true,
        // Payout address for the in-pane unlock's BIP21 — public by nature
        // (it's in every unlock tx and on the author's profile).
        xecAddress: author?.xec_address?.trim() || null,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
