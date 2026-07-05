import { createServerSupabase } from '@/lib/supabase-server'

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
 * @param {Array<string|null|undefined>} authorIds
 * @param {import('@supabase/supabase-js').SupabaseClient} [client] reuse a caller's client
 * @returns {Promise<Record<string, string>>}
 */
export async function displayHandlesByAuthorId(authorIds, client) {
  const ids = Array.from(new Set((authorIds ?? []).filter(Boolean)))
  if (ids.length === 0) return {}

  const supabase = client ?? createServerSupabase()
  const { data } = await supabase
    .from('accounts')
    .select('author_id, display_handle')
    .in('author_id', ids)
    .not('display_handle', 'is', null)

  const map = {}
  for (const row of data ?? []) {
    // First non-null wins if an author somehow has multiple accounts.
    if (row?.author_id && row.display_handle && !map[row.author_id]) {
      map[row.author_id] = row.display_handle
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
 * @param {Array<string|null|undefined>} accountIds
 * @param {import('@supabase/supabase-js').SupabaseClient} [client] reuse a caller's client
 * @returns {Promise<Record<string, string>>}
 */
export async function displayHandlesByAccountId(accountIds, client) {
  const ids = Array.from(new Set((accountIds ?? []).filter(Boolean)))
  if (ids.length === 0) return {}

  const supabase = client ?? createServerSupabase()
  const { data } = await supabase
    .from('accounts')
    .select('id, display_handle')
    .in('id', ids)
    .not('display_handle', 'is', null)

  const map = {}
  for (const row of data ?? []) {
    if (row?.id && row.display_handle && !map[row.id]) {
      map[row.id] = row.display_handle
    }
  }
  return map
}
