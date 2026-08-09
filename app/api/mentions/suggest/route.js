// =============================================================================
//  app/api/mentions/suggest/route.js
//  @mention autocomplete for the feed composer: given a partial handle typed
//  after "@", return accounts whose CURRENT display handle starts with it —
//  a strict prefix match (not the fuzzy/substring search the unified search
//  bar uses), so typing "cai" only ever offers handles that start with "cai".
//
//  Public, read-only, public-safe fields only (handle + its display color) —
//  no account ids, no addresses.
// =============================================================================

import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_ITEMS = 6
const HANDLE_MAX = 15

export async function GET(request) {
  const sp = new URL(request.url).searchParams
  const raw = (sp.get('q') ?? '').trim().slice(0, HANDLE_MAX)
  // Same char set as a real handle (HANDLE_CHARS in lib/contentLinks.js); anything
  // else can't be a valid prefix, so don't bother querying.
  if (!/^[A-Za-z0-9_]{1,15}$/.test(raw)) {
    return NextResponse.json({ ok: true, items: [] })
  }

  const supabase = adminDb()
  // ILIKE prefix — a plain `raw%` pattern needs no wildcard-escaping since `raw`
  // is already constrained to [A-Za-z0-9_] above (no `%`/`_`/`\` can slip through).
  const { data, error } = await supabase
    .from('accounts')
    .select('display_handle, handle_color')
    .not('display_handle', 'is', null)
    .ilike('display_handle', `${raw}%`)
    .order('display_handle', { ascending: true })
    .limit(MAX_ITEMS)

  if (error) {
    console.error('[mentions/suggest] query failed:', error.message)
    return NextResponse.json({ ok: true, items: [] })
  }

  const items = (data ?? [])
    .filter((r) => r.display_handle)
    .map((r) => ({ handle: r.display_handle, color: r.handle_color ?? null }))

  return NextResponse.json({ ok: true, items })
}
