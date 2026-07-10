import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FEED_ACTION } from '@/lib/feedProtocol'

export const runtime = 'nodejs'

// Only reply/quote get a verb tag; a plain post needs none, and repost/like
// carry no body text so they never render this card.
const ACTION_TAG = {
  [FEED_ACTION.REPLY]: 'replied',
  [FEED_ACTION.QUOTE]: 'quoted',
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const rawText = searchParams.get('text') || ''
  const author = searchParams.get('author') || ''
  const action = Number(searchParams.get('action')) || 0

  // Tweet-length preview: collapse whitespace and clip so the layout stays
  // legible no matter how long the on-chain post is.
  let text = rawText.replace(/\s+/g, ' ').trim()
  if (text.length > 280) text = text.slice(0, 279).trimEnd() + '…'

  // Scale the body to the amount of text: short posts fill the card, long ones
  // shrink to fit without overflowing.
  const len = text.length
  const bodySize =
    len > 220 ? 58 : len > 140 ? 74 : len > 70 ? 96 : len > 30 ? 116 : 140

  let fonts = []
  try {
    const [newsreader, mono, monoBold] = await Promise.all([
      readFile(join(process.cwd(), 'public/fonts/newsreader-500.ttf')),
      readFile(join(process.cwd(), 'public/fonts/jetbrains-mono-400.ttf')),
      readFile(join(process.cwd(), 'public/fonts/jetbrains-mono-800.ttf')),
    ])
    fonts = [
      { name: 'Newsreader', data: newsreader, style: 'normal', weight: 500 },
      { name: 'JetBrains Mono', data: mono, style: 'normal', weight: 400 },
      { name: 'JetBrains Mono', data: monoBold, style: 'normal', weight: 800 },
    ]
  } catch (err) {
    console.error('[og/feed] Font loading failed:', err)
  }

  // Emoji are rasterized by next/og's built-in Twemoji handling (see the `emoji`
  // option below), so the text fonts only need Latin coverage.
  const bodyFont = fonts.length > 0 ? 'Newsreader' : 'Georgia'
  const monoFont = fonts.length > 0 ? 'JetBrains Mono' : 'monospace'
  const tag = ACTION_TAG[action] || ''

  try {
    const image = new ImageResponse(
      (
        <div
          style={{
            width: '2400px',
            height: '1260px',
            background: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            padding: '110px 128px',
            borderLeft: '16px solid #059669',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '28px', flexShrink: 0 }}>
            <div
              style={{
                fontFamily: monoFont,
                fontWeight: 800,
                fontSize: '50px',
                letterSpacing: '0.14em',
                color: '#059669',
                textTransform: 'uppercase',
              }}
            >
              PROOF of WRITING
            </div>
            {tag ? (
              <div style={{ fontFamily: monoFont, fontWeight: 400, fontSize: '40px', color: '#9ca3af' }}>
                {`· ${tag}`}
              </div>
            ) : null}
          </div>

          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {author ? (
              <div
                style={{
                  fontFamily: monoFont,
                  fontWeight: 400,
                  fontSize: '56px',
                  color: '#059669',
                  marginBottom: '40px',
                }}
              >
                {author}
              </div>
            ) : null}
            <div
              style={{
                fontFamily: bodyFont,
                fontWeight: 500,
                fontSize: `${bodySize}px`,
                lineHeight: 1.25,
                color: '#18181b',
                maxWidth: '2050px',
                overflow: 'hidden',
              }}
            >
              {text}
            </div>
          </div>

          <div
            style={{
              fontFamily: monoFont,
              fontWeight: 400,
              fontSize: '34px',
              color: '#9ca3af',
              letterSpacing: '0.08em',
              flexShrink: 0,
            }}
          >
            proofofwriting.com
          </div>
        </div>
      ),
      { width: 2400, height: 1260, fonts: fonts.length > 0 ? fonts : undefined, emoji: 'twemoji' },
    )

    return new Response(image.body, {
      headers: {
        ...Object.fromEntries(image.headers.entries()),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'CDN-Cache-Control': 'public, max-age=31536000',
      },
    })
  } catch (err) {
    console.error('[og/feed] ImageResponse failed:', err)
    return new Response('Failed to generate image', {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
