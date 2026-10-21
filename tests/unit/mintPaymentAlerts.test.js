import { describe, it, expect } from 'vitest'
import { readMintWalletReceipt } from '@/lib/mintPayments'
import {
  looksLikePurchase,
  unclaimedReceipts,
  orderNeedsAttention,
  PURCHASE_FLOOR_SATS,
  CLAIM_GRACE_SEC,
  ORDER_OVERDUE_MS,
} from '@/lib/mintPaymentAlerts'
import { encodeFeedOpReturnRaw, FEED_ACTION } from '@/lib/feedProtocol'

// -----------------------------------------------------------------------------
// Unclaimed mint payment alert (the safety net under every mint-matching gap).
//
// Each gap so far (a hand-sent untagged payment, a tagged payment that landed
// after its window) failed the same silent way: the money sat at the mint
// wallet, no NFT, no refund, nobody told. The alert flags any purchase-sized
// final payment no order claimed after 30 minutes, plus orders that took a
// payment and never finished with it. These pin what counts.
// -----------------------------------------------------------------------------

const MINT_ADDR = 'ecash:qpw8gv2d7lahzfzsnakwefmfs6jhwex5zyfnejs2k6'
const MINT_SCRIPT = '76a9145c74314df7fb7124509f6ceca76986a57764d41188ac'
const BUYER_ADDR = 'ecash:qzvzy5gr6gecgux3xauphuvw0dz062xdu5lzpjcfr2'
const BUYER_SCRIPT = '76a91498225103d2338470d137781bf18e7b44fd28cde588ac'
const POW = 'f36e1b3d9a2aaf74f132fef3834e9743b945a667a4204e761b85f2e7b65fd41a'
const MINT_ID = '72dea391-e116-4947-9844-52a5fb182432'
const SEEN = 1792543961 // 2026-10-21T00:52:41Z

const tagScript = (mintId) => '6a' + encodeFeedOpReturnRaw({ action: FEED_ACTION.HANDLE, nonce: mintId })

function tx({ payerScript = BUYER_SCRIPT, sats = 1_000_000, opReturn = null, token = null, seen = SEEN, isFinal = true } = {}) {
  const outputs = []
  if (opReturn) outputs.push({ sats: 0n, outputScript: opReturn })
  outputs.push({ sats: BigInt(sats), outputScript: MINT_SCRIPT, ...(token ? { token } : {}) })
  outputs.push({ sats: 45_478_106n, outputScript: payerScript })
  return {
    txid: '97fad3471ce721f798d51845a534348ea6c45f95bf7c923e8a2afb9ee0870820',
    inputs: [{ outputScript: payerScript }],
    outputs,
    timeFirstSeen: seen,
    isFinal,
  }
}

describe('readMintWalletReceipt', () => {
  it('reads a hand-sent XEC payment (the @XEC_BITCOIN shape)', () => {
    expect(readMintWalletReceipt(tx(), MINT_ADDR, POW)).toMatchObject({
      sats: 1_000_000, powAtoms: 0n, payerAddress: BUYER_ADDR, mintId: null, seenAt: SEEN, isFinal: true,
    })
  })

  it('reads the mintId tag off a tagged payment', () => {
    expect(readMintWalletReceipt(tx({ opReturn: tagScript(MINT_ID) }), MINT_ADDR, POW).mintId).toBe(MINT_ID)
  })

  it('reads a POW send, and never mistakes its SLP OP_RETURN for a tag', () => {
    const slp = '6a04534c500001010453454e4420' + POW + '08000000000000000a'
    const r = readMintWalletReceipt(tx({ sats: 546, opReturn: slp, token: { tokenId: POW, atoms: 10n } }), MINT_ADDR, POW)
    expect(r).toMatchObject({ sats: 546, powAtoms: 10n, mintId: null })
  })

  it("skips the mint wallet's own txs (mints, refunds, splits)", () => {
    expect(readMintWalletReceipt(tx({ payerScript: MINT_SCRIPT }), MINT_ADDR, POW)).toBeNull()
  })

  it('falls back to block time when there is no first-seen time', () => {
    const t = { ...tx({ seen: 0 }), block: { timestamp: SEEN + 600 } }
    expect(readMintWalletReceipt(t, MINT_ADDR, POW).seenAt).toBe(SEEN + 600)
  })
})

