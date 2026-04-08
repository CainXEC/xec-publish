import { NextResponse } from 'next/server'
const CHRONIK_URLS = [
  'https://chronik.e.cash',
  'https://chronik-native1.fabien.cash',
  'https://chronik-native2.fabien.cash',
  'https://chronik-native3.fabien.cash',
]

export async function GET(_request, { params }) {
  try {
    const { address } = await params
    if (!address || typeof address !== 'string') {
      return NextResponse.json({ error: 'Missing address' }, { status: 400 })
    }

    let decodedAddress
    try {
      decodedAddress = decodeURIComponent(address).trim()
    } catch {
      return NextResponse.json(
        { error: `Invalid URL-encoded address received: ${String(address)}` },
        { status: 400 },
      )
    }

    if (!decodedAddress) {
      return NextResponse.json(
        { error: `Address is empty after decoding. Received: ${String(address)}` },
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

    const encodedAddress = encodeURIComponent(ecashAddress)
    let data = null
    let lastError = null
    for (const baseUrl of CHRONIK_URLS) {
      try {
        const response = await fetch(
          `${baseUrl}/address/${encodedAddress}/history?page=0&page_size=5`,
          { cache: 'no-store' },
        )
        if (!response.ok) {
          let details = ''
          try {
            details = await response.text()
          } catch {
            details = ''
          }
          throw new Error(
            `Chronik REST history fetch failed at ${baseUrl} (${response.status})${details ? `: ${details}` : ''}`,
          )
        }
        data = await response.json()
        break
      } catch (err) {
        lastError = err
      }
    }
    if (!data) {
      throw lastError || new Error('Chronik REST history fetch failed')
    }
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
