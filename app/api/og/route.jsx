import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const runtime = 'nodejs'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const title = searchParams.get('title') || 'Proof of Writing'
  const author = searchParams.get('author') || ''
  const readTime = searchParams.get('readTime') || ''
  const price = searchParams.get('price') || ''

  let fonts = []

  try {
    const [newsreaderFont, courierPrimeFont] = await Promise.all([
      readFile(join(process.cwd(), 'public/fonts/newsreader-500.ttf')),
      readFile(join(process.cwd(), 'public/fonts/courier-prime-400.ttf')),
    ])

    fonts = [
      { name: 'Newsreader', data: newsreaderFont, style: 'normal', weight: 500 },
      { name: 'Courier Prime', data: courierPrimeFont, style: 'normal', weight: 400 },
    ]
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
              flexShrink: 0,
            }}
          >
            PROOF of WRITING
          </div>

          <div
            style={{
              fontFamily: titleFont,
              fontSize:
                title.length > 100 ? '38px' : title.length > 80 ? '44px' : '52px',
              lineHeight: 1.15,
              color: '#18181b',
              fontWeight: 500,
              maxWidth: '1000px',
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              overflow: 'hidden',
              padding: '24px 0',
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
              flexShrink: 0,
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
