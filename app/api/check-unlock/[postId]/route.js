export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { signCookieValue, verifyCookieValue } from '@/lib/cookieSigner'
import { rateLimit, getClientIp } from '@/lib/rateLimit'
import { createServerSupabase } from '@/lib/supabase-server'
import { getAuthedAccount } from '@/lib/authHelpers'

/** All stored forms of every address linked to an account, prefix-agnostic
 *  (matches /api/me). After a change-address swap the old wallet stays linked,
 *  so unlocks it paid for keep restoring on this account. */
async function accountAddressForms(supabase, accountId, sessionAddress) {
  const { data: rows } = await supabase
    .from('account_addresses')
    .select('address')
    .eq('account_id', accountId)
  return [
    ...new Set(
      [sessionAddress, ...(rows ?? []).map((r) => String(r.address ?? ''))]
        .filter(Boolean)
        .map((a) => String(a).trim().toLowerCase().replace(/^ecash:/, ''))
        .filter(Boolean)
        .flatMap((bare) => [bare, `ecash:${bare}`]),
    ),
  ]
}

export async function GET(request, { params }) {
  const supabase = createServerSupabase()
  const ip = getClientIp(request)
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

  // Restoring an unlock (no cookie yet, e.g. a new device) requires a PROVEN
  // identity: only the logged-in account's own address can mint an unlock cookie.
  // Previously this trusted a client-supplied ?walletAddress and would sign a
  // cookie for any address that appeared in `unlocks` — and unlock payer
  // addresses are public on-chain, so anyone could name a real buyer's address
  // and read the paywalled post for free. That was a full paywall bypass.
  const acct = await getAuthedAccount()
  if (!acct?.address) {
    return NextResponse.json({ unlocked: false })
  }

  const { data, error } = await supabase
    .from('unlocks')
    .select('id, txid')
    .eq('post_id', postId)
    .in('payer_address', await accountAddressForms(supabase, acct.accountId, acct.address))
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
