import { describe, it, expect } from 'vitest'
import { encodeCashAddress } from 'ecashaddrjs'
import { matchFeedTx } from '@/lib/verifyFeedPost'
import { FEED_ACTION, contentHashHex, encodeFeedOpReturnRaw } from '@/lib/feedProtocol'

// Build a P2PKH scriptPubKey + its ecash address from a 20-byte hash, so the
// script the verifier reads decodes back to the address it's comparing against.
function p2pkh(hash20) {
  return {
    script: `76a914${hash20}88ac`,
    address: encodeCashAddress('ecash', 'p2pkh', hash20),
  }
}

const PLATFORM = p2pkh('11'.repeat(20))
const AUTHOR = p2pkh('22'.repeat(20))
const PAYER = p2pkh('33'.repeat(20))
const TARGET = 'a'.repeat(64)
const HASH = contentHashHex('a post about proof of writing')

// A fake Chronik tx: one payer input, an OP_RETURN commitment, plus paid outputs.
function tx(commitRaw, outputs) {
  return {
    txid: 'f'.repeat(64),
    inputs: [{ outputScript: PAYER.script }],
    outputs: [{ outputScript: `6a${commitRaw}`, sats: 0 }, ...outputs],
  }
}

const out = (p2, xec) => ({ outputScript: p2.script, sats: xec * 100 })

describe('matchFeedTx — content-bearing actions', () => {
  it('accepts a POST paid 100% to the platform', () => {
    const commit = encodeFeedOpReturnRaw({ action: FEED_ACTION.POST, contentHash: HASH })
    const t = tx(commit, [out(PLATFORM, 100)])
    const m = matchFeedTx(t, {
      action: FEED_ACTION.POST,
      contentHash: HASH,
      platformAddress: PLATFORM.address,
      costXec: 100,
    })
    expect(m).toMatchObject({ txid: t.txid, payerAddress: PAYER.address, sats: 10000 })
  })

  it('rejects a POST that underpays the platform', () => {
    const commit = encodeFeedOpReturnRaw({ action: FEED_ACTION.POST, contentHash: HASH })
    const t = tx(commit, [out(PLATFORM, 99)])
    expect(
      matchFeedTx(t, {
        action: FEED_ACTION.POST,
        contentHash: HASH,
        platformAddress: PLATFORM.address,
        costXec: 100,
      }),
    ).toBeNull()
  })

  it('rejects a POST whose committed hash differs from expected', () => {
    const commit = encodeFeedOpReturnRaw({ action: FEED_ACTION.POST, contentHash: HASH })
    const t = tx(commit, [out(PLATFORM, 100)])
    expect(
      matchFeedTx(t, {
        action: FEED_ACTION.POST,
        contentHash: contentHashHex('different content'),
        platformAddress: PLATFORM.address,
        costXec: 100,
      }),
    ).toBeNull()
  })

  it('accepts a REPLY split 94/6 to the parent author and platform', () => {
    const commit = encodeFeedOpReturnRaw({
      action: FEED_ACTION.REPLY,
      targetTxid: TARGET,
      contentHash: HASH,
    })
    const t = tx(commit, [out(AUTHOR, 94), out(PLATFORM, 6)])
    const m = matchFeedTx(t, {
      action: FEED_ACTION.REPLY,
      parentTxid: TARGET,
      contentHash: HASH,
      platformAddress: PLATFORM.address,
      payoutAddress: AUTHOR.address,
      costXec: 100,
    })
    expect(m).toMatchObject({ txid: t.txid, payerAddress: PAYER.address, sats: 10000 })
  })

  it('rejects a REPLY pointing at the wrong target', () => {
    const commit = encodeFeedOpReturnRaw({
      action: FEED_ACTION.REPLY,
      targetTxid: TARGET,
      contentHash: HASH,
    })
    const t = tx(commit, [out(AUTHOR, 94), out(PLATFORM, 6)])
    expect(
      matchFeedTx(t, {
        action: FEED_ACTION.REPLY,
        parentTxid: 'b'.repeat(64),
        contentHash: HASH,
        platformAddress: PLATFORM.address,
        payoutAddress: AUTHOR.address,
        costXec: 100,
      }),
    ).toBeNull()
  })

  it('accepts a QUOTE paid 100% to the platform', () => {
    const commit = encodeFeedOpReturnRaw({
      action: FEED_ACTION.QUOTE,
      targetTxid: TARGET,
      contentHash: HASH,
    })
    const t = tx(commit, [out(PLATFORM, 100)])
    const m = matchFeedTx(t, {
      action: FEED_ACTION.QUOTE,
      parentTxid: TARGET,
      contentHash: HASH,
      platformAddress: PLATFORM.address,
      costXec: 100,
    })
    expect(m).toMatchObject({ sats: 10000 })
  })
})

