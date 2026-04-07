import { NextResponse } from 'next/server'
import { ChronikClient } from 'chronik-client'
import { getOutputScriptFromAddress } from 'ecashaddrjs'

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

    let targetScript
    try {
      targetScript = getOutputScriptFromAddress(ecashAddress)
    } catch {
      return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
    }

    const history = await chronik.address(ecashAddress).history(0, 25)
    const txs = Array.isArray(history?.txs) ? history.txs : []

    for (const txSummary of txs) {
      const txid = txSummary?.txid
      if (!txid) continue
      try {
        const tx = await chronik.tx(txid)
        const hasIncomingOutput = tx.outputs?.some(
          (output) => output.outputScript === targetScript,
        )
        if (hasIncomingOutput) {
          return NextResponse.json({ txid })
        }
      } catch {
        /* ignore failed tx fetch and continue */
      }
    }

    return NextResponse.json({ error: 'No recent incoming transaction found' }, { status: 404 })
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || 'Could not fetch latest transaction' },
      { status: 500 },
    )
  }
}
