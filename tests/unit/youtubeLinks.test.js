import { describe, it, expect } from 'vitest'
import { extractYouTubeId, stripYouTubeLink, youTubeIdForPost } from '@/lib/youtubeLinks'

const ID = 'dQw4w9WgXcQ'

describe('extractYouTubeId', () => {
  it('matches the common share URL forms', () => {
    expect(extractYouTubeId(`watch: https://www.youtube.com/watch?v=${ID} nice`)).toBe(ID)
    expect(extractYouTubeId(`https://youtu.be/${ID}?si=abc`)).toBe(ID)
    expect(extractYouTubeId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID)
    expect(extractYouTubeId(`https://m.youtube.com/watch?v=${ID}&t=30s`)).toBe(ID)
    expect(extractYouTubeId(`https://www.youtube.com/embed/${ID}`)).toBe(ID)
    expect(extractYouTubeId(`youtube.com/watch?v=${ID}`)).toBe(ID)
  })

  it('returns null for non-YouTube / no link', () => {
    expect(extractYouTubeId('just some text, no video')).toBeNull()
    expect(extractYouTubeId('https://vimeo.com/12345')).toBeNull()
    expect(extractYouTubeId('https://www.youtube.com/watch?v=tooShort')).toBeNull()
    expect(extractYouTubeId('')).toBeNull()
    expect(extractYouTubeId(null)).toBeNull()
  })
})

describe('stripYouTubeLink', () => {
  it('removes the URL and trims', () => {
    expect(stripYouTubeLink(`https://youtu.be/${ID}`)).toBe('')
    expect(stripYouTubeLink(`before https://youtu.be/${ID}`)).toBe('before')
  })
  it('leaves non-YouTube text untouched', () => {
    expect(stripYouTubeLink('hello world')).toBe('hello world')
  })
})

describe('youTubeIdForPost', () => {
  const link = `https://youtu.be/${ID}?si=abc`
  // Real action codes from lib/feedProtocol: 1 post, 2 reply, 3 quote.
  it.each([
    ['post', 1],
    ['reply', 2],
    ['quote', 3],
  ])('embeds a YouTube link on a %s', (_kind, action) => {
    expect(youTubeIdForPost({ action, content: `so good\n\n${link}` })).toBe(ID)
  })

  it('embeds on the thread page for a reply with a link, not just in the feed', () => {
    // Regression: the thread focus post used to skip replies, leaving the raw URL
    // as text and no player (post f125a3bd…).
    expect(youTubeIdForPost({ action: 2, content: `Yes I think so 😜\n\n\n${link}` })).toBe(ID)
  })

  it('returns null with no link, no content, a deleted post, or no post', () => {
    expect(youTubeIdForPost({ action: 2, content: 'just words' })).toBeNull()
    expect(youTubeIdForPost({ action: 2, content: null })).toBeNull()
    expect(youTubeIdForPost({ action: 2, content: link, deleted: true })).toBeNull()
    expect(youTubeIdForPost(null)).toBeNull()
    expect(youTubeIdForPost(undefined)).toBeNull()
  })
})
