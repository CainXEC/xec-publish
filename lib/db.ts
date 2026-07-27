import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// =============================================================================
//  lib/db.ts — the ONE entry point for Supabase clients on the server.
//
//  Two clients, two trust levels:
//    adminDb() — service-role, RLS BYPASSED. The single place
//                SUPABASE_SERVICE_ROLE_KEY is ever read. Because it bypasses
//                RLS, authorization is 100% manual: every route that uses it
//                MUST gate on getAuthedAccount() / requireAuthorId() (see
//                lib/authHelpers.ts) before touching another account's data.
//                Server-only — NEVER import this from client code.
//    db()      — anon key, RLS ENFORCED. For server-side reads that should be
//                subject to row-level security.
//
//  Client Components use lib/supabase-browser.js instead (cookie-bound anon
//  client), which is a different animal and stays separate.
//
//  Both are memoized per process: a Supabase JS client is a thin stateless
//  wrapper over fetch, safe to share across requests (service-role carries no
//  per-user session), and re-creating one per call was pure waste.
// =============================================================================

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.SUPABASE_URL)!

let _admin: SupabaseClient | undefined
/** Service-role client (RLS bypassed). Server-only. Memoized. */
export function adminDb(): SupabaseClient {
  return (_admin ??= createClient(
    SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  ))
}

let _anon: SupabaseClient | undefined
/** Anon client (RLS enforced), for server-side anon reads. Memoized. */
export function db(): SupabaseClient {
  return (_anon ??= createClient(
    SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  ))
}
