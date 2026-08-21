import { describe, it, expect } from 'vitest'
import { extractYouTubeId, stripYouTubeLink } from '@/lib/youtubeLinks'

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
