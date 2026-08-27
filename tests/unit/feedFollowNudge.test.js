import { describe, it, expect } from 'vitest'
import { applyFollowNudge } from '@/lib/feedFollowNudge'

// A window of posts by the given authors, in engagement order (index 0 = top).
const win = (authors) => authors.map((a, i) => ({ txid: `t${i}`, author_account_id: a }))
const authors = (posts) => posts.map((p) => p.author_account_id)

// These expectations assume FOLLOW_NUDGE_SLOTS = 5.
describe('applyFollowNudge', () => {
  it('returns the input untouched when nothing is followed', () => {
    const posts = win(['a', 'b', 'c'])
    expect(applyFollowNudge(posts, new Set())).toBe(posts)
    expect(applyFollowNudge(posts, null)).toBe(posts)
  })

  it('lifts a followed author up by the bonus — bounded, engagement order otherwise intact', () => {
    const posts = win(['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'])
    // Follow a7 (index 7): key 7-5=2 → slots in right after the post already at
    // key 2 (a2), i.e. position 3. Everyone else keeps their order.
    const out = authors(applyFollowNudge(posts, new Set(['a7'])))
    expect(out).toEqual(['a0', 'a1', 'a2', 'a7', 'a3', 'a4', 'a5', 'a6'])
    expect(out.indexOf('a7')).toBeLessThan(7) // it rose
  })

  it('lifts multiple followed authors, preserving their relative order', () => {
    const posts = win(['a0', 'a1', 'f1', 'a3', 'a4', 'f2', 'a6', 'a7'])
    const out = authors(applyFollowNudge(posts, new Set(['f1', 'f2'])))
    // f1 (idx2 → key -3) leads; f2 (idx5 → key 0); f1 stays ahead of f2.
    expect(out[0]).toBe('f1')
    expect(out.indexOf('f1')).toBeLessThan(out.indexOf('f2'))
  })

  it('keeps a followed author’s own posts in their original relative order', () => {
    const posts = win(['x', 'y', 'f', 'z', 'f', 'w']) // two posts by f (idx 2, 4)
    const out = applyFollowNudge(posts, new Set(['f']))
    const fPositions = out
      .map((p, i) => [p.txid, i])
      .filter(([txid]) => txid === 't2' || txid === 't4')
      .map(([, i]) => i)
    // t2 (the earlier-ranked f post) stays ahead of t4.
    expect(fPositions[0]).toBeLessThan(fPositions[1])
  })

  it('does not mutate the input array', () => {
    const posts = win(['a0', 'a1', 'a2'])
    const before = JSON.stringify(posts)
    applyFollowNudge(posts, new Set(['a2']))
    expect(JSON.stringify(posts)).toBe(before)
  })

  it('never reorders when the followed set matches no author on the page', () => {
    const posts = win(['a', 'b', 'c'])
    expect(authors(applyFollowNudge(posts, new Set(['someone-else'])))).toEqual(['a', 'b', 'c'])
  })
})
