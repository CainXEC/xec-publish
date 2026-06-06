import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { splitPostBodyAtPaywall } from '@/lib/splitPostBodyAtPaywall'

const MARKER = '<div data-paywall-break="true"></div>'

describe('splitPostBodyAtPaywall', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('splits in the middle: non-empty public and locked, marker excluded from both', () => {
    const html = `<p>Public intro</p>${MARKER}<p>Locked section</p>`
    const result = splitPostBodyAtPaywall(html)

    expect(result.hasPaywall).toBe(true)
    expect(result.bodyPublic).toBe('<p>Public intro</p>')
    expect(result.bodyLocked).toBe('<p>Locked section</p>')
    expect(result.bodyPublic).not.toContain('data-paywall-break')
    expect(result.bodyLocked).not.toContain('data-paywall-break')
  })

  it('marker missing: full body is public, locked is null', () => {
    const html = '<p>Everything is free</p>'
    const result = splitPostBodyAtPaywall(html, { postId: 'post-1' })

    expect(result.hasPaywall).toBe(false)
    expect(result.bodyPublic).toBe(html)
    expect(result.bodyLocked).toBeNull()
    expect(console.warn).toHaveBeenCalledWith(
      '[paywall] no paywall marker in post post-1; treating entire body as public',
    )
  })

  it('marker at start: empty public, locked is remainder, warns', () => {
    const html = `${MARKER}<p>All locked</p>`
    const result = splitPostBodyAtPaywall(html, { postId: 'post-2' })

    expect(result.hasPaywall).toBe(true)
    expect(result.bodyPublic).toBe('')
    expect(result.bodyLocked).toBe('<p>All locked</p>')
    expect(console.warn).toHaveBeenCalledWith(
      '[paywall] paywall marker at start of post post-2; no public preview content',
    )
  })

  it('marker at end: public is full preview, locked is empty string', () => {
    const html = `<p>Preview only</p>${MARKER}`
    const result = splitPostBodyAtPaywall(html)

    expect(result.hasPaywall).toBe(true)
    expect(result.bodyPublic).toBe('<p>Preview only</p>')
    expect(result.bodyLocked).toBe('')
  })

  it('multiple markers: splits on the first occurrence only', () => {
    const html = `<p>First public</p>${MARKER}<p>Locked</p>${MARKER}<p>After second</p>`
    const result = splitPostBodyAtPaywall(html)

    expect(result.bodyPublic).toBe('<p>First public</p>')
    expect(result.bodyLocked).toBe(`<p>Locked</p>${MARKER}<p>After second</p>`)
  })

  it('accepts regex variant when attribute order differs', () => {
    const html = '<p>Intro</p><div class="x" data-paywall-break="true"></div><p>Rest</p>'
    const result = splitPostBodyAtPaywall(html)

    expect(result.hasPaywall).toBe(true)
    expect(result.bodyPublic).toBe('<p>Intro</p>')
    expect(result.bodyLocked).toBe('<p>Rest</p>')
  })
})
