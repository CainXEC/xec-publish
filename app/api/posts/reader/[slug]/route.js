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
import { getPublishedPostBySlug } from '@/lib/getPublishedPostBySlug'
import { preparePublicPostPageData } from '@/lib/preparePublicPostPageData'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req, { params }) {
  const { slug: raw } = await params
  const slug = typeof raw === 'string' ? raw.trim() : ''
  if (!slug) {
    return NextResponse.json({ ok: false, error: 'bad slug' }, { status: 400 })
  }

  const data = await getPublishedPostBySlug(slug)
  if (!data) {
    return NextResponse.json({ ok: false, error: 'Story not found' }, { status: 404 })
  }

  const cookieStore = await cookies()
  const p = await preparePublicPostPageData(data, cookieStore)

  return NextResponse.json(
    {
      ok: true,
      slug,
      title: p.initialPost?.title ?? '',
      bodyHtml: p.initialBodyHtml ?? '',
      unlocked: Boolean(p.initialUnlocked),
      hasPaywall: Boolean(p.hasPaywallMarker),
      priceXec: p.initialPost?.price_xec ?? null,
      readMinutes: p.initialPost?.reading_time_minutes ?? null,
      publishedAt: p.initialPost?.published_at ?? p.initialPost?.created_at ?? null,
      author: {
        handle: p.initialAuthor?.display_handle?.trim() || null,
        name:
          p.initialAuthor?.display_handle?.trim() ||
          p.initialAuthor?.username?.trim() ||
          null,
        color: p.initialAuthor?.handle_color ?? null,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
