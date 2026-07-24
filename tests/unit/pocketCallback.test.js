import { describe, it, expect } from 'vitest'
import {
  POCKET_SENTENCE_V1,
  buildCashtabSignUrl,
  parseSignatureFromCallbackHash,
} from '@/lib/pocket/derive'

// =============================================================================
//  The Cashtab sign-callback URL contract (docs/cashtab-signverifymsg-callback.md).
//  POW builds the outbound `?msg=&callback=` deep link and reads the signature
//  back out of the return `#sig=` fragment. The base64/`+`/URLSearchParams
//  interaction is exactly the kind of thing that silently corrupts a key, so it
//  gets a golden round-trip test.
// =============================================================================

// A real 88-char signMsg output — contains '+', '/', and a trailing '=', the
// three base64 chars that trip up naive URL handling.
const SIG = 'IFJMjVp51zPfyPaZQR1ubJ9DFXSixEm4L9cjYJfh3U5ALcS53Akbn+Kaqyf6UJ/GoIlYy8oL5eMMTCuAeVntIy0='

describe('buildCashtabSignUrl', () => {
  it('prefills the frozen sentence and the callback', () => {
    const url = buildCashtabSignUrl('https://proofofwriting.com/pocket')
    expect(url.startsWith('https://cashtab.com/#/signverifymsg?')).toBe(true)
    const qs = new URLSearchParams(url.split('?')[1])
    expect(qs.get('msg')).toBe(POCKET_SENTENCE_V1)
    expect(qs.get('callback')).toBe('https://proofofwriting.com/pocket')
  })

  it('omits callback when none is given (prefill-only degrade)', () => {
    const qs = new URLSearchParams(buildCashtabSignUrl().split('?')[1])
    expect(qs.get('msg')).toBe(POCKET_SENTENCE_V1)
    expect(qs.get('callback')).toBe(null)
  })
})

describe('parseSignatureFromCallbackHash', () => {
  it('round-trips a percent-encoded signature (the spec contract)', () => {
    expect(parseSignatureFromCallbackHash(`#sig=${encodeURIComponent(SIG)}`)).toBe(SIG)
  })

  it('accepts a hash with no leading #', () => {
    expect(parseSignatureFromCallbackHash(`sig=${encodeURIComponent(SIG)}`)).toBe(SIG)
  })

  it('repairs a signature whose + arrived as a space (under-encoded fallback)', () => {
    // A build that forgot to percent-encode: URLSearchParams turns '+' → ' '.
    const underEncoded = `#sig=${SIG.replace(/\+/g, ' ')}`
    expect(parseSignatureFromCallbackHash(underEncoded)).toBe(SIG)
  })

  it('returns null when no signature fragment is present', () => {
    expect(parseSignatureFromCallbackHash('')).toBe(null)
    expect(parseSignatureFromCallbackHash('#')).toBe(null)
    expect(parseSignatureFromCallbackHash('#foo=bar')).toBe(null)
    expect(parseSignatureFromCallbackHash('#/pocket')).toBe(null)
    expect(parseSignatureFromCallbackHash(null)).toBe(null)
  })
})
