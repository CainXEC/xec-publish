// ecashaddrjs v2 exports getOutputScriptFromAddress (not addressToScript); see dist/cashaddr.d.ts
import { encodeOutputScript, getOutputScriptFromAddress } from 'ecashaddrjs'
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

  const requiredAuthorSats = toSatsFromXec(split.authorAmount)
  const requiredPlatformSats = toSatsFromXec(split.platformAmount)
  if (requiredAuthorSats === null || requiredPlatformSats === null) {
    return { ok: false, error: 'Invalid post price' }
  }
  if (verbose) {
    console.log(`${logPrefix} split (XEC)`, split)
    console.log(
      `${logPrefix} minimum sats author / platform`,
      requiredAuthorSats.toString(),
      requiredPlatformSats.toString(),
    )
  }

  let tx
  try {
    tx = await chronik.tx(txid)
  } catch (e) {
    return { ok: false, error: e?.message || 'Failed to fetch transaction' }
  }

  let authorOutputScript
  let platformOutputScript
  try {
    authorOutputScript = getOutputScriptFromAddress(authorXecAddress)
  } catch (e) {
    return { ok: false, error: e?.message || 'Invalid author address' }
  }
  try {
    platformOutputScript = getOutputScriptFromAddress(platformXecAddress)
  } catch (e) {
    return { ok: false, error: e?.message || 'Invalid platform address' }
  }

  const authorOutput = tx.outputs.find(
    (output) =>
      output.outputScript === authorOutputScript &&
      output.sats >= requiredAuthorSats,
  )

  const platformOutput = tx.outputs.find(
    (output) =>
      output.outputScript === platformOutputScript &&
      output.sats >= requiredPlatformSats,
  )

  const shouldLogOutputMatching =
    verbose || !authorOutput || !platformOutput

  if (shouldLogOutputMatching) {
    console.log(`${logPrefix} address → script (raw inputs)`, {
      authorXecAddress,
      platformXecAddress,
    })
    console.log(`${logPrefix} expected output scripts`, {
      authorOutputScript,
      platformOutputScript,
    })
    console.log(`${logPrefix} required minimum sats`, {
      author: requiredAuthorSats.toString(),
      platform: requiredPlatformSats.toString(),
    })
    tx.outputs.forEach((output, idx) => {
      const authorScriptMatch = output.outputScript === authorOutputScript
      const platformScriptMatch = output.outputScript === platformOutputScript
      const authorAmountOk = output.sats >= requiredAuthorSats
      const platformAmountOk = output.sats >= requiredPlatformSats
      console.log(`${logPrefix} tx.outputs[${idx}]`, {
        outputScript: output.outputScript,
        sats: output.sats?.toString?.() ?? String(output.sats),
        authorScriptMatch,
        platformScriptMatch,
        authorAmountOk,
        platformAmountOk,
        matchesAuthorOutput: authorScriptMatch && authorAmountOk,
        matchesPlatformOutput: platformScriptMatch && platformAmountOk,
      })
    })
    console.log(`${logPrefix} aggregate match`, {
      authorMatched: Boolean(authorOutput),
      platformMatched: Boolean(platformOutput),
    })
  }

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
