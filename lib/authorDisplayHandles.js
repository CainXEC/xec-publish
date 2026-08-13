import { adminDb } from '@/lib/db'
import { scheduleHandleReverifyIfStale } from '@/lib/resolveProfile'

// Live byline renders (a feed page, a comment thread) resolve many accounts at
// once. Each STALE handle-holder scheduled here fires one out-of-band Chronik
// holder check (see scheduleHandleReverifyIfStale) so a viewer — not just the
// owner — reverts a sold handle. Cap how many we schedule per call so a cold
// cache can't fan out a burst of Chronik lookups from one render; the rest are
// caught on the next render (the ones we do check bump their timestamp and go
// fresh, so the frontier advances each time).
const REVERIFY_SCHEDULE_CAP = 8

// The columns every account row needs to (a) render its byline and (b) schedule
// the on-chain re-verification that clears a handle the account no longer holds.
const HANDLE_ROW_COLUMNS =
  'display_handle, handle_color, active_handle_token_id, display_handle_checked_at, ' +
  'account_addresses(address, is_primary), authors(is_ai)'

// Primary wallet out of an embedded account_addresses list, or null.
function primaryAddressOf(row) {
  const rows = Array.isArray(row?.account_addresses) ? row.account_addresses : []
  return rows.find((a) => a?.is_primary === true)?.address ?? null
}

// The handle's minted card art, keyed by token id, for every token id in a
// batch of account rows — one query for the whole batch, not one per account.
// `image_url` is set once the card is hosted at mint/claim time (usually
// present); a still-null value just means the caller falls back to the
// deterministic /api/handle-card/<tokenId> route, same as everywhere else the
// card art renders (see HandleCardImage.tsx).
async function cardImagesByToken(supabase, rows) {
  const tokenIds = [...new Set((rows ?? []).map((r) => r.active_handle_token_id).filter(Boolean))]
  const map = new Map()
  if (tokenIds.length === 0) return map
  const { data } = await supabase.from('handles').select('token_id, image_url').in('token_id', tokenIds)
  for (const h of data ?? []) map.set(h.token_id, h.image_url ?? null)
  return map
}

/**
 * Map author_id -> the handle that author currently displays as their identity.
 *
 * The chosen handle lives on `accounts.display_handle` (set by the login
 * auto-bind and the display-handle picker), keyed to the account's `author_id`.
 * Authors who haven't bound a handle are simply absent from the map, so callers
 * fall back to `authors.username`.
 *
 * This is the same source `/api/me` and `getAuthedAccount` read, so a post
 * byline agrees with the nav identity for the same person.
 *
 * Returns `{ handle, color, isAi }` per author: `color` is the account's chosen
 * handle color (one of the approved theme swatches) or null for the theme
 * default; `isAi` is the author's AI-operated flag (authors.is_ai), riding
 * along so bylines can carry the [AI] label without a second lookup.
 *
 * @param {Array<string|null|undefined>} authorIds
 * @param {import('@supabase/supabase-js').SupabaseClient} [client] reuse a caller's client
 * @returns {Promise<Record<string, { handle: string, color: string|null, isAi: boolean }>>}
 */
export async function displayHandlesByAuthorId(authorIds, client) {
  const ids = Array.from(new Set((authorIds ?? []).filter(Boolean)))
  if (ids.length === 0) return {}

  const supabase = client ?? adminDb()
  const { data } = await supabase
    .from('accounts')
    .select(`id, author_id, ${HANDLE_ROW_COLUMNS}`)
    .in('author_id', ids)
    .not('display_handle', 'is', null)

  const map = {}
  let scheduled = 0
  for (const row of data ?? []) {
    // First non-null wins if an author somehow has multiple accounts.
    if (row?.author_id && row.display_handle && !map[row.author_id]) {
      const author = Array.isArray(row.authors) ? row.authors[0] : row.authors
      map[row.author_id] = {
        handle: row.display_handle,
        color: row.handle_color ?? null,
        isAi: author?.is_ai === true,
      }
      // Reconcile a sold handle even when only a viewer (not the owner) sees it.
      // Counts only checks that actually fired (stale rows) against the cap.
      if (scheduled < REVERIFY_SCHEDULE_CAP && scheduleHandleReverifyIfStale(row, primaryAddressOf(row))) {
        scheduled += 1
      }
    }
  }
  return map
}

/**
 * Map account id -> the handle that account currently displays.
 *
 * Same source as {@link displayHandlesByAuthorId} (`accounts.display_handle`),
 * but keyed by the account's own id — which is what feed posts carry
 * (feed_posts.author_account_id). Used to render post bylines with the poster's
 * CURRENT handle rather than the one frozen at write time: if the account has
 * since sold/unbound its handle, it's absent here and the byline falls back to
 * the address, so old posts stop showing a handle the account no longer holds.
 *
 * Returns `{ handle, color, isAi, tokenId, cardImageUrl }` per account: `tokenId`
 * / `cardImageUrl` are the currently-displayed handle's minted card (token id +
 * hosted PNG url, possibly null if not hosted yet — see cardImagesByToken),
 * absent for callers that don't need the feed-byline avatar.
 *
 * @param {Array<string|null|undefined>} accountIds
 * @param {import('@supabase/supabase-js').SupabaseClient} [client] reuse a caller's client
 * @returns {Promise<Record<string, { handle: string, color: string|null, isAi: boolean, tokenId: string|null, cardImageUrl: string|null }>>}
 */
export async function displayHandlesByAccountId(accountIds, client) {
  const ids = Array.from(new Set((accountIds ?? []).filter(Boolean)))
  if (ids.length === 0) return {}

  const supabase = client ?? adminDb()
  const { data } = await supabase
    .from('accounts')
    .select(`id, ${HANDLE_ROW_COLUMNS}`)
    .in('id', ids)
    .not('display_handle', 'is', null)

  const imageByToken = await cardImagesByToken(supabase, data)

  const map = {}
  let scheduled = 0
  for (const row of data ?? []) {
    if (row?.id && row.display_handle && !map[row.id]) {
      const author = Array.isArray(row.authors) ? row.authors[0] : row.authors
      map[row.id] = {
        handle: row.display_handle,
        color: row.handle_color ?? null,
        isAi: author?.is_ai === true,
        tokenId: row.active_handle_token_id ?? null,
        cardImageUrl: imageByToken.get(row.active_handle_token_id) ?? null,
      }
      // Reconcile a sold handle even when only a viewer (not the owner) sees it.
      if (scheduled < REVERIFY_SCHEDULE_CAP && scheduleHandleReverifyIfStale(row, primaryAddressOf(row))) {
        scheduled += 1
      }
    }
  }
  return map
}
