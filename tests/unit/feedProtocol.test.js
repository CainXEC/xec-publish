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
const SAMPLE_UUID = '123e4567-e89b-12d3-a456-426614174000' // 36 ASCII chars
const SAMPLE_UUID_HEX = toHex(new TextEncoder().encode(SAMPLE_UUID))

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
    expect(() => encodeFeedOpReturnRaw({ action: 9, contentHash: HASH })).toThrow()
  })

  it('requires a target for reply/quote/repost/like', () => {
    expect(() => encodeFeedOpReturnRaw({ action: FEED_ACTION.REPOST })).toThrow()
    expect(() => encodeFeedOpReturnRaw({ action: FEED_ACTION.LIKE, targetTxid: 'short' })).toThrow()
  })

  it('requires a content hash for post/reply/quote/publish', () => {
    expect(() => encodeFeedOpReturnRaw({ action: FEED_ACTION.POST })).toThrow()
    expect(() =>
      encodeFeedOpReturnRaw({ action: FEED_ACTION.QUOTE, targetTxid: TARGET }),
    ).toThrow()
    expect(() => encodeFeedOpReturnRaw({ action: FEED_ACTION.PUBLISH })).toThrow()
  })

  it('publish carries a content hash, no target (OP_6)', () => {
    const raw = encodeFeedOpReturnRaw({ action: FEED_ACTION.PUBLISH, contentHash: HASH })
    expect(raw).toBe(`04${LOKAD_HEX}0056` + `20${HASH}`)
  })

  it('unlock is the bare 8-byte marker — no payload (OP_7)', () => {
    const raw = encodeFeedOpReturnRaw({ action: FEED_ACTION.UNLOCK })
    expect(raw).toBe(`04${LOKAD_HEX}0057`)
  })

  it('delegate carries a 33-byte compressed pubkey (OP_12)', () => {
    const pubkey = '02' + 'ab'.repeat(32)
    const raw = encodeFeedOpReturnRaw({ action: FEED_ACTION.DELEGATE, pubkey })
    // 04 <LOKAD> 00 <OP_12=5c> 21 <pubkey>
    expect(raw).toBe(`04${LOKAD_HEX}005c` + `21${pubkey}`)
  })

  it('requires a 33-byte hex pubkey for delegate', () => {
    expect(() => encodeFeedOpReturnRaw({ action: FEED_ACTION.DELEGATE })).toThrow()
    expect(() =>
      encodeFeedOpReturnRaw({ action: FEED_ACTION.DELEGATE, pubkey: '02' + 'ab'.repeat(31) }),
    ).toThrow()
    expect(() =>
      encodeFeedOpReturnRaw({ action: FEED_ACTION.DELEGATE, pubkey: '04' + 'ab'.repeat(64) }),
    ).toThrow() // uncompressed (65B) is not the committed form
  })

  it('auth carries the 36-byte ASCII nonce (OP_8)', () => {
    const raw = encodeFeedOpReturnRaw({ action: FEED_ACTION.AUTH, nonce: SAMPLE_UUID })
    // 24 = push 36 bytes.
    expect(raw).toBe(`04${LOKAD_HEX}0058` + `24${SAMPLE_UUID_HEX}`)
  })

  it('requires a 36-byte nonce for auth', () => {
    expect(() => encodeFeedOpReturnRaw({ action: FEED_ACTION.AUTH })).toThrow()
    expect(() => encodeFeedOpReturnRaw({ action: FEED_ACTION.AUTH, nonce: 'short' })).toThrow()
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
      { action: FEED_ACTION.PUBLISH, contentHash: HASH },
      { action: FEED_ACTION.UNLOCK },
      { action: FEED_ACTION.AUTH, nonce: SAMPLE_UUID },
      { action: FEED_ACTION.DELEGATE, pubkey: '02' + 'ab'.repeat(32) },
    ]
    for (const c of cases) {
      const decoded = decodeFeedOpReturn(asScript(encodeFeedOpReturnRaw(c)))
      expect(decoded).not.toBeNull()
      expect(decoded.version).toBe(0)
      expect(decoded.action).toBe(c.action)
      expect(decoded.targetTxid).toBe(c.targetTxid ?? null)
      expect(decoded.contentHash).toBe(c.contentHash ?? null)
      expect(decoded.nonce).toBe(c.nonce ?? null)
      expect(decoded.pubkey).toBe(c.pubkey ?? null)
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
    // OP_15 (0x5f) is beyond the defined POWR actions (OP_1..OP_14, FORUM=14).
    const bad = `6a04${LOKAD_HEX}005f` + `20${TARGET}`
    expect(decodeFeedOpReturn(bad)).toBeNull()
  })

  it('round-trips a tip: a bare marker with no target/hash/nonce', () => {
    const raw = encodeFeedOpReturnRaw({ action: FEED_ACTION.TIP })
    const decoded = decodeFeedOpReturn(asScript(raw))
    expect(decoded).toMatchObject({
      version: 0,
      action: FEED_ACTION.TIP,
      targetTxid: null,
      contentHash: null,
      nonce: null,
      pubkey: null,
    })
  })

  it('returns null for a delegate whose pubkey push is the wrong length', () => {
    // OP_12 with a 32-byte push where the 33-byte pubkey belongs.
    const bad = `6a04${LOKAD_HEX}005c` + `20${TARGET}`
    expect(decodeFeedOpReturn(bad)).toBeNull()
  })

  it('tolerates a leading 0x and whitespace', () => {
    const raw = encodeFeedOpReturnRaw({ action: FEED_ACTION.POST, contentHash: HASH })
    expect(decodeFeedOpReturn(` 0x6a${raw} `)?.action).toBe(FEED_ACTION.POST)
  })
})
