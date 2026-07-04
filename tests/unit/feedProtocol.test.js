import { describe, it, expect } from 'vitest'
import {
  FEED_ACTION,
  FEED_LOKAD,
  contentHashHex,
  encodeFeedOpReturnRaw,
  decodeFeedOpReturn,
} from '@/lib/feedProtocol'
import { toHex } from 'ecash-lib'

const TARGET = 'a'.repeat(64)
const HASH = contentHashHex('hello world')
const LOKAD_HEX = toHex(FEED_LOKAD) // "50524f57"

// Re-add the OP_RETURN byte that Cashtab prepends, so we can round-trip decode.
const asScript = (raw) => `6a${raw}`

describe('encodeFeedOpReturnRaw', () => {
  it('post carries a content hash but no target', () => {
    const raw = encodeFeedOpReturnRaw({ action: FEED_ACTION.POST, contentHash: HASH })
    // 04 <LOKAD> 00 <OP_1=51> 20 <hash>
    expect(raw).toBe(`04${LOKAD_HEX}0051` + `20${HASH}`)
  })

  it('reply carries target then content hash', () => {
    const raw = encodeFeedOpReturnRaw({
      action: FEED_ACTION.REPLY,
      targetTxid: TARGET,
      contentHash: HASH,
    })
    expect(raw).toBe(`04${LOKAD_HEX}0052` + `20${TARGET}` + `20${HASH}`)
  })

  it('quote carries target then content hash (OP_3)', () => {
    const raw = encodeFeedOpReturnRaw({
      action: FEED_ACTION.QUOTE,
      targetTxid: TARGET,
      contentHash: HASH,
    })
    expect(raw).toBe(`04${LOKAD_HEX}0053` + `20${TARGET}` + `20${HASH}`)
  })

  it('repost carries only a target, no content hash (OP_4)', () => {
    const raw = encodeFeedOpReturnRaw({ action: FEED_ACTION.REPOST, targetTxid: TARGET })
    expect(raw).toBe(`04${LOKAD_HEX}0054` + `20${TARGET}`)
  })

  it('like carries only a target, no content hash (OP_5)', () => {
    const raw = encodeFeedOpReturnRaw({ action: FEED_ACTION.LIKE, targetTxid: TARGET })
    expect(raw).toBe(`04${LOKAD_HEX}0055` + `20${TARGET}`)
  })

  it('accepts parentTxid as an alias for targetTxid', () => {
    const a = encodeFeedOpReturnRaw({ action: FEED_ACTION.REPLY, targetTxid: TARGET, contentHash: HASH })
    const b = encodeFeedOpReturnRaw({ action: FEED_ACTION.REPLY, parentTxid: TARGET, contentHash: HASH })
    expect(a).toBe(b)
  })

  it('lowercases hex inputs so the on-chain form is canonical', () => {
    const upper = encodeFeedOpReturnRaw({
      action: FEED_ACTION.LIKE,
      targetTxid: TARGET.toUpperCase(),
    })
    expect(upper).toBe(encodeFeedOpReturnRaw({ action: FEED_ACTION.LIKE, targetTxid: TARGET }))
  })

  it('rejects unknown actions', () => {
    expect(() => encodeFeedOpReturnRaw({ action: 0, contentHash: HASH })).toThrow()
    expect(() => encodeFeedOpReturnRaw({ action: 6, contentHash: HASH })).toThrow()
  })

  it('requires a target for reply/quote/repost/like', () => {
    expect(() => encodeFeedOpReturnRaw({ action: FEED_ACTION.REPOST })).toThrow()
    expect(() => encodeFeedOpReturnRaw({ action: FEED_ACTION.LIKE, targetTxid: 'short' })).toThrow()
  })

  it('requires a content hash for post/reply/quote', () => {
    expect(() => encodeFeedOpReturnRaw({ action: FEED_ACTION.POST })).toThrow()
    expect(() =>
      encodeFeedOpReturnRaw({ action: FEED_ACTION.QUOTE, targetTxid: TARGET }),
    ).toThrow()
  })
})

describe('decodeFeedOpReturn', () => {
  it('round-trips every action', () => {
    const cases = [
      { action: FEED_ACTION.POST, contentHash: HASH },
      { action: FEED_ACTION.REPLY, targetTxid: TARGET, contentHash: HASH },
      { action: FEED_ACTION.QUOTE, targetTxid: TARGET, contentHash: HASH },
      { action: FEED_ACTION.REPOST, targetTxid: TARGET },
      { action: FEED_ACTION.LIKE, targetTxid: TARGET },
    ]
    for (const c of cases) {
      const decoded = decodeFeedOpReturn(asScript(encodeFeedOpReturnRaw(c)))
      expect(decoded).not.toBeNull()
      expect(decoded.version).toBe(0)
      expect(decoded.action).toBe(c.action)
      expect(decoded.targetTxid).toBe(c.targetTxid ?? null)
      expect(decoded.contentHash).toBe(c.contentHash ?? null)
      // parentTxid is kept as a back-compat alias for targetTxid.
      expect(decoded.parentTxid).toBe(decoded.targetTxid)
    }
  })

  it('returns null for a non-OP_RETURN script', () => {
    expect(decodeFeedOpReturn('76a914' + '00'.repeat(20) + '88ac')).toBeNull()
  })

  it('returns null when the LOKAD prefix is not "PROW"', () => {
    const raw = encodeFeedOpReturnRaw({ action: FEED_ACTION.LIKE, targetTxid: TARGET })
    // Swap the LOKAD bytes for "XXXX" (0x58585858).
    const tampered = raw.replace(LOKAD_HEX, '58585858')
    expect(decodeFeedOpReturn(asScript(tampered))).toBeNull()
  })

  it('returns null when the target push is truncated', () => {
    // OP_RETURN | push4 PROW | OP_0 | OP_5 | push32 <only 4 bytes present>
    const truncated = `6a04${LOKAD_HEX}00552011223344`
    expect(decodeFeedOpReturn(truncated)).toBeNull()
  })

  it('returns null for an out-of-range action opcode', () => {
    // OP_6 (0x56) is not a defined feed action.
    const bad = `6a04${LOKAD_HEX}0056` + `20${TARGET}`
    expect(decodeFeedOpReturn(bad)).toBeNull()
  })

  it('tolerates a leading 0x and whitespace', () => {
    const raw = encodeFeedOpReturnRaw({ action: FEED_ACTION.POST, contentHash: HASH })
    expect(decodeFeedOpReturn(` 0x6a${raw} `)?.action).toBe(FEED_ACTION.POST)
  })
})
