import { encodeOutputScript, getOutputScriptFromAddress } from 'ecashaddrjs'
import { decodeOpReturnToPostId } from '@/lib/opReturnEncode'
import { decodeFeedOpReturn, FEED_ACTION } from '@/lib/feedProtocol'
import { computePaymentSplit } from '@/lib/paymentSplit'
import { adminDb } from '@/lib/db'

const supabase = adminDb()

/**
 * After this instant (UTC), unlock payments must carry a matching OP_RETURN post id.
 * Replace with `new Date('<DEPLOY_ISO>')` + 6 hours at release (grace: with or without tag until then).
 */
const OP_RETURN_REQUIRED_AFTER = new Date('2026-04-21T06:00:00.000Z').getTime()

function outputScriptToHex(outputScript) {
  if (outputScript == null) return ''
  if (typeof outputScript === 'string') {
    const t = outputScript.trim().replace(/^0x/i, '')
    if (/^[0-9a-f]+$/i.test(t)) return t.toLowerCase()
    return ''
  }
  if (outputScript instanceof Uint8Array) {
    let s = ''
    for (let j = 0; j < outputScript.length; j++) {
      s += outputScript[j].toString(16).padStart(2, '0')
    }
    return s
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(outputScript)) {
    return outputScript.toString('hex')
  }
  return ''
}

export function toSatsFromXec(xecValue) {
  const xec = Number(xecValue)
  if (!Number.isFinite(xec) || xec < 0) return null
  return BigInt(Math.round(xec * 100))
}

/**
 * Fetch tx from Chronik, verify payment to author, insert unlock row.
 * Does not set cookies (HTTP callers can do that).
 *
 * Returns the derived payer address (from tx.inputs[0], i.e. spend authority)
 * on success so the caller can mint a pay-scope session ("pay doubles as login").
 *
 * @param {object} opts
 * @param {object} opts.chronik - ChronikClient instance
 * @param {string} opts.txid
 * @param {string} opts.postId
 * @param {string} opts.authorXecAddress - the author's CURRENT payout address
 * @param {string[]} [opts.authorLinkedAddresses] - other addresses proven to
 *   belong to the same author's account. Accepted as valid author outputs so a
 *   payment built against the OLD payout address (paywall opened just before
 *   the author ran change-address) still unlocks — every linked address was
 *   proven by spend authority, so paying any of them pays the author.
 * @param {number|string} opts.priceXec
 * @param {{ verbose?: boolean, logPrefix?: string }} [opts.options]
 * @returns {Promise<{ ok: true, txid: string, payerAddress: string | null } | { ok: false, error: string }>}
 */
export async function verifyAndRecordUnlock({
  chronik,
  txid,
  postId,
  authorXecAddress,
  authorLinkedAddresses = [],
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

  const expectedPostId = String(postId ?? '')
    .trim()
    .toLowerCase()

  let opReturnDecoded = null
  let sawOpReturnOutput = false
  let powrUnlock = false
  for (const o of outputs) {
    const hex = outputScriptToHex(o.outputScript)
    if (!hex.startsWith('6a')) continue
    sawOpReturnOutput = true
    // New POWR unlock marker (OP_7) carries no post id — it's a valid tag on its
    // own; attribution to this article is the caller-supplied postId + DB record.
    const powr = decodeFeedOpReturn(hex)
    if (powr && powr.action === FEED_ACTION.UNLOCK) {
      powrUnlock = true
      break
    }
    // Legacy layout: bare postId UUID in the OP_RETURN.
    opReturnDecoded = decodeOpReturnToPostId(hex)
    break
  }

  const decodedNorm =
    opReturnDecoded != null
      ? String(opReturnDecoded).trim().toLowerCase()
      : null
  const hasValidTag =
    powrUnlock || (decodedNorm != null && decodedNorm === expectedPostId)
  const hasMismatch =
    !powrUnlock &&
    decodedNorm != null &&
    decodedNorm !== '' &&
    decodedNorm !== expectedPostId

  if (hasMismatch) {
    return {
      ok: false,
      error: 'Payment OP_RETURN does not match this post',
    }
  }

  if (!hasValidTag) {
    const now = Date.now()
    if (now >= OP_RETURN_REQUIRED_AFTER) {
      return {
        ok: false,
        error: 'Payment missing post identifier. Please try again.',
      }
    }
    console.warn(
      `${logPrefix} OP_RETURN post tag missing or invalid; allowing during grace period`,
      { txid, postId: expectedPostId, sawOpReturnOutput, opReturnDecoded },
    )
  }

  // Match by RECIPIENT SCRIPT, not amount alone. Deriving the expected output
  // script from the author's and platform's addresses is what binds the payment
  // to the right parties — an amount-only check would accept a tx paying the
  // payer's own change outputs, letting anyone unlock for network fees while the
  // author and platform receive nothing. (Same pattern as verify-publish-payment
  // and mintPayments.) Any of the author's proven linked addresses counts as
  // the author output (they all pay the same person — see authorLinkedAddresses
  // in the docblock); the current payout address is tried first and invalid
  // entries in the linked list are skipped rather than failing the verify.
  const authorHexes = new Set()
  for (const addr of [authorXecAddress, ...authorLinkedAddresses]) {
    if (!addr) continue
    try {
      const hex = outputScriptToHex(getOutputScriptFromAddress(addr))
      if (hex) authorHexes.add(hex)
    } catch {
      /* skip malformed entries */
    }
  }
  let platformHex
  try {
    platformHex = outputScriptToHex(getOutputScriptFromAddress(platformXecAddress))
  } catch {
    platformHex = ''
  }
  if (authorHexes.size === 0) {
    return { ok: false, error: 'Invalid author payment address' }
  }
  if (!platformHex) {
    return { ok: false, error: 'Invalid platform payment address' }
  }

  const authorOutputIdx = outputs.findIndex(
    (o) =>
      authorHexes.has(outputScriptToHex(o.outputScript)) &&
      o.sats >= authorAmountSatsNum,
  )
  const authorOutput =
    authorOutputIdx >= 0 ? outputs[authorOutputIdx] : null
  const platformOutput = outputs.find(
    (o, idx) =>
      idx !== authorOutputIdx &&
      outputScriptToHex(o.outputScript) === platformHex &&
      o.sats >= platformAmountSatsNum,
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

  // Outputs check out — grant the unlock on FIRST-SEEN (0-conf), with NO
  // Avalanche-finality wait. Deliberate product choice (2026-07-23): the gate
  // cost ~2-3s on EVERY honest reader's unlock to defend against a rare, hard-to-
  // execute double-spend whose only payoff is one free read of a cents-priced
  // article. With Avalanche making double-spends genuinely hard and the amounts
  // tiny, that trade isn't worth the latency — the paywall becomes 0-conf
  // best-effort here.
  //   SCOPE: this is the ONE surface that skips finality. Mints, paid feed
  //   posts/reactions, article comments, and claim-grants ALL still gate on
  //   finality (their own txIsFinal checks) — higher-value / irreversible
  //   on-chain actions keep the guard. The tx is still fetched and its outputs
  //   verified above, so a fake or underpaying tx is still rejected; we just no
  //   longer wait for it to finalize.
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

  // The author notification (someone bought their article) is fired by the
  // caller AFTER the response is flushed — via after() in app/api/verify-payment
  // — so the reader's reveal never waits on that write. It's best-effort and the
  // reader is already entitled here (the unlock row is recorded above), so
  // returning payerAddress is all the caller needs.
  return { ok: true, txid, payerAddress }
}
