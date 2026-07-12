export const runtime = 'nodejs'
import { NextResponse } from 'next/server'

// Current XEC price in USD, from CoinGecko. Fetched server-side (no browser CORS)
// and cached 60s so a burst of editors doesn't hammer the upstream. Degrades
// quietly: on any failure returns { ok:false } and the UI just omits the $ value.
export async function GET() {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ecash&vs_currencies=usd',
      { next: { revalidate: 60 }, headers: { accept: 'application/json' } },
    )
    if (!res.ok) {
      return NextResponse.json({ ok: false }, { status: 200 })
    }
    const data = await res.json()
    const usd = Number(data?.ecash?.usd)
    if (!Number.isFinite(usd) || usd <= 0) {
      return NextResponse.json({ ok: false }, { status: 200 })
    }
    return NextResponse.json({ ok: true, usd })
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