describe('looksLikePurchase', () => {
  it('counts any POW, and XEC from 1,000 up', () => {
    expect(looksLikePurchase({ sats: 546, powAtoms: 1n })).toBe(true)
    expect(looksLikePurchase({ sats: PURCHASE_FLOOR_SATS, powAtoms: 0n })).toBe(true)
    expect(looksLikePurchase({ sats: 1_000_000, powAtoms: 0n })).toBe(true)
  })

  it('ignores login / address-change challenges (6–14 XEC) and dust', () => {
    expect(looksLikePurchase({ sats: 600, powAtoms: 0n })).toBe(false)
    expect(looksLikePurchase({ sats: 1_400, powAtoms: 0n })).toBe(false)
    expect(looksLikePurchase({ sats: PURCHASE_FLOOR_SATS - 1, powAtoms: 0n })).toBe(false)
  })
})

describe('unclaimedReceipts', () => {
  const r = (over = {}) => ({ txid: 'a'.repeat(64), sats: 1_000_000, powAtoms: 0n, payerAddress: BUYER_ADDR, mintId: null, seenAt: SEEN, isFinal: true, ...over })
  const later = SEEN + CLAIM_GRACE_SEC

  it('flags a purchase-sized final payment no order claimed, once the grace is over', () => {
    expect(unclaimedReceipts([r()], new Set(), later)).toHaveLength(1)
  })

  it('waits out the grace period (the tab or reconciler usually claims it first)', () => {
    expect(unclaimedReceipts([r()], new Set(), later - 1)).toHaveLength(0)
  })

  it('never flags a payment an order claimed', () => {
    expect(unclaimedReceipts([r()], new Set(['a'.repeat(64)]), later)).toHaveLength(0)
  })

  it('ignores payments that are not final, too small, or have no timestamp', () => {
    expect(unclaimedReceipts([r({ isFinal: false })], new Set(), later)).toHaveLength(0)
    expect(unclaimedReceipts([r({ sats: 600 })], new Set(), later)).toHaveLength(0)
    expect(unclaimedReceipts([r({ seenAt: 0 })], new Set(), later)).toHaveLength(0)
  })

  it('flags an unclaimed POW send', () => {
    expect(unclaimedReceipts([r({ sats: 546, powAtoms: 10n })], new Set(), later)).toHaveLength(1)
  })
})

describe('orderNeedsAttention', () => {
  const created = '2026-10-21T00:51:03Z'
  const at = new Date(created).getTime()
  const row = (over = {}) => ({ status: 'paid', payment_txid: 'b'.repeat(64), refund_txid: null, created_at: created, ...over })

  it('a stuck mint always needs a person (delivery owed)', () => {
    expect(orderNeedsAttention(row({ status: 'stuck' }), at)).toBe('delivery_stuck')
  })

  it('a failed refund needs a person — nothing retries it', () => {
    expect(orderNeedsAttention(row({ status: 'failed' }), at)).toBe('refund_failed')
  })

  it('a failed row that never took a payment (POW send reused) owes nothing', () => {
    expect(orderNeedsAttention(row({ status: 'failed', payment_txid: null }), at)).toBeNull()
  })

  it('a failed row that did refund owes nothing', () => {
    expect(orderNeedsAttention(row({ status: 'failed', refund_txid: 'c'.repeat(64) }), at)).toBeNull()
  })

  it('paid / contended only once overdue (the reconciler retries them first)', () => {
    expect(orderNeedsAttention(row(), at + ORDER_OVERDUE_MS - 1)).toBeNull()
    expect(orderNeedsAttention(row(), at + ORDER_OVERDUE_MS)).toBe('delivery_overdue')
    expect(orderNeedsAttention(row({ status: 'contended' }), at + ORDER_OVERDUE_MS - 1)).toBeNull()
    expect(orderNeedsAttention(row({ status: 'contended' }), at + ORDER_OVERDUE_MS)).toBe('refund_overdue')
  })

  it('finished or unpaid orders need nothing', () => {
    for (const status of ['minted', 'refunded', 'pending', 'expired']) {
      expect(orderNeedsAttention(row({ status }), at + 10 * ORDER_OVERDUE_MS)).toBeNull()
    }
  })
})
