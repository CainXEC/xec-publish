// =============================================================================
//  lib/feedCursor.js  —  keyset ("cursor") pagination for the feed
//
//  Offset pagination (.range(start, end)) gets slower and less correct the
//  deeper you page: the DB still walks every skipped row, and a post inserted
//  while you're paging shifts every later row down by one — so page 2 can repeat
//  or drop items. Keyset pagination instead says "give me the next N rows AFTER
//  this exact position", which stays O(page size) at any depth and is immune to
//  inserts above the cursor.
//
//  The position is the compound key (created_at DESC, id DESC). created_at is the
//  real sort key; id is only a tiebreaker so two posts sharing a timestamp get a
//  single deterministic order and none is skipped or duplicated at a page
//  boundary. NOTE: feed_posts.id is a RANDOM uuid — it is NOT monotonic and must
//  never be used as the sort key on its own. It works purely as a stable,
//  deterministic tiebreaker within one timestamp.
//
//  The cursor token is opaque to the client (base64url JSON) and is validated
//  strictly on the way back in, because it arrives from an untrusted caller.
// =============================================================================

/** Turn the boundary row into an opaque, URL-safe cursor token. */
export function encodeCursor(row) {
  if (!row || !row.created_at || !row.id) return null
  const json = JSON.stringify({ t: row.created_at, i: row.id })
  return Buffer.from(json, 'utf8').toString('base64url')
}

/**
 * Parse a client-supplied cursor token back into { createdAt, id }. Returns null
 * for anything malformed (missing, wrong type, bad base64, missing fields) — a
 * bad cursor is treated as "no cursor" (start from the top) rather than an error,
 * so a stale/garbage token never 500s the feed.
 */
export function decodeCursor(token) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 512) return null
  try {
    const json = Buffer.from(token, 'base64url').toString('utf8')
    const parsed = JSON.parse(json)
    if (!parsed || typeof parsed.t !== 'string' || typeof parsed.i !== 'string') return null
    if (!parsed.t || !parsed.i) return null
    return { createdAt: parsed.t, id: parsed.i }
  } catch {
    return null
  }
}

/**
 * Apply the keyset boundary to a supabase query that is already ordered
 * (created_at DESC, id DESC). Fetches rows strictly OLDER than the cursor:
 *   created_at < cursor.createdAt
 *     OR (created_at = cursor.createdAt AND id < cursor.id)
 * A null/invalid cursor leaves the query untouched (first page). Returns the
 * query so calls can chain.
 */
export function applyCursor(query, cursor) {
  if (!cursor) return query
  const { createdAt, id } = cursor
  return query.or(
    `created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`,
  )
}
