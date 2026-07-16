import { describe, it, expect } from 'vitest'
import { sha256, signMsg, verifyMsg, toHex } from 'ecash-lib'
import {
  POCKET_SENTENCE_V1,
  parsePastedSignature,
  verifySignatureAgainstPrimary,
  derivePocketFromSignature,
  buildRegisterProofString,
  signRegisterProof,
} from '@/lib/pocket/derive'

// =============================================================================
//  THE DETERMINISM CANARY.
//
//  Every user's pocket key is sha256(signMsg(POCKET_SENTENCE_V1, wallet_sk)).
//  That only recovers funds if signMsg stays byte-for-byte deterministic
//  (RFC6979, fixed "eCash Signed Message:" prefix, no salt) AND the sentence
//  never changes. These golden vectors pin the ENTIRE pipeline: if an
//  ecash-lib upgrade adds auxiliary randomness, changes the magic prefix, or
//  anyone edits the sentence, this test fails the build BEFORE a deploy would
//  strand every existing pocket at an address nobody can re-derive.
//
//  The "wallet" here is a throwaway test key (sk = sha256 of a fixed label) —
//  never a real wallet. Golden values generated with ecash-lib 4.13.0.
// =============================================================================

const WALLET_SK = sha256(new TextEncoder().encode('pow-pocket-golden-wallet'))
const WALLET_ADDR = 'ecash:qp5kphz2sq69fsaw6su5gn3fpsa5wp6j7yw8rpf3fd'

const GOLDEN_SENTENCE_SHA256 = 'b33713a2b726710a591392839c5546090b60d176611f2a2e4046c4c5eaf1f745'
const GOLDEN_SIG = 'IFJMjVp51zPfyPaZQR1ubJ9DFXSixEm4L9cjYJfh3U5ALcS53Akbn+Kaqyf6UJ/GoIlYy8oL5eMMTCuAeVntIy0='
const GOLDEN_POCKET_SK = '7c473a183b46d05ca20709eaa840f979ff33171f2094a4c9361a102ee127dce5'
const GOLDEN_POCKET_PK = '029984069acc9c8069bf74ef6329fe830f00c0c91f43f814ca3621ee9d041c2d48'
const GOLDEN_POCKET_ADDR = 'ecash:qpsxhjn66jxdms06nv89k5n5uply6vk3fvjhetxzla'

describe('pocket derivation — determinism canary', () => {
  it('the sentence is frozen (127 ASCII chars, pinned sha256)', () => {
    expect(POCKET_SENTENCE_V1.length).toBe(127)
    expect(/^[\x20-\x7e]+$/.test(POCKET_SENTENCE_V1)).toBe(true) // pure printable ASCII
    expect(toHex(sha256(new TextEncoder().encode(POCKET_SENTENCE_V1)))).toBe(
      GOLDEN_SENTENCE_SHA256,
    )
  })

  it('signMsg over the sentence reproduces the golden signature byte-for-byte', () => {
    expect(signMsg(POCKET_SENTENCE_V1, WALLET_SK)).toBe(GOLDEN_SIG)
  })

  it('signMsg is deterministic across repeated calls', () => {
    const sigs = new Set(Array.from({ length: 20 }, () => signMsg(POCKET_SENTENCE_V1, WALLET_SK)))
    expect(sigs.size).toBe(1)
  })

  it('the full paste → derive pipeline reproduces the golden pocket key + address', () => {
    const parsed = parsePastedSignature(GOLDEN_SIG)
    expect(parsed.ok).toBe(true)
    const pocket = derivePocketFromSignature(parsed.sigBytes)
    expect(pocket.skHex).toBe(GOLDEN_POCKET_SK)
    expect(pocket.pkHex).toBe(GOLDEN_POCKET_PK)
    expect(pocket.address).toBe(GOLDEN_POCKET_ADDR)
  })

  it('a different message yields a different signature (sanity)', () => {
    expect(signMsg(POCKET_SENTENCE_V1 + '!', WALLET_SK)).not.toBe(GOLDEN_SIG)
  })
})

describe('parsePastedSignature', () => {
  it('accepts the golden signature and surrounding whitespace', () => {
    const parsed = parsePastedSignature(`  ${GOLDEN_SIG}\n`)
    expect(parsed.ok).toBe(true)
    expect(parsed.sigBytes.length).toBe(65)
    expect(parsed.sigBase64).toBe(GOLDEN_SIG)
  })

  it('rejects empty, non-base64, and wrong-length input', () => {
    expect(parsePastedSignature('').ok).toBe(false)
    expect(parsePastedSignature('not a signature!!!').ok).toBe(false)
    // 64 bytes (an ordinary compact sig, no recovery byte) must be refused.
    const b64of64 = globalThis.btoa(String.fromCharCode(...new Uint8Array(64).fill(7)))
    expect(parsePastedSignature(b64of64).ok).toBe(false)
    // 66 bytes likewise.
    const b64of66 = globalThis.btoa(String.fromCharCode(...new Uint8Array(66).fill(7)))
    expect(parsePastedSignature(b64of66).ok).toBe(false)
  })
})

describe('verifySignatureAgainstPrimary', () => {
  it('accepts the right wallet, with or without the ecash: prefix', () => {
    expect(verifySignatureAgainstPrimary(GOLDEN_SIG, WALLET_ADDR)).toBe(true)
    expect(verifySignatureAgainstPrimary(GOLDEN_SIG, WALLET_ADDR.replace('ecash:', ''))).toBe(true)
  })

  it('rejects a different wallet and garbage input', () => {
    const other = 'ecash:qpsxhjn66jxdms06nv89k5n5uply6vk3fvjhetxzla' // the pocket, not the wallet
    expect(verifySignatureAgainstPrimary(GOLDEN_SIG, other)).toBe(false)
    expect(verifySignatureAgainstPrimary('AAAA', WALLET_ADDR)).toBe(false)
    expect(verifySignatureAgainstPrimary(GOLDEN_SIG, '')).toBe(false)
  })
})

describe('register proof', () => {
  it('binds account + pocket, normalizes the address, and verifies with the pocket key', () => {
    const proof = buildRegisterProofString('acct-123', `ECASH:${GOLDEN_POCKET_ADDR.slice(6).toUpperCase()}`)
    expect(proof).toBe(`powpocket-register|v1|account:acct-123|pocket:${GOLDEN_POCKET_ADDR.slice(6)}`)
    const sig = signRegisterProof(GOLDEN_POCKET_SK, proof)
    expect(sig).toHaveLength(88)
    // Possession: the proof verifies against the POCKET address (exactly what
    // the register route checks server-side)…
    expect(verifyMsg(proof, sig, GOLDEN_POCKET_ADDR)).toBe(true)
    // …and any bound field changing breaks it (account swap = different message).
    expect(verifyMsg(buildRegisterProofString('acct-999', GOLDEN_POCKET_ADDR), sig, GOLDEN_POCKET_ADDR)).toBe(false)
  })
})
