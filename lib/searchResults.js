// =============================================================================
//  searchResults.js — pure shaping of search_site() RPC rows into the grouped
//  API response: { articles, posts, people }, each item carrying the route the
//  client should navigate to. Kept free of I/O so it unit-tests directly; the
//  route handler layers live-byline resolution on top.
// =============================================================================

/** Article URL: current posts live at /posts/{slug}; imported legacy posts
 *  keep their original root permalinks /{slug} (see app/[slug]/page.js). */
export function articleRouteFor(slug, isLegacy) {
  const safe = encodeURIComponent(String(slug ?? ''))
  return isLegacy ? `/${safe}` : `/posts/${safe}`
}

/** Profile URL through the current-handle resolution chain: /@<identifier>
 *  rewrites to app/profile/[identifier], which resolves handle OR address to
 *  the current on-chain holder (lib/resolveProfile.ts). */
export function profileRouteFor(identifier) {
  return `/@${encodeURIComponent(String(identifier ?? ''))}`
}

/**
 * Group raw search_site() rows (snake_case, see sql/search.sql RETURNS TABLE)
 * into the response shape. Unknown result types are dropped.
 * @param {Array<object>} rows
 */
export function groupSearchRows(rows) {
  const results = { articles: [], posts: [], people: [] }
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.result_type === 'article') {
      results.articles.push({
        type: 'article',
        id: row.id,
        title: row.title ?? '',
        snippet: row.snippet ?? '',
        locked: row.locked === true,
        priceXec: row.price_xec == null ? null : Number(row.price_xec),
        readingTimeMinutes: row.reading_time_minutes ?? null,
        authorId: row.author_id ?? null,
        publishedAt: row.created_at ?? null,
        route: articleRouteFor(row.slug, row.is_legacy === true),
        byline: null, // filled in by the route handler from the live handle map
      })
    } else if (row?.result_type === 'post') {
      results.posts.push({
        type: 'post',
        id: row.id,
        snippet: row.snippet ?? '',
        accountId: row.account_id ?? null,
        // Stamped at write time; the route handler upgrades it to the LIVE
        // handle when the account still displays one (byline follows the
        // account's current identity, never the historical one).
        identity: row.author_identity ?? '',
        identityColor: null,
        createdAt: row.created_at ?? null,
        route: `/feed/${encodeURIComponent(String(row.id ?? ''))}`,
      })
    } else if (row?.result_type === 'person') {
      results.people.push({
        type: 'person',
        id: row.id,
        handle: row.title ?? '',
        handleColor: row.handle_color ?? null,
        route: profileRouteFor(row.title ?? ''),
      })
    }
  }
  return results
}
