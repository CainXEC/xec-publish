import '@testing-library/jest-dom'

process.env.COOKIE_SECRET = process.env.COOKIE_SECRET || 'test-secret-key'
process.env.PLATFORM_XEC_ADDRESS =
  process.env.PLATFORM_XEC_ADDRESS ||
  'ecash:qp54xhk40f3fewpkp80pa9v28jr6940fmv38nxlahf'
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon-key'
