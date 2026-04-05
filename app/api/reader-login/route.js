import { NextResponse } from 'next/server'
import { ChronikClient } from 'chronik-client'
import { encodeOutputScript } from 'ecashaddrjs'
import { supabase } from '@/lib/supabase'

const chronik = new ChronikClient(['https://chronik.e.cash'])

export async function POST(request) {
  try {
    const { txid } = await request.json()
    if (!txid) {
      return NextResponse.json({ error: 'Missing txid' }, { status: 400 })
    }

    const tx = await chronik.tx(txid)
    const payerScript = tx.inputs?.[0]?.outputScript
    if (!payerScript) {
      return NextResponse.json(
        { error: 'Could not extract sender script from transaction input' },
        { status: 400 },
      )
    }

    let walletAddress
    try {
      walletAddress = encodeOutputScript(payerScript, 'ecash')
    } catch (err) {
      return NextResponse.json(
        { error: err?.message || 'Could not decode sender wallet address' },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .from('unlocks')
      .select('post_id')
      .eq('payer_address', walletAddress)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      walletAddress,
      unlockedPostIds: (data ?? []).map((row) => row.post_id),
    })
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || 'Reader login failed' },
      { status: 500 },
    )
  }
}

