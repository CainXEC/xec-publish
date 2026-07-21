import { describe, it, expect } from 'vitest'
import { pickTopReply } from '@/lib/getFeed'

// The conversation teaser hung under a post in For You. Which reply gets the
// slot is a product decision, not an implementation detail: money is the
// engagement signal here, and a post's author must not be able to manufacture
// the teaser on their own post. These pin both.

const AUTHOR = 'author-account'
const reply = (over = {}) => ({
  txid: 't',
  author_account_id: 'someone-else',
  amount_sats: 10000,
  created_at: '2026-07-01T00:00:00.000Z',
  ...over,
})

describe('pickTopReply', () => {
  it('picks the highest-paid reply', () => {
    const winner = pickTopReply(
      [
        reply({ txid: 'cheap', amount_sats: 10000 }),
        reply({ txid: 'rich', amount_sats: 90000 }),
        reply({ txid: 'mid', amount_sats: 50000 }),
      ],
      AUTHOR,
    )
    expect(winner.txid).toBe('rich')
  })

  it('never picks the post author replying to themselves', () => {
    const winner = pickTopReply(
      [
        reply({ txid: 'self', author_account_id: AUTHOR, amount_sats: 999999 }),
        reply({ txid: 'other', amount_sats: 100 }),
      ],
      AUTHOR,
    )
    expect(winner.txid).toBe('other')
  })

  it('returns null when only the author replied', () => {
    const winner = pickTopReply(
      [reply({ txid: 'self', author_account_id: AUTHOR, amount_sats: 999999 })],
      AUTHOR,
    )
    expect(winner).toBeNull()
  })

  it('breaks an equal-spend tie toward the newer reply', () => {
    const winner = pickTopReply(
      [
        reply({ txid: 'old', created_at: '2026-07-01T00:00:00.000Z' }),
        reply({ txid: 'new', created_at: '2026-07-09T00:00:00.000Z' }),
      ],
      AUTHOR,
    )
    expect(winner.txid).toBe('new')
  })

  it('handles no replies at all', () => {
    expect(pickTopReply(undefined, AUTHOR)).toBeNull()
    expect(pickTopReply([], AUTHOR)).toBeNull()
  })

  it('treats a missing amount as zero rather than losing the reply', () => {
    const winner = pickTopReply([reply({ txid: 'unpriced', amount_sats: null })], AUTHOR)
    expect(winner.txid).toBe('unpriced')
  })
})
