export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { ChronikClient } from 'chronik-client'
import { signCookieValue } from '@/lib/cookieSigner'
import { rateLimit } from '@/lib/rateLimit'
import { supabase } from '@/lib/supabase'
import { verifyAndRecordUnlock } from '@/lib/verifyPaymentUnlock'

const chronik = new ChronikClient([
  'https://chronik.e.cash',
  'https://chronik-native1.fabien.cash',
  'https://chronik-native2.fabien.cash',
  'https://chronik-native3.fabien.cash',
])

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  if (!(await rateLimit(ip, 10, 60, 'verify-payment'))) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 },
    )
  }

  try {
    const { txid, postId } = await request.json()
    console.log('[verify-payment] request received', { txid, postId })

    if (!txid || !postId) {
      return NextResponse.json(
        { error: 'Missing txid or postId' },
        { status: 400 },
      )
    }

    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id, price_xec, author_id, authors!inner(xec_address)')
      .eq('id', postId)
      .maybeSingle()
    console.log('[verify-payment] post lookup result', {
      post,
      postError: postError?.message ?? null,
    })

    if (postError || !post) {
      return NextResponse.json(
        { error: postError?.message || 'Post not found' },
        { status: 404 },
      )
    }

    const author =
      Array.isArray(post.authors) ? post.authors[0] : post.authors
    console.log('[verify-payment] author data', author)

    if (!author?.xec_address) {
      return NextResponse.json(
        { error: 'Author payment address not found' },
        { status: 400 },
      )
    }

    const result = await verifyAndRecordUnlock({
      chronik,
      txid,
      postId,
      authorXecAddress: author.xec_address,
      priceXec: post.price_xec,
      options: { logPrefix: '[verify-payment]', verbose: true },
    })

    if (!result.ok) {
      const e = result.error || ''
      const clientError =
        e.includes('Invalid post price') ||
        e.includes('already used') ||
        e.includes('below required') ||
        e.includes('not found') ||
        e.includes('Invalid author') ||
        e.includes('Invalid platform') ||
        e.includes('platform fee') ||
        e.includes('Platform payment address') ||
        e.includes('Failed to fetch transaction')
      return NextResponse.json(
        { error: result.error },
        { status: clientError ? 400 : 500 },
      )
    }

    let cookieValue
    try {
      cookieValue = signCookieValue(postId, result.txid)
    } catch (signErr) {
      console.error('[verify-payment] unlock cookie signing failed', signErr)
      return NextResponse.json(
        { error: 'Server configuration error: could not set unlock cookie' },
        { status: 500 },
      )
    }

    const response = NextResponse.json({ unlocked: true })
    response.cookies.set({
      name: `unlock_${postId}`,
      value: cookieValue,
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
    })
    return response
  } catch (err) {
    console.log('[verify-payment] caught error', {
      message: err?.message || 'Payment verification failed',
      stack: err?.stack || null,
    })
    return NextResponse.json(
      {
        error: `Verification failed: ${err?.message || 'Payment verification failed'}`,
      },
      { status: 500 },
    )
  }
}
