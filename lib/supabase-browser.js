import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser Supabase client (cookie session). Use from Client Components so
 * `createSupabaseServerClient()` can read the same session on the server.
 */
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
)
