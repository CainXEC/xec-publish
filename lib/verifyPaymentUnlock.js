import { encodeOutputScript } from 'ecashaddrjs'
import { computePaymentSplit } from '@/lib/paymentSplit'
import { supabase } from '@/lib/supabase'

export function toSatsFromXec(xecValue) {
  const xec = Number(xecValue)
  if (!Number.isFinite(xec) || xec < 0) return null
  return BigInt(Math.round(xec * 100))
}

/**
 * Fetch tx from Chronik, verify payment to author, insert unlock row.
 * Does not set cookies (HTTP callers can do that).
 *
 * @param {object} opts
 * @param {object} opts.chronik - ChronikClient instance
 * @param {string} opts.txid
 * @param {string} opts.postId
 * @param {string} opts.authorXecAddress
 * @param {number|string} opts.priceXec
 * @param {{ verbose?: boolean, logPrefix?: string }} [opts.options]
 * @returns {Promise<{ ok: true, txid: string } | { ok: false, error: string }>}
 */
export async function verifyAndRecordUnlock({
  chronik,
  txid,
  postId,
  authorXecAddress,
  priceXec,
  options = {},
}) {
  const verbose = options.verbose !== false
  const logPrefix = options.logPrefix ?? '[verify-payment]'

  const platformXecAddress = process.env.PLATFORM_XEC_ADDRESS?.trim()
  if (!platformXecAddress) {
    return { ok: false, error: 'Platform payment address not configured' }
  }

  const split = computePaymentSplit(priceXec)
  if (!split) {
    return { ok: false, error: 'Invalid post price' }
  }

  const authorAmount = Number(split.authorAmount)
  const platformAmount = Number(split.platformAmount)
  if (
    !Number.isFinite(authorAmount) ||
    !Number.isFinite(platformAmount) ||
    authorAmount < 0 ||
    platformAmount < 0
  ) {
    return { ok: false, error: 'Invalid post price' }
  }
  const authorAmountSats = BigInt(Math.floor(authorAmount * 100))
  const platformAmountSats = BigInt(Math.floor(platformAmount * 100))
  if (verbose) {
    console.log(`${logPrefix} split (XEC)`, split)
    console.log(
      `${logPrefix} minimum sats author / platform`,
      authorAmountSats.toString(),
      platformAmountSats.toString(),
    )
  }

  let tx
  try {
    tx = await chronik.tx(txid)
  } catch (e) {
    return { ok: false, error: e?.message || 'Failed to fetch transaction' }
  }
  console.log('tx outputs:', JSON.stringify(tx.outputs))
  console.log(
    'tx outputs raw:',
    tx.outputs.map((o) => ({
      sats: o.sats.toString(),
      script: o.outputScript,
    })),
  )

  console.log(`${logPrefix} tx.outputs (raw, after fetch)`, tx.outputs)

  if (verbose) {
    console.log(`${logPrefix} amount-only verification`, {
      requiredAuthorSats: authorAmountSats.toString(),
      requiredPlatformSats: platformAmountSats.toString(),
      authorXecAddress,
      platformXecAddress,
    })
  }

  const authorOutputIndex = tx.outputs.findIndex(
    (output) => output.sats >= authorAmountSats,
  )
  const authorOutput =
    authorOutputIndex >= 0 ? tx.outputs[authorOutputIndex] : null
  const platformOutput = tx.outputs.find(
    (output, idx) => idx !== authorOutputIndex && output.sats >= platformAmountSats,
  )

  if (!authorOutput) {
    return {
      ok: false,
      error:
        'Verification failed: payment to author address not found or amount is below required minimum',
    }
  }

  if (!platformOutput) {
    return {
      ok: false,
      error:
        'Verification failed: platform fee output not found or amount is below required minimum',
    }
  }

  const { data: existingUnlock, error: existingUnlockError } = await supabase
    .from('unlocks')
    .select('id')
    .eq('txid', txid)
    .limit(1)
    .maybeSingle()

  if (existingUnlockError) {
    return { ok: false, error: existingUnlockError.message }
  }

  if (existingUnlock) {
    return {
      ok: false,
      error: 'This transaction was already used to unlock content',
    }
  }

  const payerScript = tx.inputs?.[0]?.outputScript
  let payerAddress = null
  if (payerScript) {
    try {
      payerAddress = encodeOutputScript(payerScript, 'ecash')
    } catch {
      payerAddress = payerScript
    }
  }

  const { error: insertError } = await supabase.from('unlocks').insert({
    post_id: postId,
    txid,
    payer_address: payerAddress,
    amount_xec: Number(authorOutput.sats),
  })

  if (insertError) {
    return { ok: false, error: insertError.message }
  }

  return { ok: true, txid }
}
