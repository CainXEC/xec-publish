import { describe, it, expect } from 'vitest'
import { notifText, targetHref, groupNotifications } from '@/lib/notifFormat'

function row(overrides) {
  return {
    id: Math.random().toString(36).slice(2),
    type: 'like',
    post_txid: 'p1',
    read: false,
    created_at: '2026-08-01T00:00:00Z',
    actor_identity: '@someone',
    amount_sats: null,
    ...overrides,
  }
}

describe('groupNotifications', () => {
  it('merges adjacent like/repost rows sharing the same post + read state', () => {
    const groups = groupNotifications([
      row({ type: 'like', post_txid: 'p1' }),
      row({ type: 'like', post_txid: 'p1' }),
      row({ type: 'like', post_txid: 'p1' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].items).toHaveLength(3)
  })

  it('does NOT merge across a different target post', () => {
    const groups = groupNotifications([
      row({ type: 'like', post_txid: 'p1' }),
      row({ type: 'like', post_txid: 'p2' }),
    ])
    expect(groups).toHaveLength(2)
  })

  it('does NOT merge across a read-state boundary', () => {
    const groups = groupNotifications([
      row({ type: 'like', post_txid: 'p1', read: false }),
      row({ type: 'like', post_txid: 'p1', read: true }),
    ])
    expect(groups).toHaveLength(2)
  })

  it('does NOT merge non-adjacent rows, even with a matching row between them', () => {
    const groups = groupNotifications([
      row({ type: 'like', post_txid: 'p1' }),
      row({ type: 'repost', post_txid: 'p1' }),
      row({ type: 'like', post_txid: 'p1' }),
    ])
    expect(groups).toHaveLength(3)
  })

  it('follow rows group with no post_txid at all', () => {
    const groups = groupNotifications([
      row({ type: 'follow', post_txid: null }),
      row({ type: 'follow', post_txid: null }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].items).toHaveLength(2)
  })

  it('never groups reply/quote/comment/offer — each keeps its own payload', () => {
    const groups = groupNotifications([
      row({ type: 'reply', post_txid: 'p1' }),
      row({ type: 'reply', post_txid: 'p1' }),
      row({ type: 'comment', post_txid: 'a1' }),
      row({ type: 'comment', post_txid: 'a1' }),
    ])
    expect(groups).toHaveLength(4)
  })

  it('an empty or missing list yields no groups', () => {
    expect(groupNotifications([])).toEqual([])
    expect(groupNotifications(undefined)).toEqual([])
  })
})

describe('notifText', () => {
  it('distinguishes a top-level comment from a reply-to-comment', () => {
    expect(notifText(row({ type: 'comment', isCommentReply: false, articleTitle: 'My Piece' }))).toBe(
      'commented on “My Piece”',
    )
    expect(notifText(row({ type: 'comment', isCommentReply: true, articleTitle: 'My Piece' }))).toBe(
      'replied to your comment',
    )
  })

  it('falls back to the generic verb when the article title never resolved', () => {
    expect(notifText(row({ type: 'unlock', articleTitle: null }))).toBe('unlocked your article')
    expect(notifText(row({ type: 'unlock', articleTitle: 'Piece' }))).toBe('unlocked “Piece”')
  })

  it('an offer names the handle and amount when known', () => {
    expect(notifText(row({ type: 'offer', handle: 'satoshi', offerAmountXec: 25000 }))).toBe(
      'offered 25,000 XEC for @satoshi',
    )
    expect(notifText(row({ type: 'offer', handle: null, offerAmountXec: null }))).toBe(
      'made an offer on your handle',
    )
  })
})

describe('targetHref', () => {
  it('a follow opens the follower profile, stripping any leading @', () => {
    expect(targetHref(row({ type: 'follow', actor_identity: '@alice' }))).toBe('/@alice')
  })

  it('a comment/unlock opens the resolved article link', () => {
    expect(targetHref(row({ type: 'comment', articleHref: '/posts/my-piece' }))).toBe('/posts/my-piece')
    expect(targetHref(row({ type: 'unlock', articleHref: null }))).toBe('#')
  })

  it('reply/quote/like/repost open the feed thread by post_txid', () => {
    expect(targetHref(row({ type: 'reply', post_txid: 'abc' }))).toBe('/feed/abc')
    expect(targetHref(row({ type: 'reply', post_txid: null }))).toBe('#')
  })
})
