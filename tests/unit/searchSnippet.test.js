import { describe, expect, it } from 'vitest'
import { parseSnippetSegments, SNIPPET_START, SNIPPET_END } from '@/lib/searchSnippet'
import { articleRouteFor, profileRouteFor, groupSearchRows } from '@/lib/searchResults'

describe('parseSnippetSegments', () => {
  it('passes plain text through as one unmarked segment', () => {
    expect(parseSnippetSegments('no highlights here')).toEqual([
      { text: 'no highlights here', mark: false },
    ])
  })

  it('splits marked spans out of the surrounding text', () => {
    expect(parseSnippetSegments(`the ⟦aurifex⟧ canticle`)).toEqual([
      { text: 'the ', mark: false },
      { text: 'aurifex', mark: true },
      { text: ' canticle', mark: false },
    ])
  })

  it('handles multiple highlights and fragment delimiters', () => {
    const segments = parseSnippetSegments('⟦luminous⟧ rings … ⟦canticle⟧ at dawn')
    expect(segments).toEqual([
      { text: 'luminous', mark: true },
      { text: ' rings … ', mark: false },
      { text: 'canticle', mark: true },
      { text: ' at dawn', mark: false },
    ])
  })

  it('degrades gracefully on unbalanced markers', () => {
    expect(parseSnippetSegments('open ⟦tail')).toEqual([
      { text: 'open ', mark: false },
      { text: 'tail', mark: true },
    ])
    expect(parseSnippetSegments('stray ⟧ closer')).toEqual([
      { text: 'stray ⟧ closer', mark: false },
    ])
  })

  it('returns [] for empty and non-string input', () => {
    expect(parseSnippetSegments('')).toEqual([])
    expect(parseSnippetSegments(null)).toEqual([])
    expect(parseSnippetSegments(undefined)).toEqual([])
  })

  it('exports the same delimiters sql/search.sql emits', () => {
    expect(SNIPPET_START).toBe('⟦')
    expect(SNIPPET_END).toBe('⟧')
  })
})

describe('search result shaping', () => {
  it('routes current articles to /posts/{slug} and legacy articles to /{slug}', () => {
    expect(articleRouteFor('my-story', false)).toBe('/posts/my-story')
    expect(articleRouteFor('00', true)).toBe('/00')
  })

  it('routes profiles through /@identifier', () => {
    expect(profileRouteFor('simon')).toBe('/@simon')
    expect(profileRouteFor('qrw35trzq7hagejru2h3eqf5eyhxxmg4cul69u7am3')).toBe(
      '/@qrw35trzq7hagejru2h3eqf5eyhxxmg4cul69u7am3',
    )
  })

  it('groups RPC rows by type and drops unknown types', () => {
    const rows = [
      {
        result_type: 'article', id: 'a1', title: 'T', slug: 's', is_legacy: false,
        snippet: 'sn', locked: true, price_xec: '500', reading_time_minutes: 3,
        author_id: 'auth-1', created_at: '2026-07-17T00:00:00Z',
      },
      {
        result_type: 'post', id: 'txid1', snippet: 'p', account_id: 'acct-1',
        author_identity: 'ecash:qq1234', created_at: '2026-07-16T00:00:00Z',
      },
      { result_type: 'person', id: 'acct-2', title: 'simon', handle_color: '#3df0ff' },
      { result_type: 'mystery', id: 'x' },
    ]
    const grouped = groupSearchRows(rows)
    expect(grouped.articles).toHaveLength(1)
    expect(grouped.articles[0]).toMatchObject({
      id: 'a1', title: 'T', locked: true, priceXec: 500,
      route: '/posts/s', byline: null,
    })
    expect(grouped.posts[0]).toMatchObject({
      id: 'txid1', identity: 'ecash:qq1234', route: '/feed/txid1',
    })
    expect(grouped.people[0]).toMatchObject({
      handle: 'simon', handleColor: '#3df0ff', route: '/@simon',
    })
  })
})
