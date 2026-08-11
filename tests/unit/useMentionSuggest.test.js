// @vitest-environment jsdom
// Regression test for the stale-dropdown bug: deleting an in-progress
// "@letter" mention and starting a new one must not show the OLD letter's
// suggestions while the NEW query's fetch is still in flight.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMentionSuggest } from '@/components/feed/useMentionSuggest'

function makeTextarea(value) {
  const el = document.createElement('textarea')
  el.value = value
  document.body.appendChild(el)
  const caret = value.length
  el.selectionStart = caret
  el.selectionEnd = caret
  return el
}

describe('useMentionSuggest', () => {
  let pending

  beforeEach(() => {
    vi.useFakeTimers()
    pending = new Map() // query -> resolve fn
    global.fetch = vi.fn((url) => {
      const q = decodeURIComponent(String(url).split('q=')[1])
      return new Promise((resolve) => {
        pending.set(q, () =>
          resolve({ json: async () => ({ items: [{ handle: `${q}-match`, color: '#fff' }] }) }),
        )
      })
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not show the previous letter\'s results after switching to a new letter', async () => {
    const el = makeTextarea('@a')
    const ref = { current: el }
    const { result } = renderHook(() => useMentionSuggest(ref))

    // Type "@a" -> query "a" fetch scheduled + resolved.
    act(() => result.current.recompute())
    await act(async () => {
      vi.advanceTimersByTime(150)
    })
    act(() => pending.get('a')())
    await act(async () => {})
    expect(result.current.items).toEqual([{ handle: 'a-match', color: '#fff' }])

    // Delete back past "@" entirely (mention context closes).
    el.value = ''
    el.selectionStart = el.selectionEnd = 0
    act(() => result.current.recompute())
    // Stale "a" items must be cleared immediately, not just on next fetch.
    expect(result.current.items).toEqual([])

    // Start a brand-new mention with a different letter.
    el.value = '@b'
    el.selectionStart = el.selectionEnd = 2
    act(() => result.current.recompute())

    // While "b"'s fetch is still in flight (debounce not yet elapsed, or
    // network not yet resolved), the dropdown must not show "a"'s results.
    expect(result.current.items).toEqual([])
    expect(result.current.open).toBe(false)

    await act(async () => {
      vi.advanceTimersByTime(150)
    })
    act(() => pending.get('b')())
    await act(async () => {})

    expect(result.current.items).toEqual([{ handle: 'b-match', color: '#fff' }])
    expect(result.current.open).toBe(true)
  })

  it('does not flash the old letter when swapping letters WITHOUT passing through empty', async () => {
    // The path the first fix missed: "@a" -> "@b" directly (select-and-replace,
    // or backspace+type in one go). Query jumps "a" -> "b" without ever being
    // empty, so the stale-clear-on-empty guard never fires — only prefix-matching
    // the visible list against the live query hides "a-match" here.
    const el = makeTextarea('@a')
    const ref = { current: el }
    const { result } = renderHook(() => useMentionSuggest(ref))

    act(() => result.current.recompute())
    await act(async () => {
      vi.advanceTimersByTime(150)
    })
    act(() => pending.get('a')())
    await act(async () => {})
    expect(result.current.items).toEqual([{ handle: 'a-match', color: '#fff' }])

    // Swap the letter in place: "@a" -> "@b", query goes straight from "a" to "b".
    el.value = '@b'
    el.selectionStart = el.selectionEnd = 2
    act(() => result.current.recompute())

    // "b"'s fetch hasn't resolved yet — the still-held "a-match" must NOT show,
    // because it doesn't start with "b".
    expect(result.current.items).toEqual([])
    expect(result.current.open).toBe(false)

    await act(async () => {
      vi.advanceTimersByTime(150)
    })
    act(() => pending.get('b')())
    await act(async () => {})
    expect(result.current.items).toEqual([{ handle: 'b-match', color: '#fff' }])
  })

  it('keeps matching results visible while refining a prefix (no flicker)', async () => {
    // Typing more letters of the SAME stem should keep showing the still-valid
    // subset during the next fetch, not blank out. "@ca" -> "@cat": the cached
    // "cat-…" style match still starts with "cat", so it stays visible.
    global.fetch = vi.fn((url) => {
      const q = decodeURIComponent(String(url).split('q=')[1])
      return new Promise((resolve) => {
        // Every query resolves with a handle under the "cat" stem so refinement
        // keeps a match. (Real prefix search would; this mirrors it.)
        pending.set(q, () => resolve({ json: async () => ({ items: [{ handle: 'cathy', color: '#fff' }] }) }))
      })
    })

    const el = makeTextarea('@ca')
    const ref = { current: el }
    const { result } = renderHook(() => useMentionSuggest(ref))

    act(() => result.current.recompute())
    await act(async () => {
      vi.advanceTimersByTime(150)
    })
    act(() => pending.get('ca')())
    await act(async () => {})
    expect(result.current.items).toEqual([{ handle: 'cathy', color: '#fff' }])

    // Refine to "cat" — "cathy" still matches the new prefix, so it stays shown
    // immediately (no blank flash) even before "cat"'s fetch resolves.
    el.value = '@cat'
    el.selectionStart = el.selectionEnd = 4
    act(() => result.current.recompute())
    expect(result.current.items).toEqual([{ handle: 'cathy', color: '#fff' }])
    expect(result.current.open).toBe(true)
  })
})
