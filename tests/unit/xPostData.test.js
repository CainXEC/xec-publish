import { describe, it, expect } from 'vitest'
import { prepareXPostForEmbed } from '@/lib/xPostData'

function post(over = {}) {
  return {
    __typename: 'Tweet',
    id_str: '123',
    text: 'hello &amp; welcome',
    display_text_range: [0, 19],
    lang: 'en',
    entities: {},
    user: { id_str: '1', name: 'Someone', screen_name: 'someone' },
    possibly_sensitive: false,
    ...over,
  }
}

const media = {
  mediaDetails: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/a.jpg' }],
  photos: [{ url: 'https://pbs.twimg.com/media/a.jpg' }],
}

describe('prepareXPostForEmbed', () => {
  it('passes a normal post through (keeping its media)', () => {
    const out = prepareXPostForEmbed(post(media))
    expect(out.text).toBe('hello &amp; welcome')
    expect(out.mediaDetails).toHaveLength(1)
    expect(out.pow_media_hidden).toBeUndefined()
  })

  it('swaps raw < and > in EVERY string for lookalikes, keeping lengths', () => {
    const evil = '<img src=x onerror=alert(1)>'
    const out = prepareXPostForEmbed(
      post({ text: evil, user: { id_str: '1', name: '<b>x</b>', screen_name: 's' } }),
    )
    expect(out.text).not.toMatch(/[<>]/)
    expect([...out.text]).toHaveLength([...evil].length) // entity indices still line up
    expect(out.user.name).not.toMatch(/[<>]/)
  })

  it('withholds media on a possibly_sensitive post, and says so', () => {
    const out = prepareXPostForEmbed(post({ ...media, possibly_sensitive: true, video: { x: 1 } }))
    expect(out.mediaDetails).toBeUndefined()
    expect(out.photos).toBeUndefined()
    expect(out.video).toBeUndefined()
    expect(out.pow_media_hidden).toBe(true)
    expect(out.text).toBe('hello &amp; welcome') // text stays
  })

  it('withholds media on a sensitive QUOTED post independently', () => {
    const out = prepareXPostForEmbed(post({ ...media, quoted_tweet: post({ ...media, possibly_sensitive: true }) }))
    expect(out.mediaDetails).toHaveLength(1)
    expect(out.quoted_tweet.mediaDetails).toBeUndefined()
    expect(out.quoted_tweet.pow_media_hidden).toBe(true)
  })

  it('drops the bundled reply-parent copy', () => {
    expect(prepareXPostForEmbed(post({ parent: post() })).parent).toBeUndefined()
  })

  it('rejects missing or malformed data', () => {
    expect(prepareXPostForEmbed(undefined)).toBeNull()
    expect(prepareXPostForEmbed({})).toBeNull()
    expect(prepareXPostForEmbed(post({ id_str: 'abc' }))).toBeNull()
    expect(prepareXPostForEmbed(post({ user: null }))).toBeNull()
    expect(prepareXPostForEmbed(post({ display_text_range: undefined }))).toBeNull()
  })

  it('never mutates its input', () => {
    const input = post({ ...media, possibly_sensitive: true, text: '<x>' })
    prepareXPostForEmbed(input)
    expect(input.mediaDetails).toHaveLength(1)
    expect(input.text).toBe('<x>')
  })
})
