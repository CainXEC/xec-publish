import { describe, it, expect } from 'vitest'
import { generateSlug, isUrlSafeSlug } from '@/lib/generateSlug'

describe('generateSlug', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(generateSlug('Hello World')).toBe('hello-world')
  })

  it('collapses runs of whitespace and hyphens', () => {
    expect(generateSlug('Foo   Bar')).toBe('foo-bar')
  })

  it('drops punctuation and non-ASCII characters', () => {
    expect(generateSlug('Foo, Bar!')).toBe('foo-bar')
    expect(generateSlug('Héllo Wörld')).toBe('hllo-wrld')
  })

  it('falls back to a timestamped slug when nothing usable remains', () => {
    expect(generateSlug('!!!')).toMatch(/^post-\d+$/)
    expect(generateSlug('你好')).toMatch(/^post-\d+$/)
  })
})

describe('isUrlSafeSlug', () => {
  it('accepts lowercase alphanumerics with single hyphens between segments', () => {
    expect(isUrlSafeSlug('hello-world')).toBe(true)
    expect(isUrlSafeSlug('a1-b2-c3')).toBe(true)
    expect(isUrlSafeSlug('post')).toBe(true)
  })

  it('rejects empties, uppercase, spaces, and edge/double hyphens', () => {
    expect(isUrlSafeSlug('')).toBe(false)
    expect(isUrlSafeSlug('   ')).toBe(false)
    expect(isUrlSafeSlug('Hello')).toBe(false)
    expect(isUrlSafeSlug('hello world')).toBe(false)
    expect(isUrlSafeSlug('-hello')).toBe(false)
    expect(isUrlSafeSlug('hello-')).toBe(false)
    expect(isUrlSafeSlug('hello--world')).toBe(false)
  })
})
