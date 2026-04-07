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
  const authorAmountSatsNum = Math.floor(authorAmount * 100)
  const platformAmountSatsNum = Math.floor(platformAmount * 100)
  if (verbose) {
    console.log(`${logPrefix} split (XEC)`, split)
    console.log(
      `${logPrefix} minimum sats author / platform`,
      String(authorAmountSatsNum),
      String(platformAmountSatsNum),
    )
  }

  let tx
  try {
    const txPromise = chronik.tx(txid)
    let timeoutId
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error('Chronik tx fetch timed out after 10s')),
        10000,
      )
    })
    try {
      tx = await Promise.race([txPromise, timeoutPromise])
    } finally {
      clearTimeout(timeoutId)
    }
    console.log(
      `${logPrefix} tx fetched successfully, outputs count:`,
      tx.outputs.length,
    )
  } catch (e) {
    console.log(`${logPrefix} chronik.tx error:`, e?.message, e?.stack)
    return { ok: false, error: e?.message || 'Failed to fetch transaction' }
  }
  const outputs = tx.outputs.map((o) => ({
    sats: Number(o.sats),
    outputScript: o.outputScript,
  }))

  console.log('outputs as numbers:', JSON.stringify(outputs))

  const authorOutputIdx = outputs.findIndex(
    (o) => o.sats >= authorAmountSatsNum,
  )
  const authorOutput =
    authorOutputIdx >= 0 ? outputs[authorOutputIdx] : null
  const platformOutput = outputs.find(
    (o, idx) =>
      idx !== authorOutputIdx && o.sats >= platformAmountSatsNum,
  )

  if (!authorOutput) {
    return {
      ok: false,
      error: `No author output found. Need ${authorAmountSatsNum} sats. Outputs: ${JSON.stringify(outputs)}`,
    }
  }
  if (!platformOutput) {
    return {
      ok: false,
      error: `No platform output found. Need ${platformAmountSatsNum} sats. Outputs: ${JSON.stringify(outputs)}`,
    }
  }

  const { data: existingUnlock, error: existingUnlockError } = await supabase
    .from('unlocks')
    .select('id')
    .eq('txid', txid)
    .limit(1)
    .maybeSingle()

  if (existingUnlockError) {
    console.error(`${logPrefix} supabase unlock lookup failed`, {
      txid,
      postId,
      message: existingUnlockError.message,
      code: existingUnlockError.code,
      details: existingUnlockError.details,
      hint: existingUnlockError.hint,
    })
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
    console.error(`${logPrefix} supabase unlock insert failed`, {
      txid,
      postId,
      message: insertError.message,
      code: insertError.code,
      details: insertError.details,
      hint: insertError.hint,
    })
    return { ok: false, error: insertError.message }
  }

  return { ok: true, txid }
}
