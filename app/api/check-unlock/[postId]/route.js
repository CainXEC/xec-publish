export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { signCookieValue, verifyCookieValue } from '@/lib/cookieSigner'
import { rateLimit } from '@/lib/rateLimit'
import { createServerSupabase } from '@/lib/supabase-server'

export async function GET(request, { params }) {
  const supabase = createServerSupabase()
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  if (!(await rateLimit(ip, 60, 60, 'check-unlock'))) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 },
    )
  }

  const { postId } = await params
  const cookieName = `unlock_${postId}`

  const rawCookie = request.cookies.get(cookieName)?.value
  if (rawCookie) {
    const { valid } = verifyCookieValue(postId, rawCookie)
    if (valid) {
      return NextResponse.json({ unlocked: true })
    }
  }

  const walletAddress = request.nextUrl.searchParams.get('walletAddress')
  if (!walletAddress) {
    return NextResponse.json({ unlocked: false })
  }

  const { data, error } = await supabase
    .from('unlocks')
    .select('id, txid')
    .eq('post_id', postId)
    .eq('payer_address', walletAddress)
    .limit(1)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data?.txid) {
    return NextResponse.json({ unlocked: false })
  }

  let cookieValue
  try {
    cookieValue = signCookieValue(postId, data.txid)
  } catch (signErr) {
    console.error('[check-unlock] unlock cookie signing failed', signErr)
    return NextResponse.json(
      { error: 'Server configuration error: could not set unlock cookie' },
      { status: 500 },
    )
  }

  const response = NextResponse.json({ unlocked: true })
  response.cookies.set({
    name: cookieName,
    value: cookieValue,
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
  })
  return response
}
