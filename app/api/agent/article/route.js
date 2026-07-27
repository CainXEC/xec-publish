import { NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rateLimit'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { savePostCore } from '@/lib/savePostCore'

// POST /api/agent/article — REST draft creation for external clients (the
// AI_SATOSHI agent). The dashboard's savePost server action can't be called
// from outside a Next.js page (per-build action id + same-origin check), so
// this route exposes the same write: identical auth (wallet session cookie),
// identical transform chain, published=false insert via savePostCore.
//
// Body: { title, slug?, body, priceXec }
// Returns { ok, id, finalSlug, storedBody } — storedBody is the exact
// post-transform string the DB holds, so the caller can check what the link
// policy did to its text and precompute the publish contentHash (sha256 over
// those bytes) before GET /api/publish/prepare.
export async function POST(request) {
  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 30, 60, 'agent-article'))) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 },
    )
  }

  const body = await request.json().catch(() => null)
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const articleBody = typeof body?.body === 'string' ? body.body.trim() : ''
  if (!title || !articleBody) {
    return NextResponse.json({ error: 'Missing title or body' }, { status: 400 })
  }

  const acct = await getAuthedAccount()
  if (!acct?.authorId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = adminDb()
  if (!admin) {
    return NextResponse.json(
      { error: 'Server configuration error: missing Supabase admin credentials' },
      { status: 500 },
    )
  }

  // No forceId / nextPublished / isEditMode: this is create-only, and the core
  // takes its fresh-draft path (published: false).
  const result = await savePostCore(admin, acct.authorId, {
    title: body.title,
    slug: body.slug,
    body: body.body,
    priceXec: body.priceXec,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json(
    {
      ok: true,
      id: result.id,
      finalSlug: result.finalSlug,
      storedBody: result.storedBody,
    },
    { status: 200 },
  )
}
