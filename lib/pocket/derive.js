/**
 * The Pocket — key derivation ("the recovery trick").
 *
 * The pocket's private key is DERIVED, never generated: the user signs one
 * fixed sentence with their main wallet in Cashtab's Sign & Verify screen and
 * pastes the signature here. ecash-lib's signMsg is deterministic (RFC6979 —
 * no timestamp, no salt, no randomness), so the same wallet signing the same
 * sentence produces the same signature forever, on any device. That makes the
 * pocket unlosable: cache clear / new laptop → re-paste → same key, same
 * address, same funds. The derivation is a publishable spec — anyone with
 * their wallet seed can reconstruct the key offline (signMsg + sha256), so
 * funds never depend on this site existing.
 *
 * THE SIGNATURE IS THE KEY. It must never leave the browser: the server only
 * ever sees the derived PUBLIC key (and a proof-of-possession signature made
 * BY the pocket key). Anyone who obtains the sentence signature owns the
 * pocket — which is why the UI tells users to only ever paste it here, and
 * why the pocket holds pocket change, not savings.
 *
 * tests/unit/pocketDerivation.test.js pins golden vectors over this whole
 * pipeline; if ecash-lib's signing or this sentence ever changes, CI fails
 * before any user's pocket silently re-derives to a different address.
 */

import { Ecc, signMsg, verifyMsg, sha256, shaRmd160, toHex, fromHex } from 'ecash-lib'
import { encodeCashAddress } from 'ecashaddrjs'

/**
 * FROZEN. Changing one byte re-derives every user's pocket to a new empty
 * address. Pure ASCII (127 chars) — safely under Cashtab's 200-char sign
 * limit and immune to unicode normalization drift across platforms.
 */
export const POCKET_SENTENCE_V1 =
  'proofofwriting.com Pocket v1: I authorize this signature to create my Pocket spending key. Only paste it on proofofwriting.com.'

/** Cashtab's Sign & Verify screen. */
export const CASHTAB_SIGN_URL = 'https://cashtab.com/#/signverifymsg'

/** Fragment param Cashtab returns the signature in (see
 *  docs/cashtab-signverifymsg-callback.md). */
export const POCKET_CALLBACK_SIG_PARAM = 'sig'

/**
 * Build the Cashtab Sign & Verify deep link with the pocket sentence prefilled
 * and (optionally) a callback to bounce the signature back to. Cashtab that
 * predates the callback patch ignores both params and just shows a blank sign
 * screen — so callers MUST keep a manual-paste fallback.
 * @param {string} [callbackUrl] https URL Cashtab redirects to as
 *   `<callbackUrl>#sig=<encoded base64>` after the user signs + confirms.
 */
export function buildCashtabSignUrl(callbackUrl) {
  const params = new URLSearchParams({ msg: POCKET_SENTENCE_V1 })
  if (callbackUrl) params.set('callback', callbackUrl)
  return `${CASHTAB_SIGN_URL}?${params.toString()}`
}

/**
 * Read the signature Cashtab handed back in the return fragment
 * (`#sig=<encoded base64>`). Returns the base64 string, or null if this hash
 * carries no signature. The caller should wipe the hash immediately after —
 * the signature IS the pocket key and must not linger in a shareable URL.
 * @param {string} hash  window.location.hash, with or without the leading '#'
 * @returns {string | null}
 */
export function parseSignatureFromCallbackHash(hash) {
  if (typeof hash !== 'string') return null
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) return null
  let value
  try {
    value = new URLSearchParams(raw).get(POCKET_CALLBACK_SIG_PARAM)
  } catch {
    return null
  }
  if (!value) return null
  // URLSearchParams maps a literal '+' to a space. The callback spec requires
  // Cashtab to percent-encode the signature (so '+' arrives as %2B and
  // round-trips), but restore '+' from any stray spaces defensively — base64
  // never contains spaces, so this only ever repairs an under-encoded value.
  return value.replace(/ /g, '+').trim() || null
}

/**
 * Validate + decode a pasted signature. Cashtab shows signMsg output: base64
 * of a 65-byte recoverable ECDSA signature — 88 characters.
 * @param {string} input
 * @returns {{ ok: true, sigBase64: string, sigBytes: Uint8Array } | { ok: false, error: string }}
 */
export function parsePastedSignature(input) {
  const trimmed = typeof input === 'string' ? input.trim().replace(/\s+/g, '') : ''
  if (!trimmed) return { ok: false, error: 'Paste the signature from Cashtab.' }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    return { ok: false, error: 'That doesn’t look like a Cashtab signature (not base64).' }
  }
  let bytes
  try {
    const bin = globalThis.atob(trimmed)
    bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  } catch {
    return { ok: false, error: 'That doesn’t look like a Cashtab signature (not base64).' }
  }
  if (bytes.length !== 65) {
    return {
      ok: false,
      error: 'A Cashtab message signature is 88 characters — make sure you copied the whole thing.',
    }
  }
  return { ok: true, sigBase64: trimmed, sigBytes: bytes }
}

/**
 * True when the pasted signature was made by `primaryAddress`'s key over the
 * pocket sentence — catches "signed with the wrong wallet" client-side,
 * BEFORE deriving a key that would never match the account.
 * @param {string} sigBase64
 * @param {string} primaryAddress  with or without the ecash: prefix
 */
export function verifySignatureAgainstPrimary(sigBase64, primaryAddress) {
  const bare = String(primaryAddress ?? '').trim().replace(/^ecash:/i, '')
  if (!bare || !sigBase64) return false
  try {
    return verifyMsg(POCKET_SENTENCE_V1, sigBase64, `ecash:${bare}`) === true
  } catch {
    return false
  }
}

/**
 * signature bytes → pocket key. sk = sha256(sig); in the astronomically
 * unlikely case that lands off the curve, re-hash until valid (deterministic,
 * so every device converges on the same key).
 * @param {Uint8Array} sigBytes
 * @returns {{ skHex: string, pkHex: string, address: string }}
 */
export function derivePocketFromSignature(sigBytes) {
  const ecc = new Ecc()
  let sk = sha256(sigBytes)
  while (!ecc.isValidSeckey(sk)) sk = sha256(sk)
  const pk = ecc.derivePubkey(sk)
  const address = encodeCashAddress('ecash', 'p2pkh', toHex(shaRmd160(pk)))
  return { skHex: toHex(sk), pkHex: toHex(pk), address }
}

/**
 * The string the POCKET key signs to prove possession at registration. Binds
 * the account AND the pocket address, so a captured proof can only ever
 * re-assert the same (account, pocket) pair — an idempotent no-op. No nonce
 * needed: the register route additionally requires the account's own
 * challenge-scope session.
 * @param {string} accountId
 * @param {string} pocketAddress  with or without the ecash: prefix
 */
export function buildRegisterProofString(accountId, pocketAddress) {
  const bare = String(pocketAddress ?? '').trim().toLowerCase().replace(/^ecash:/, '')
  return `powpocket-register|v1|account:${accountId}|pocket:${bare}`
}

/**
 * Sign the register proof with the pocket key (proof of possession — the
 * server must never link an address the caller can't actually spend from).
 * @param {string} skHex   pocket secret key (64 hex)
 * @param {string} proofString  from buildRegisterProofString
 * @returns {string} 88-char base64 signature
 */
export function signRegisterProof(skHex, proofString) {
  return signMsg(proofString, fromHex(skHex))
}
