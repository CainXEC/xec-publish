import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(request) {
  const walletAddress = request.nextUrl.searchParams.get('walletAddress')?.trim()
  if (!walletAddress) {
    return NextResponse.json({ error: 'Missing walletAddress' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('unlocks')
    .select('post_id')
    .eq('payer_address', walletAddress)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const unlockedPostIds = [...new Set((data ?? []).map((row) => row.post_id))]
  return NextResponse.json({ unlockedPostIds })
}