describe('matchFeedTx — reactions (like / repost)', () => {
  it('accepts a LIKE split 94/6, no content hash required', () => {
    const commit = encodeFeedOpReturnRaw({ action: FEED_ACTION.LIKE, targetTxid: TARGET })
    const t = tx(commit, [out(AUTHOR, 94), out(PLATFORM, 6)])
    const m = matchFeedTx(t, {
      action: FEED_ACTION.LIKE,
      parentTxid: TARGET,
      contentHash: null,
      platformAddress: PLATFORM.address,
      payoutAddress: AUTHOR.address,
      costXec: 100,
    })
    expect(m).toMatchObject({ sats: 10000 })
  })

  it('accepts a REPOST split 94/6', () => {
    const commit = encodeFeedOpReturnRaw({ action: FEED_ACTION.REPOST, targetTxid: TARGET })
    const t = tx(commit, [out(AUTHOR, 94), out(PLATFORM, 6)])
    const m = matchFeedTx(t, {
      action: FEED_ACTION.REPOST,
      parentTxid: TARGET,
      contentHash: null,
      platformAddress: PLATFORM.address,
      payoutAddress: AUTHOR.address,
      costXec: 100,
    })
    expect(m).toMatchObject({ sats: 10000 })
  })

  it('rejects a LIKE that shorts the author leg', () => {
    const commit = encodeFeedOpReturnRaw({ action: FEED_ACTION.LIKE, targetTxid: TARGET })
    const t = tx(commit, [out(AUTHOR, 90), out(PLATFORM, 6)])
    expect(
      matchFeedTx(t, {
        action: FEED_ACTION.LIKE,
        parentTxid: TARGET,
        contentHash: null,
        platformAddress: PLATFORM.address,
        payoutAddress: AUTHOR.address,
        costXec: 100,
      }),
    ).toBeNull()
  })

  it('rejects when the on-chain action does not match the expected action', () => {
    // On-chain is a LIKE, but we expected a REPOST of the same target.
    const commit = encodeFeedOpReturnRaw({ action: FEED_ACTION.LIKE, targetTxid: TARGET })
    const t = tx(commit, [out(AUTHOR, 94), out(PLATFORM, 6)])
    expect(
      matchFeedTx(t, {
        action: FEED_ACTION.REPOST,
        parentTxid: TARGET,
        contentHash: null,
        platformAddress: PLATFORM.address,
        payoutAddress: AUTHOR.address,
        costXec: 100,
      }),
    ).toBeNull()
  })

  it('returns null for a tx with no feed commitment', () => {
    const t = {
      txid: 'f'.repeat(64),
      inputs: [{ outputScript: PAYER.script }],
      outputs: [out(PLATFORM, 100)],
    }
    expect(
      matchFeedTx(t, {
        action: FEED_ACTION.POST,
        contentHash: HASH,
        platformAddress: PLATFORM.address,
        costXec: 100,
      }),
    ).toBeNull()
  })
})
