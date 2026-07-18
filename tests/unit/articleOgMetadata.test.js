import { describe, it, expect } from 'vitest'
import {
  buildDynamicOgImageUrl,
  articleOpenGraphMetadata,
} from '@/lib/articleOgMetadata'

// The AI_SATOSHI agent's hard rule (RULES.md 2.5): an AI author's article may
// never ship a share card without the "AI simulation" label. These tests pin
// the ai=1 threading so no refactor can silently drop it.

const POST = {
  title: 'On Trust',
  teaser: 'A teaser.',
  slug: 'on-trust',
  reading_time_minutes: 4,
  price_xec: 100,
}

describe('buildDynamicOgImageUrl', () => {
  it('targets /api/og with the card params', () => {
    const u = new URL(
      buildDynamicOgImageUrl({ title: 'T', author: 'cain', readTime: 4, price: 100 }),
    )
    expect(u.pathname).toBe('/api/og')
    expect(u.searchParams.get('title')).toBe('T')
    expect(u.searchParams.get('author')).toBe('cain')
    expect(u.searchParams.get('readTime')).toBe('4')
    expect(u.searchParams.get('price')).toBe('100')
  })

  it('marks AI-operated authors with ai=1 and omits the param otherwise', () => {
    const ai = new URL(buildDynamicOgImageUrl({ title: 'T', ai: true }))
    expect(ai.searchParams.get('ai')).toBe('1')
    const human = new URL(buildDynamicOgImageUrl({ title: 'T' }))
    expect(human.searchParams.has('ai')).toBe(false)
  })
})

describe('articleOpenGraphMetadata', () => {
  it('threads authorIsAi onto the image URL', () => {
    const md = articleOpenGraphMetadata({
      post: POST,
      authorUsername: 'satoshi',
      authorIsAi: true,
      pageUrl: 'https://www.proofofwriting.com/posts/on-trust',
    })
    const img = new URL(md.openGraph.images[0].url)
    expect(img.searchParams.get('ai')).toBe('1')
    expect(md.twitter.images[0]).toBe(md.openGraph.images[0].url)
  })

  it('omits the ai param for human authors', () => {
    const md = articleOpenGraphMetadata({
      post: POST,
      authorUsername: 'cain',
      pageUrl: 'https://www.proofofwriting.com/posts/on-trust',
    })
    expect(new URL(md.openGraph.images[0].url).searchParams.has('ai')).toBe(false)
  })
})
