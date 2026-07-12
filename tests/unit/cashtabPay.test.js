// @vitest-environment jsdom
// Verifies the desktop Cashtab-extension routing: when window.bitcoinAbc marks
// the extension present, payments go through the extension (in-page popup, no
// tab); otherwise they open a Cashtab web tab. NEVER both. The BIP21 handed to
// the extension must be byte-identical to the deep-link one, so the
// op_return_raw envelope (auth nonce / content hash / feed action) survives.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock the extension SDK: sendBip21 is a controllable spy; the two error classes
// must be real (the helper branches on `instanceof`).
const { sendBip21Mock, DeniedError, TimeoutError } = vi.hoisted(() => {
  class DeniedError extends Error {}
  class TimeoutError extends Error {}
  return { sendBip21Mock: vi.fn(), DeniedError, TimeoutError }
})

vi.mock('cashtab-connect', () => ({
  CashtabConnect: class {
    sendBip21(...args) {
      return sendBip21Mock(...args)
    }
  },
  CashtabTransactionDeniedError: DeniedError,
  CashtabTimeoutError: TimeoutError,
}))

import {
  isCashtabExtensionAvailable,
  payWithCashtab,
  beginCashtabPayment,
  completeCashtabPayment,
  abortCashtabPayment,
} from '@/lib/ecash/cashtabPay'

// A BIP21 that carries op_return_raw, exactly like the real pay flows build.
const BIP21 =
  'ecash:qauthor?amount=940&addr=qplatform&amount=60&op_return_raw=5052' +
  '4f570007'
const CASHTAB_URL = `https://cashtab.com/#/send?bip21=${BIP21}`

let openSpy

function fakeWindow() {
  return { opener: {}, location: { href: '' }, close: vi.fn() }
}

beforeEach(() => {
  sendBip21Mock.mockReset()
  delete window.bitcoinAbc
  openSpy = vi.fn(() => fakeWindow())
  window.open = openSpy
})

afterEach(() => {
  delete window.bitcoinAbc
})

describe('isCashtabExtensionAvailable', () => {
  it('is false unless the extension marked itself present', () => {
    expect(isCashtabExtensionAvailable()).toBe(false)
    window.bitcoinAbc = 'somethingElse'
    expect(isCashtabExtensionAvailable()).toBe(false)
    window.bitcoinAbc = 'cashtab'
    expect(isCashtabExtensionAvailable()).toBe(true)
  })
})

describe('payWithCashtab — synchronous flows', () => {
  it('extension present: routes through the extension with the FULL bip21, opens NO tab', async () => {
    window.bitcoinAbc = 'cashtab'
    sendBip21Mock.mockResolvedValue({ approved: true, txid: 'abc123' })

    const res = await payWithCashtab({ bip21: BIP21, cashtabUrl: CASHTAB_URL })

    expect(sendBip21Mock).toHaveBeenCalledTimes(1)
    expect(sendBip21Mock).toHaveBeenCalledWith(BIP21) // op_return_raw preserved
    expect(openSpy).not.toHaveBeenCalled() // never both
    expect(res).toEqual({ ok: true, via: 'extension', txid: 'abc123' })
  })

  it('extension absent: opens the Cashtab web tab, never touches the extension', async () => {
    const res = await payWithCashtab({ bip21: BIP21, cashtabUrl: CASHTAB_URL })

    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(openSpy).toHaveBeenCalledWith(CASHTAB_URL, '_blank', 'noopener,noreferrer')
    expect(sendBip21Mock).not.toHaveBeenCalled() // never both
    expect(res).toEqual({ ok: true, via: 'tab' })
  })

  it('extension rejection (user hit reject) reports denied and opens no tab', async () => {
    window.bitcoinAbc = 'cashtab'
    sendBip21Mock.mockRejectedValue(new DeniedError('rejected'))

    const res = await payWithCashtab({ bip21: BIP21, cashtabUrl: CASHTAB_URL })

    expect(res).toEqual({ ok: false, via: 'extension', reason: 'denied' })
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('extension timeout maps to timeout (payment may still land, caller keeps waiting)', async () => {
    window.bitcoinAbc = 'cashtab'
    sendBip21Mock.mockRejectedValue(new TimeoutError())

    const res = await payWithCashtab({ bip21: BIP21, cashtabUrl: CASHTAB_URL })

    expect(res).toEqual({ ok: false, via: 'extension', reason: 'timeout' })
  })
})

describe('begin/complete — async-prepare flows', () => {
  it('extension present: begin opens no placeholder tab; complete uses the extension', async () => {
    window.bitcoinAbc = 'cashtab'
    sendBip21Mock.mockResolvedValue({ approved: true, txid: 'zzz' })

    const gesture = beginCashtabPayment()
    expect(gesture.hasExtension).toBe(true)
    expect(gesture.placeholderWindow).toBeNull()
    expect(openSpy).not.toHaveBeenCalled() // no about:blank when extension will handle it

    const res = await completeCashtabPayment(gesture, { bip21: BIP21, cashtabUrl: CASHTAB_URL })
    expect(sendBip21Mock).toHaveBeenCalledWith(BIP21)
    expect(res).toEqual({ ok: true, via: 'extension', txid: 'zzz' })
  })

  it('extension absent: begin pre-opens about:blank (opener severed); complete points it at Cashtab', async () => {
    const placeholder = fakeWindow()
    openSpy.mockReturnValueOnce(placeholder)

    const gesture = beginCashtabPayment()
    expect(gesture.hasExtension).toBe(false)
    expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank')
    expect(gesture.placeholderWindow).toBe(placeholder)
    expect(placeholder.opener).toBeNull() // popup-blocker workaround, opener cut

    const res = await completeCashtabPayment(gesture, { bip21: BIP21, cashtabUrl: CASHTAB_URL })
    expect(placeholder.location.href).toBe(CASHTAB_URL)
    expect(sendBip21Mock).not.toHaveBeenCalled() // never both
    expect(res).toEqual({ ok: true, via: 'tab' })
  })

  it('abort closes the placeholder tab (no-op on the extension path)', () => {
    const placeholder = fakeWindow()
    openSpy.mockReturnValueOnce(placeholder)
    const gesture = beginCashtabPayment()

    abortCashtabPayment(gesture)
    expect(placeholder.close).toHaveBeenCalledTimes(1)

    // Extension gesture has no window to close — must not throw.
    window.bitcoinAbc = 'cashtab'
    const extGesture = beginCashtabPayment()
    expect(() => abortCashtabPayment(extGesture)).not.toThrow()
  })
})
