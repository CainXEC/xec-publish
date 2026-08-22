import { describe, it, expect, beforeAll, vi } from 'vitest'
import { priceFeedPost, FEED_MAX_CHARS } from '@/lib/feedPricing'
import { contentHashHex, encodeFeedOpReturnRaw, FEED_ACTION } from '@/lib/feedProtocol'
import { buildPublishFeeBip21 } from '@/lib/paymentSplit'

// The builder captures NEXT_PUBLIC_PLATFORM_XEC_ADDRESS at module load, so stub
// it BEFORE importing. This is the same value the server uses (they MUST match,
// or a locally-built payment would pay a different address and /confirm reject).
const PLATFORM = 'ecash:qrw35trzq7hagejru2h3eqf5eyhxxmg4cul69u7am3'

let buildFeedPaymentLocally
let canBuildFeedPaymentLocally
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_PLATFORM_XEC_ADDRESS', PLATFORM)
  const mod = await import('@/lib/feed/buildFeedPayment')
  buildFeedPaymentLocally = mod.buildFeedPaymentLocally
  canBuildFeedPaymentLocally = mod.canBuildFeedPaymentLocally
})

// The whole point: the browser must produce BYTE-FOR-BYTE what the server's
// /api/feed/prepare produces for a POST/QUOTE, so /api/feed/confirm's on-chain
// verification (which recomputes the same `expected`) accepts it. Both sides call
// the identical pure functions, so we assert the builder composes them the same
// way the prepare route does.
describe('buildFeedPaymentLocally', () => {
  it('POST: hash + op_return + bip21 match the server formula', () => {
    const content = 'Hello, proof of writing!'
    const r = buildFeedPaymentLocally({ action: 'post', content })

    const priced = priceFeedPost(content)
    const contentHash = contentHashHex(content)
    const opReturn = encodeFeedOpReturnRaw({ action: FEED_ACTION.POST, targetTxid: null, contentHash })
    const bip21 = buildPublishFeeBip21(PLATFORM, priced.costXec, opReturn)

    expect(r.ok).toBe(true)
    expect(r.action).toBe(FEED_ACTION.POST)
    expect(r.contentHash).toBe(contentHash)
    expect(r.costXec).toBe(priced.costXec)
    expect(r.amountXec).toBe(priced.costXec)
    expect(r.bip21Url).toBe(bip21)
    expect(r.payAddress).toBe(PLATFORM)
    expect(r.cashtabUrl).toBe(`https://cashtab.com/#/send?bip21=${bip21}`)
    expect(r.parentTxid).toBeNull()
    expect(r.quotedTxid).toBeNull()
    expect(typeof r.preparedAt).toBe('number')
    expect(r.local).toBe(true)
  })

  it('QUOTE: encodes the quoted txid as the op_return target', () => {
    const content = 'Sharp take — worth reading.'
    const quotedTxid = 'a'.repeat(64)
    const r = buildFeedPaymentLocally({ action: 'quote', content, quotedTxid })

    const contentHash = contentHashHex(content)
    const opReturn = encodeFeedOpReturnRaw({ action: FEED_ACTION.QUOTE, targetTxid: quotedTxid, contentHash })
    const bip21 = buildPublishFeeBip21(PLATFORM, priceFeedPost(content).costXec, opReturn)

    expect(r.ok).toBe(true)
    expect(r.action).toBe(FEED_ACTION.QUOTE)
    expect(r.quotedTxid).toBe(quotedTxid)
    expect(r.bip21Url).toBe(bip21)
  })

  it('QUOTE: normalizes an uppercase txid to lowercase', () => {
    const quotedTxid = 'A'.repeat(64)
    const r = buildFeedPaymentLocally({ action: 'quote', content: 'hi there', quotedTxid })
    expect(r.ok).toBe(true)
    expect(r.quotedTxid).toBe('a'.repeat(64))
  })

  it('QUOTE with a missing/invalid txid → ok:false (caller falls back to /prepare)', () => {
    expect(buildFeedPaymentLocally({ action: 'quote', content: 'hi there', quotedTxid: null }).ok).toBe(false)
    expect(buildFeedPaymentLocally({ action: 'quote', content: 'hi there', quotedTxid: 'not-hex' }).ok).toBe(false)
  })

  it('unpriceable content → ok:false (caller falls back to /prepare)', () => {
    const tooLong = 'x'.repeat(FEED_MAX_CHARS + 1)
    expect(buildFeedPaymentLocally({ action: 'post', content: tooLong }).ok).toBe(false)
  })
})

describe('canBuildFeedPaymentLocally', () => {
  it('is true for post + quote, false for reply + poll', () => {
    expect(canBuildFeedPaymentLocally('post')).toBe(true)
    expect(canBuildFeedPaymentLocally('quote')).toBe(true)
    expect(canBuildFeedPaymentLocally('reply')).toBe(false)
    expect(canBuildFeedPaymentLocally('post', { poll: true })).toBe(false)
  })
})
