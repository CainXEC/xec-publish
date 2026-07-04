export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { ChronikClient } from 'chronik-client'
import { signCookieValue } from '@/lib/cookieSigner'
import { rateLimit } from '@/lib/rateLimit'
import { supabase } from '@/lib/supabase'
import { verifyAndRecordUnlock } from '@/lib/verifyPaymentUnlock'
import { resolveOrCreateAccount } from '@/lib/walletAuth'
import {
  verifySession,
  signSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_DAYS,
} from '@/lib/session'

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

    // -----------------------------------------------------------------------
    //  Pay doubles as login. Mint a session for the payer address on the SAME
    //  response. This is a 'pay'-scope session — weaker than the nonce-proven
    //  'challenge' flow (the unlock txid is public in the mempool), so payout /
    //  author-mutation routes MUST require getChallengeSession(). Two guards:
    //    - never fail the unlock if minting throws;
    //    - never DOWNGRADE an existing challenge session for the same account
    //      (e.g. an author who is already logged in and then buys a post).
    //  The unlock cookie above is untouched.
    // -----------------------------------------------------------------------
    try {
      if (result.payerAddress) {
        const resolved = await resolveOrCreateAccount(result.payerAddress)
        const existing = verifySession(
          request.cookies.get(SESSION_COOKIE)?.value,
        )
        const keepStronger =
          existing &&
          existing.via === 'challenge' &&
          existing.accountId === resolved.accountId

        if (!keepStronger) {
          const sessionValue = signSession({
            accountId: resolved.accountId,
            address: result.payerAddress,
            iat: Date.now(),
            via: 'pay',
          })
          response.cookies.set({
            name: SESSION_COOKIE,
            value: sessionValue,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: SESSION_MAX_AGE_DAYS * 24 * 60 * 60,
          })
        }
      }
    } catch (mintErr) {
      console.error(
        '[verify-payment] session mint failed (unlock still ok)',
        mintErr,
      )
    }

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
