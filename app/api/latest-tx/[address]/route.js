import { NextResponse } from 'next/server'
import { ChronikClient } from 'chronik-client'

const chronik = new ChronikClient(['https://chronik.e.cash'])

export async function GET(_request, { params }) {
  try {
    const { address } = await params
    if (!address || typeof address !== 'string') {
      return NextResponse.json({ error: 'Missing address' }, { status: 400 })
    }

    const decodedAddress = decodeURIComponent(address).trim()
    const ecashAddress = decodedAddress.startsWith('ecash:')
      ? decodedAddress
      : `ecash:${decodedAddress}`

    const data = await chronik.address(ecashAddress).history(0, 5)
    const txid = data?.txs?.[0]?.txid

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
