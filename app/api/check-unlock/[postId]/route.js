import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(_request, { params }) {
  const { postId } = await params
  const cookieName = `unlock_${postId}`
  const withUnlockCookie = () => {
    const response = NextResponse.json({ unlocked: true })
    response.cookies.set({
      name: cookieName,
      value: 'true',
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
      sameSite: 'lax',
    })
    return response
  }

  if (_request.cookies.get(cookieName)?.value) {
    return NextResponse.json({ unlocked: true })
  }

  const walletAddress = _request.nextUrl.searchParams.get('walletAddress')
  if (!walletAddress) {
    const { data: anyUnlock, error: anyUnlockError } = await supabase
      .from('unlocks')
      .select('id')
      .eq('post_id', postId)
      .limit(1)
      .maybeSingle()

    if (anyUnlockError) {
      return NextResponse.json({ error: anyUnlockError.message }, { status: 500 })
    }

    if (!anyUnlock) {
      return NextResponse.json({ unlocked: false })
    }

    return withUnlockCookie()
  }

  const { data, error } = await supabase
    .from('unlocks')
    .select('id')
    .eq('post_id', postId)
    .eq('payer_address', walletAddress)
    .limit(1)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ unlocked: false })
  }

  return withUnlockCookie()
}

