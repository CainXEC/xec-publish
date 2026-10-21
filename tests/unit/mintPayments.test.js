import { describe, it, expect } from 'vitest'
import { matchXecMintTx, pickUntaggedMintRow } from '@/lib/mintPayments'
import { encodeFeedOpReturnRaw, FEED_ACTION } from '@/lib/feedProtocol'

// -----------------------------------------------------------------------------
// Untagged mint payments (the @XEC_BITCOIN case, txid 97fad347…).
//
// A buyer copied the mint address and sent the exact price by hand. The tx had
// NO OP_RETURN, so the mintId tag could never match: the status poll kept saying
// "awaiting payment", the reconciler skipped it as untagged, and the 10,000 XEC
// sat at the mint wallet with no NFT and no refund. These pin the fallback: a
// plain send from the logged-in buyer's own address now matches their intent,
// and nothing else loosens.
// -----------------------------------------------------------------------------

const MINT_ADDR = 'ecash:qpw8gv2d7lahzfzsnakwefmfs6jhwex5zyfnejs2k6'
const MINT_SCRIPT = '76a9145c74314df7fb7124509f6ceca76986a57764d41188ac'
const BUYER_ADDR = 'ecash:qzvzy5gr6gecgux3xauphuvw0dz062xdu5lzpjcfr2'
const BUYER_SCRIPT = '76a91498225103d2338470d137781bf18e7b44fd28cde588ac'
// Someone else's wallet — a well-formed P2PKH that isn't the buyer's.
const OTHER_SCRIPT = '76a914' + '11'.repeat(20) + '88ac'

const MINT_ID = '72dea391-e116-4947-9844-52a5fb182432'
const OTHER_MINT_ID = 'c5abe1f3-518b-456f-828e-b83879e6910d'
const PRICE = 1_000_000 // 10,000 XEC
// accountUnlockAddressForms returns bare + prefixed forms of every linked address.
const BUYER_FORMS = [BUYER_ADDR.slice(6), BUYER_ADDR]

const tagScript = (mintId) =>
  '6a' + encodeFeedOpReturnRaw({ action: FEED_ACTION.HANDLE, nonce: mintId })

// Same shape as the real tx 97fad347… (two buyer inputs, mint output + change).
function tx({ payerScript = BUYER_SCRIPT, sats = PRICE, opReturn = null, isFinal = true } = {}) {
  const outputs = []
  if (opReturn) outputs.push({ sats: 0n, outputScript: opReturn })
  outputs.push({ sats: BigInt(sats), outputScript: MINT_SCRIPT })
  outputs.push({ sats: 45_478_106n, outputScript: payerScript })
  return {
    txid: '97fad3471ce721f798d51845a534348ea6c45f95bf7c923e8a2afb9ee0870820',
    inputs: [{ outputScript: payerScript }, { outputScript: payerScript }],
    outputs,
    isFinal,
  }
}

describe('matchXecMintTx', () => {
  it('matches a tagged payment for this mint (unchanged)', () => {
    const m = matchXecMintTx(tx({ opReturn: tagScript(MINT_ID) }), MINT_ADDR, MINT_ID, PRICE)
    expect(m).toMatchObject({ match: 'tagged', payerAddress: BUYER_ADDR, sats: PRICE, isFinal: true })
  })

  it('matches a plain send from the logged-in buyer (the regression)', () => {
    const m = matchXecMintTx(tx(), MINT_ADDR, MINT_ID, PRICE, BUYER_FORMS)
    expect(m).toMatchObject({ match: 'untagged', payerAddress: BUYER_ADDR, sats: PRICE })
  })

  it('still rejects a plain send when the intent has no expected payers (anonymous)', () => {
    expect(matchXecMintTx(tx(), MINT_ADDR, MINT_ID, PRICE)).toBeNull()
    expect(matchXecMintTx(tx(), MINT_ADDR, MINT_ID, PRICE, [])).toBeNull()
  })

  it('rejects a plain send from a wallet that is not the buyer', () => {
    expect(matchXecMintTx(tx({ payerScript: OTHER_SCRIPT }), MINT_ADDR, MINT_ID, PRICE, BUYER_FORMS)).toBeNull()
  })

  it('never lets a tx tagged for ANOTHER mint fall through to the payer match', () => {
    const t = tx({ opReturn: tagScript(OTHER_MINT_ID) })
    expect(matchXecMintTx(t, MINT_ADDR, MINT_ID, PRICE, BUYER_FORMS)).toBeNull()
  })

  it('never treats a tx with any other OP_RETURN as untagged', () => {
    const feedLike = '6a' + encodeFeedOpReturnRaw({ action: FEED_ACTION.LIKE, targetTxid: 'ab'.repeat(32) })
    expect(matchXecMintTx(tx({ opReturn: feedLike }), MINT_ADDR, MINT_ID, PRICE, BUYER_FORMS)).toBeNull()
  })

  it('rejects an underpayment either way', () => {
    expect(matchXecMintTx(tx({ sats: PRICE - 1 }), MINT_ADDR, MINT_ID, PRICE, BUYER_FORMS)).toBeNull()
    expect(matchXecMintTx(tx({ sats: PRICE - 1, opReturn: tagScript(MINT_ID) }), MINT_ADDR, MINT_ID, PRICE)).toBeNull()
  })

  it("skips the mint wallet's own txs (change back to itself)", () => {
    const own = tx({ payerScript: MINT_SCRIPT })
    expect(matchXecMintTx(own, MINT_ADDR, MINT_ID, PRICE, [MINT_ADDR])).toBeNull()
  })

  it('reports finality so the caller can gate on it', () => {
    expect(matchXecMintTx(tx({ isFinal: false }), MINT_ADDR, MINT_ID, PRICE, BUYER_FORMS).isFinal).toBe(false)
  })
})

describe('pickUntaggedMintRow', () => {
  // The real rows: an abandoned 17:07 intent and the 00:51 one that was paid.
  const stale = { id: OTHER_MINT_ID, expected_sats: PRICE, created_at: '2026-10-20T17:07:01Z', expires_at: '2026-10-20T17:22:01Z' }
  const paid = { id: MINT_ID, expected_sats: PRICE, created_at: '2026-10-21T00:51:03Z', expires_at: '2026-10-21T01:06:03Z' }
  const seenAt = 1792543961 // 2026-10-21T00:52:41Z

  it("pairs the payment with the intent whose pay window contains it", () => {
    expect(pickUntaggedMintRow([stale, paid], { sats: PRICE, seenAt })?.id).toBe(MINT_ID)
  })

  it('refuses to guess when two open intents both fit', () => {
    const twin = { ...paid, id: 'dddddddd-0000-4000-8000-000000000000' }
    expect(pickUntaggedMintRow([paid, twin], { sats: PRICE, seenAt })).toBeNull()
  })

  it('ignores an intent the payment does not cover', () => {
    const pricier = { ...paid, expected_sats: PRICE * 10 }
    expect(pickUntaggedMintRow([pricier], { sats: PRICE, seenAt })).toBeNull()
  })

  it('ignores a payment outside every pay window, or with no timestamp', () => {
    expect(pickUntaggedMintRow([stale], { sats: PRICE, seenAt })).toBeNull()
    expect(pickUntaggedMintRow([paid], { sats: PRICE, seenAt: 0 })).toBeNull()
  })
})
