export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { ChronikClient } from 'chronik-client'
import { encodeOutputScript, getOutputScriptFromAddress } from 'ecashaddrjs'
import { supabase } from '@/lib/supabase'

const chronik = new ChronikClient(['https://chronik.e.cash'])
const REQUIRED_PLATFORM_SATS = 550n

export async function POST(request) {
  try {
    const { txid } = await request.json()
    if (!txid || typeof txid !== 'string') {
      return NextResponse.json({ error: 'Missing txid' }, { status: 400 })
    }

    const platformAddress = process.env.PLATFORM_XEC_ADDRESS?.trim()
    if (!platformAddress) {
      return NextResponse.json(
        { error: 'Platform payment address not configured' },
        { status: 500 },
      )
    }

    let tx
    try {
      tx = await chronik.tx(txid)
    } catch (err) {
      return NextResponse.json(
        { error: err?.message || 'Failed to fetch transaction' },
        { status: 400 },
      )
    }

    const { data: unlockByTxid } = await supabase
      .from('unlocks')
      .select('payer_address')
      .eq('txid', txid)
      .maybeSingle()

    const payerFromUnlock = unlockByTxid?.payer_address?.trim?.() || ''
    if (payerFromUnlock) {
      const { data: unlockRows, error: unlockListError } = await supabase
        .from('unlocks')
        .select('post_id')
        .eq('payer_address', payerFromUnlock)

      if (unlockListError) {
        return NextResponse.json(
          { error: unlockListError.message },
          { status: 500 },
        )
      }

      return NextResponse.json({
        walletAddress: payerFromUnlock,
        unlockedPostIds: (unlockRows ?? []).map((row) => row.post_id),
      })
    }

    let platformOutputScript
    try {
      platformOutputScript = getOutputScriptFromAddress(platformAddress)
    } catch {
      return NextResponse.json(
        { error: 'Invalid platform payment address' },
        { status: 500 },
      )
    }

    const platformOutput = tx.outputs?.find(
      (output) =>
        output.outputScript === platformOutputScript &&
        output.sats >= REQUIRED_PLATFORM_SATS,
    )

    if (!platformOutput) {
      return NextResponse.json(
        { error: 'Verification failed: platform payment not found or amount too low' },
        { status: 400 },
      )
    }

    const payerScript = tx.inputs?.[0]?.outputScript
    if (!payerScript) {
      return NextResponse.json(
        { error: 'Could not determine sender address' },
        { status: 400 },
      )
    }

    let walletAddress
    try {
      walletAddress = encodeOutputScript(payerScript, 'ecash')
    } catch {
      return NextResponse.json(
        { error: 'Could not decode sender address' },
        { status: 400 },
      )
    }

    const { data: unlockRows, error: unlockError } = await supabase
      .from('unlocks')
      .select('post_id')
      .eq('payer_address', walletAddress)

    if (unlockError) {
      return NextResponse.json({ error: unlockError.message }, { status: 500 })
    }

    return NextResponse.json({
      walletAddress,
      unlockedPostIds: (unlockRows ?? []).map((row) => row.post_id),
    })
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || 'Wallet auth verification failed' },
      { status: 500 },
    )
  }
}
