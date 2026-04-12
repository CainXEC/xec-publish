import { createSupabaseRouteHandlerClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const response = NextResponse.redirect(new URL('/dashboard', request.url))

  if (code) {
    const supabase = createSupabaseRouteHandlerClient(request, response)
    await supabase.auth.signOut()
    await supabase.auth.exchangeCodeForSession(code)
  }

  return response
}
