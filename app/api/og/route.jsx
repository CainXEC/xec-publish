import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { truncateAtWord } from '@/lib/truncateAtWord'

export const runtime = 'nodejs'

// Live dark-mode article tokens: the reading view is #070b0a with a neon-green
// (#00ff9c) `.arttitle` headline in JetBrains Mono 800 (globals.css / verified
// on-page), so the share card is the same neon-on-black identity — not a light
// serif card. Matches app/api/og/feed + the site banner.
const NEON = '#00ff9c'
const BG = '#070b0a'
const DIM = '#5f8a7e'
const CYAN = '#3df0ff'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  let title = searchParams.get('title') || 'Proof of Writing'
  const author = searchParams.get('author') || ''
  const readTime = searchParams.get('readTime') || ''
  const price = searchParams.get('price') || ''
  // AI-operated author (authors.is_ai): the card must carry a clear
  // "AI simulation" label — publishing without it is a hard no for the agent.
  const isAi = searchParams.get('ai') === '1'

  // Clip at a word — a headline broken mid-word is what the reader's followers
  // see, permanently, in whatever timeline the link was pasted into.
  title = truncateAtWord(title, 120)

  // Scale the headline to its length so short titles fill the card and long
  // ones still fit. (Mono runs wide, so sizes stay modest.)
  const tLen = title.length
  // Sizes are for the 1200x630 canvas (half the old 2400x1260 — the 2x card
  // took ~4s to render and overran social crawlers' timeout, so X dropped it).
  const titleSize = tLen > 90 ? 46 : tLen > 60 ? 58 : tLen > 30 ? 72 : 86

  let fonts = []
  try {
    const [monoRegular, monoBold] = await Promise.all([
      readFile(join(process.cwd(), 'public/fonts/jetbrains-mono-400.ttf')),
      readFile(join(process.cwd(), 'public/fonts/jetbrains-mono-800.ttf')),
    ])
    fonts = [
      { name: 'JetBrains Mono', data: monoRegular, style: 'normal', weight: 400 },
      { name: 'JetBrains Mono', data: monoBold, style: 'normal', weight: 800 },
    ]
  } catch (err) {
    console.error('[og] Font loading failed:', err)
  }

  const mono = fonts.length > 0 ? 'JetBrains Mono' : 'monospace'

  try {
    const imageResponse = new ImageResponse(
      (
        // Outer div = the neon frame wrapping all four sides (padding, not a CSS
        // border, so it shows on every edge). Inner div = the dark reading panel
        // with the site's neon bloom + inset glow.
        <div
          style={{
            width: '1200px',
            height: '630px',
            display: 'flex',
            padding: '15px',
            backgroundColor: NEON,
          }}
        >
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              padding: '48px 56px',
              backgroundColor: BG,
              backgroundImage:
                'radial-gradient(750px 410px at 50% 0%, rgba(0,255,156,0.10), rgba(7,11,10,0) 68%)',
              boxShadow: 'inset 0 0 60px rgba(0,255,156,0.12)',
            }}
          >
            <div
              style={{
                fontFamily: mono,
                fontWeight: 800,
                fontSize: '25px',
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: NEON,
                textShadow: '0 0 13px rgba(0,255,156,0.55)',
                flexShrink: 0,
              }}
            >
              proofofwriting
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
              <div
                style={{
                  fontFamily: mono,
                  fontWeight: 800,
                  fontSize: `${titleSize}px`,
                  lineHeight: 1.15,
                  color: NEON,
                  textShadow: '0 0 14px rgba(0,255,156,0.40)',
                  maxWidth: '1020px',
                  overflow: 'hidden',
                }}
              >
                {title}
              </div>

              {/* Byline · read time · price sits DIRECTLY under the title (not at
                  the card's bottom edge, where social crawlers' own title/caption
                  overlay clips it). flexWrap keeps a long meta line on the card. */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: '11px',
                  marginTop: '22px',
                  fontFamily: mono,
                  fontSize: '22px',
                  flexShrink: 0,
                }}
              >
                {isAi ? (
                  <span
                    style={{
                      color: NEON,
                      fontWeight: 800,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      border: `2px solid ${NEON}`,
                      borderRadius: '6px',
                      padding: '2px 12px',
                    }}
                  >
                    AI simulation
                  </span>
                ) : null}
                {isAi && author ? <span style={{ color: DIM }}>·</span> : null}
                {author ? <span style={{ color: NEON, fontWeight: 800 }}>{`@${author}`}</span> : null}
                {author && readTime ? <span style={{ color: DIM }}>·</span> : null}
                {readTime ? <span style={{ color: DIM }}>{`${readTime} min read`}</span> : null}
                {(author || readTime) && price ? <span style={{ color: DIM }}>·</span> : null}
                {price ? (
                  <span style={{ color: CYAN }}>{`${Number(price).toLocaleString()} XEC to unlock`}</span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        fonts: fonts.length > 0 ? fonts : undefined,
        emoji: 'twemoji',
      },
    )

    return new Response(imageResponse.body, {
      headers: {
        ...Object.fromEntries(imageResponse.headers.entries()),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'CDN-Cache-Control': 'public, max-age=31536000',
      },
    })
  } catch (err) {
    console.error('[og] ImageResponse failed:', err)
    return new Response('Failed to generate image', {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
