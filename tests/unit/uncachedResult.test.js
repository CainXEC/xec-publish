import { describe, it, expect, vi, beforeEach } from 'vitest'

// -----------------------------------------------------------------------------
// "The Math of POW" showed 0 unlocks / 0 comments for a minute (really 11 / 12):
// a count RPC failed, the error was mapped to 0, and that 0 was cached for 60s
// for every reader. A failed post lookup was worse — cached as "not found", so
// the article 404'd for the minute. A failed lookup is now served but never
// cached (lib/uncachedResult.js); the counts come back null (unknown), not 0.
// -----------------------------------------------------------------------------

// A stand-in for Next's Data Cache with the one behavior that matters here: it
// stores what the function RETURNS, and a throw stores nothing.
const { store, unstable_cache, db } = vi.hoisted(() => {
  const store = new Map()
  const unstable_cache = (fn, keyParts) => async () => {
    const key = keyParts.join('|')
    if (store.has(key)) return store.get(key)
    const value = await fn()
    store.set(key, value)
    return value
  }
  const db = { postError: null, rpcError: null }
  return { store, unstable_cache, db }
})
vi.mock('next/cache', () => ({ unstable_cache }))
vi.mock('react', async (orig) => ({ ...(await orig()), cache: (fn) => fn }))

const POST = {
  id: 'post-1',
  author_id: 'author-1',
  title: 'The Math of POW',
  body: '<p>free part</p>',
  slug: 'math-of-pow',
  authors: { username: 'cain', xec_address: 'ecash:q', is_ai: false },
}

vi.mock('@/lib/db', () => ({
  adminDb: () => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () =>
        db.postError ? { data: null, error: db.postError } : { data: POST, error: null },
    }
    return {
      from: () => query,
      rpc: async (name) => {
        if (db.rpcError) return { data: null, error: db.rpcError }
        if (name === 'get_unlock_counts') return { data: [{ post_id: 'post-1', count: 11 }], error: null }
        if (name === 'get_comment_counts') return { data: [{ post_id: 'post-1', count: 12 }], error: null }
        return { data: [], error: null }
      },
    }
  },
}))
vi.mock('@/lib/authorDisplayHandles', () => ({ displayHandlesByAuthorId: async () => ({}) }))
vi.mock('@/lib/accountAuthorLink', () => ({ accountIdForAuthorId: async () => 'acct-1' }))

import { getPublishedPostBySlug } from '@/lib/getPublishedPostBySlug'
import { getCachedPublicReaderPayload } from '@/lib/readerPayload'
import { UncachedResult, serveUncached } from '@/lib/uncachedResult'

beforeEach(() => {
  store.clear()
  db.postError = null
  db.rpcError = null
})

describe('serveUncached', () => {
  it('unwraps an UncachedResult and rethrows anything else', async () => {
    await expect(serveUncached(Promise.reject(new UncachedResult({ a: 1 })))).resolves.toEqual({ a: 1 })
    await expect(serveUncached(Promise.reject(new Error('boom')))).rejects.toThrow('boom')
  })
})

describe('getPublishedPostBySlug', () => {
  it('caches a healthy lookup', async () => {
    const data = await getPublishedPostBySlug('math-of-pow')
    expect(data.unlockCount).toBe(11)
    expect(data.commentCount).toBe(12)
    expect(store.size).toBe(1)
  })

  it('serves failed counts as null (not 0) and caches nothing, so the next request retries', async () => {
    db.rpcError = { message: 'statement timeout' }
    const failed = await getPublishedPostBySlug('math-of-pow')
    expect(failed.post.title).toBe('The Math of POW')
    expect(failed.unlockCount).toBeNull()
    expect(failed.commentCount).toBeNull()
    expect(store.size).toBe(0)

    db.rpcError = null
    const next = await getPublishedPostBySlug('math-of-pow')
    expect(next.unlockCount).toBe(11)
    expect(next.commentCount).toBe(12)
  })

  it('does not cache a failed post lookup as "not found"', async () => {
    db.postError = { message: 'connection reset' }
    expect(await getPublishedPostBySlug('math-of-pow')).toBeNull()
    expect(store.size).toBe(0)

    db.postError = null
    expect((await getPublishedPostBySlug('math-of-pow')).post.id).toBe('post-1')
  })
})

describe('getCachedPublicReaderPayload (the in-pane reader)', () => {
  it('passes unknown counts through as null and caches nothing derived from them', async () => {
    db.rpcError = { message: 'statement timeout' }
    const failed = await getCachedPublicReaderPayload('math-of-pow')
    expect(failed.unlockCount).toBeNull()
    expect(failed.commentCount).toBeNull()
    expect(store.size).toBe(0)

    db.rpcError = null
    const next = await getCachedPublicReaderPayload('math-of-pow')
    expect(next.unlockCount).toBe(11)
    expect([...store.keys()].some((k) => k.startsWith('reader-public'))).toBe(true)
  })

  it('does not cache a failed post lookup as "not found"', async () => {
    db.postError = { message: 'connection reset' }
    expect(await getCachedPublicReaderPayload('math-of-pow')).toBeNull()
    expect(store.size).toBe(0)
  })
})
