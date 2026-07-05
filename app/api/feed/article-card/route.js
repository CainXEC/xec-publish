export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'

/**
 * Resolve an on-site article slug to a shallow preview card. Used to hydrate the
 * card for a freshly-posted feed entry (the confirm route returns an undecorated
 * post, so the client fetches the card here) — server-rendered feeds get the
 * same shape attached in getFeed. Returns 404 for unknown/unpublished slugs.
 */
export async function GET(request) {
  const slug = request.nextUrl.searchParams.get('slug')?.trim() ?? ''
  if (!slug) {
    return NextResponse.json({ ok: false, error: 'Missing slug.' }, { status: 400 })
  }

  const supabase = createServerSupabase()
  const { data: row } = await supabase
    .from('posts')
    .select('slug, title, teaser, price_xec')
    .eq('slug', slug)
    .eq('published', true)
    .eq('legacy', false)
    .maybeSingle()

  if (!row) {
    return NextResponse.json({ ok: false, error: 'Article not found.' }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    card: {
      slug: row.slug,
      title: row.title ?? '',
      teaser: row.teaser ?? '',
      priceXec: row.price_xec ?? null,
    },
  })
}
