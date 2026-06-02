import { ImageResponse } from 'next/og'

export const runtime = 'edge'

async function getCSSFontUrl(cssUrl) {
  const css = await fetch(cssUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  }).then((r) => {
    if (!r.ok) throw new Error(`Font CSS fetch failed: ${r.status} ${cssUrl}`)
    return r.text()
  })
  const match = css.match(/src:\s*url\(([^)]+)\)\s*format\(['"]woff2['"]\)/)
  if (match?.[1]) return match[1].replace(/['"]/g, '')
  const fallback = css.match(/src:\s*url\(([^)]+)\)/)
  return fallback ? fallback[1].replace(/['"]/g, '') : null
}

async function loadOgFonts() {
  const [newsreaderUrl, courierUrl] = await Promise.all([
    getCSSFontUrl(
      'https://fonts.googleapis.com/css2?family=Newsreader:wght@500&display=swap',
    ),
    getCSSFontUrl(
      'https://fonts.googleapis.com/css2?family=Courier+Prime&display=swap',
    ),
  ])

  if (!newsreaderUrl || !courierUrl) {
    throw new Error('Could not parse font URLs from Google Fonts CSS')
  }

  const [newsreaderFont, courierPrimeFont] = await Promise.all([
    fetch(newsreaderUrl).then((res) => {
      if (!res.ok) throw new Error(`Newsreader woff2 failed: ${res.status}`)
      return res.arrayBuffer()
    }),
    fetch(courierUrl).then((res) => {
      if (!res.ok) throw new Error(`Courier Prime woff2 failed: ${res.status}`)
      return res.arrayBuffer()
    }),
  ])

  return [
    { name: 'Newsreader', data: newsreaderFont, style: 'normal', weight: 500 },
    { name: 'Courier Prime', data: courierPrimeFont, style: 'normal', weight: 400 },
  ]
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const title = searchParams.get('title') || 'Proof of Writing'
  const author = searchParams.get('author') || ''
  const readTime = searchParams.get('readTime') || ''
  const price = searchParams.get('price') || ''

  let fonts = []

  try {
    fonts = await loadOgFonts()
  } catch (err) {
    console.error('[og] Font loading failed:', err)
  }

  const titleFont = fonts.length > 0 ? 'Newsreader' : 'Georgia'
  const wordmarkFont = fonts.length > 0 ? 'Courier Prime' : 'monospace'

  try {
    return new ImageResponse(
      (
        <div
          style={{
            width: '1200px',
            height: '630px',
            background: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '60px 64px',
            borderLeft: '8px solid #059669',
          }}
        >
          <div
            style={{
              fontFamily: wordmarkFont,
              fontSize: '14px',
              letterSpacing: '0.14em',
              color: '#059669',
              textTransform: 'uppercase',
            }}
          >
            PROOF of WRITING
          </div>

          <div
            style={{
              fontFamily: titleFont,
              fontSize: title.length > 80 ? '44px' : '52px',
              lineHeight: 1.15,
              color: '#18181b',
              fontWeight: 500,
              maxWidth: '1000px',
            }}
          >
            {title}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              fontSize: '18px',
              color: '#059669',
              fontFamily: wordmarkFont,
            }}
          >
            {author ? <span>@{author}</span> : null}
            {readTime ? <span style={{ margin: '0 4px' }}>·</span> : null}
            {readTime ? <span>{readTime} min read</span> : null}
            {price ? <span style={{ margin: '0 4px' }}>·</span> : null}
            {price ? (
              <span>{Number(price).toLocaleString()} XEC to unlock</span>
            ) : null}
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        fonts: fonts.length > 0 ? fonts : undefined,
      },
    )
  } catch (err) {
    console.error('[og] ImageResponse failed:', err)
    return new Response('Failed to generate image', { status: 500 })
  }
}
