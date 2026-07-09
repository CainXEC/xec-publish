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
    const [newsreaderFont, jetbrainsRegular, jetbrainsExtraBold] = await Promise.all([
      readFile(join(process.cwd(), 'public/fonts/newsreader-500.ttf')),
      readFile(join(process.cwd(), 'public/fonts/jetbrains-mono-400.ttf')),
      readFile(join(process.cwd(), 'public/fonts/jetbrains-mono-800.ttf')),
    ])

    fonts = [
      { name: 'Newsreader', data: newsreaderFont, style: 'normal', weight: 500 },
      { name: 'JetBrains Mono', data: jetbrainsRegular, style: 'normal', weight: 400 },
      { name: 'JetBrains Mono', data: jetbrainsExtraBold, style: 'normal', weight: 800 },
    ]
  } catch (err) {
    console.error('[og] Font loading failed:', err)
  }

  const titleFont = fonts.length > 0 ? 'Newsreader' : 'Georgia'
  const wordmarkFont = fonts.length > 0 ? 'JetBrains Mono' : 'monospace'

  try {
    const imageResponse = new ImageResponse(
      (
        <div
          style={{
            width: '2400px',
            height: '1260px',
            background: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            padding: '120px 128px',
            borderLeft: '16px solid #059669',
          }}
        >
          <div
            style={{
              fontFamily: wordmarkFont,
              fontWeight: 800,
              fontSize: '52px',
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
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                fontFamily: titleFont,
                fontSize:
                  title.length > 100 ? '108px' : title.length > 80 ? '128px' : '152px',
                lineHeight: 1.15,
                color: '#18181b',
                fontWeight: 500,
                maxWidth: '2000px',
                overflow: 'hidden',
              }}
            >
              {title}
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '40px',
                fontSize: '64px',
                color: '#059669',
                fontFamily: wordmarkFont,
                fontWeight: 400,
                flexShrink: 0,
                marginTop: '72px',
              }}
            >
              {author ? <span>@{author}</span> : null}
              {readTime ? <span style={{ margin: '0 8px' }}>·</span> : null}
              {readTime ? <span>{readTime} min read</span> : null}
              {price ? <span style={{ margin: '0 8px' }}>·</span> : null}
              {price ? (
                <span>{Number(price).toLocaleString()} XEC to unlock</span>
              ) : null}
            </div>
          </div>
        </div>
      ),
      {
        width: 2400,
        height: 1260,
        fonts: fonts.length > 0 ? fonts : undefined,
      },
    )

    const response = new Response(imageResponse.body, {
      headers: {
        ...Object.fromEntries(imageResponse.headers.entries()),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'CDN-Cache-Control': 'public, max-age=31536000',
      },
    })

    return response
  } catch (err) {
    console.error('[og] ImageResponse failed:', err)
    return new Response('Failed to generate image', {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
