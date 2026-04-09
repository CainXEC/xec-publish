import { describe, it, expect, beforeEach } from 'vitest'
import { signCookieValue, verifyCookieValue } from '@/lib/cookieSigner'

describe('cookieSigner', () => {
  const postId = 'test-post-123'
  const txid = 'abc123txid456'

  beforeEach(() => {
    process.env.COOKIE_SECRET = 'test-secret-key'
  })

  it('signs a cookie value', () => {
    const signed = signCookieValue(postId, txid)
    expect(signed).toContain(txid)
    expect(signed).toContain('.')
  })

  it('verifies a valid signed cookie', () => {
    const signed = signCookieValue(postId, txid)
    const result = verifyCookieValue(postId, signed)
    expect(result.valid).toBe(true)
    expect(result.txid).toBe(txid)
  })

  it('rejects a tampered cookie', () => {
    const result = verifyCookieValue(postId, 'tampered.fakesignature')
    expect(result.valid).toBe(false)
  })

  it('rejects a plain true cookie', () => {
    const result = verifyCookieValue(postId, 'true')
    expect(result.valid).toBe(false)
  })

  it('rejects cookie signed for different postId', () => {
    const signed = signCookieValue('different-post', txid)
    const result = verifyCookieValue(postId, signed)
    expect(result.valid).toBe(false)
  })
})
