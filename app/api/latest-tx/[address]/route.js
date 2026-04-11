export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { ChronikClient } from 'chronik-client'
import { rateLimit } from '@/lib/rateLimit'

const chronik = new ChronikClient([
  'https://chronik.e.cash',
  'https://chronik-native1.fabien.cash',
  'https://chronik-native2.fabien.cash',
  'https://chronik-native3.fabien.cash',
])

export async function GET(request, { params }) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  if (!rateLimit(ip, 60, 60_000, 'latest-tx')) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 },
    )
  }

  try {
    const resolvedParams = await params
    if (!resolvedParams?.address || typeof resolvedParams.address !== 'string') {
      return NextResponse.json({ error: 'Missing address' }, { status: 400 })
    }

    let decodedAddress
    try {
      decodedAddress = decodeURIComponent(resolvedParams.address).trim()
    } catch {
      return NextResponse.json(
        {
          error: `Invalid URL-encoded address received: ${String(resolvedParams.address)}`,
        },
        { status: 400 },
      )
    }

    if (!decodedAddress) {
      return NextResponse.json(
        {
          error: `Address is empty after decoding. Received: ${String(resolvedParams.address)}`,
        },
        { status: 400 },
      )
    }

    if (decodedAddress.includes(':') && !decodedAddress.startsWith('ecash:')) {
      return NextResponse.json(
        {
          error: `Unsupported address prefix. Received: ${decodedAddress}. Expected ecash:`,
        },
        { status: 400 },
      )
    }

    const ecashAddress = decodedAddress.startsWith('ecash:')
      ? decodedAddress
      : `ecash:${decodedAddress}`

    const history = await chronik.address(ecashAddress).history(0, 5)
    const txid = history?.txs?.[0]?.txid

    if (txid) {
      return NextResponse.json({ txid })
    }
    return NextResponse.json(
      { error: 'No recent incoming transaction found' },
      { status: 404 },
    )
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || 'Could not fetch latest transaction' },
      { status: 500 },
    )
  }
}
