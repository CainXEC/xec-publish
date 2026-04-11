import '@testing-library/jest-dom'

process.env.COOKIE_SECRET = process.env.COOKIE_SECRET || 'test-secret-key'

const platformXecAddress =
  process.env.NEXT_PUBLIC_PLATFORM_XEC_ADDRESS?.trim() ||
  process.env.PLATFORM_XEC_ADDRESS?.trim()
if (platformXecAddress) {
  if (!process.env.PLATFORM_XEC_ADDRESS?.trim()) {
    process.env.PLATFORM_XEC_ADDRESS = platformXecAddress
  }
  if (!process.env.NEXT_PUBLIC_PLATFORM_XEC_ADDRESS?.trim()) {
    process.env.NEXT_PUBLIC_PLATFORM_XEC_ADDRESS = platformXecAddress
  }
}
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon-key'
