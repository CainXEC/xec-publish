// =============================================================================
//  app/api/search/route.js — the one unified search endpoint.
//  ?q=<query>&type=articles|posts|people (type optional; default = all three
//  groups). Backed by the search_site() Postgres function (sql/search.sql):
//  full-text over article titles + PRE-PAYWALL body text and feed post
//  content, pg_trgm fuzzy match over current display handles. Locked article
//  text is never in the index — see the invariant notes in sql/search.sql.
//
//  If the query parses as an eCash address we skip text search entirely and
//  resolve it through the SAME chain the /@<identifier> profile page uses
//  (resolveProfileByIdentifier) — this is how handle-less accounts are found.
// =============================================================================

import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'
import { normalizeAddress, resolveProfileByIdentifier } from '@/lib/resolveProfile'
import {
  displayHandlesByAuthorId,
  displayHandlesByAccountId,
} from '@/lib/authorDisplayHandles'
import { groupSearchRows, profileRouteFor } from '@/lib/searchResults'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TYPES = new Set(['articles', 'posts', 'people'])
const GROUPED_LIMIT = 8 // per group when showing all three
const SINGLE_LIMIT = 20 // when a single type tab is selected

const emptyResults = () => ({ articles: [], posts: [], people: [] })

export async function GET(request) {
  const sp = new URL(request.url).searchParams
  const q = (sp.get('q') ?? '').trim().slice(0, 200)
  const typeParam = (sp.get('type') ?? '').trim().toLowerCase()
  const type = TYPES.has(typeParam) ? typeParam : null

  if (!q) {
    return NextResponse.json({ ok: true, query: '', type, results: emptyResults() })
  }

  // ---- eCash address paste: short-circuit to the profile resolver ---------
  const bare = normalizeAddress(q)
  if (bare) {
    const results = emptyResults()
    try {
      const profile = await resolveProfileByIdentifier(q)
      if (profile) {
        results.people.push({
          type: 'person',
          kind: 'address',
          id: bare,
          handle: profile.displayHandle ?? null,
          handleColor: profile.handleColor ?? null,
          identity: profile.identity, // "@handle" if held, else the address
          route: profileRouteFor(bare),
        })
      }
    } catch (err) {
      console.error('[search] address resolution failed:', err?.message ?? err)
    }
    return NextResponse.json({ ok: true, query: q, type, addressQuery: true, results })
  }

  // ---- full-text + fuzzy handles via the unified RPC ----------------------
  const supabase = adminDb()
  const { data, error } = await supabase.rpc('search_site', {
    p_query: q,
    p_type: type,
    p_limit: type ? SINGLE_LIMIT : GROUPED_LIMIT,
  })
  if (error) {
    console.error('[search] search_site RPC failed:', error.message)
    return NextResponse.json(
      { ok: false, error: 'Search is unavailable.' },
      { status: 503 },
    )
  }

  const results = groupSearchRows(data ?? [])

  // Live bylines: articles key off author_id, feed posts off account_id. Both
  // maps read accounts.display_handle — the account's CURRENT identity — so a
  // sold/unbound handle never labels old work (feed posts fall back to the
  // stamped identity snapshot, which is the raw address form).
  try {
    const [authorMap, accountMap] = await Promise.all([
      displayHandlesByAuthorId(results.articles.map((a) => a.authorId), supabase),
      displayHandlesByAccountId(results.posts.map((p) => p.accountId), supabase),
    ])
    for (const article of results.articles) {
      const entry = article.authorId ? authorMap[article.authorId] : null
      if (entry) article.byline = { handle: entry.handle, color: entry.color ?? null }
    }
    for (const post of results.posts) {
      const entry = post.accountId ? accountMap[post.accountId] : null
      if (entry) {
        post.identity = `@${entry.handle}`
        post.identityColor = entry.color ?? null
      }
    }
  } catch (err) {
    // Byline enrichment is cosmetic — never fail the search over it.
    console.error('[search] byline resolution failed:', err?.message ?? err)
  }

  return NextResponse.json({ ok: true, query: q, type, results })
}
