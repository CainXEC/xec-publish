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

// Live dark-mode feed tokens (globals.css --bg/--text/--neon, feedTheme.js) so
// the share card is the same neon-on-black identity readers see in-app.
const NEON = '#00ff9c'
const BG = '#070b0a'
const TEXT = '#d6fff0'
const DIM = '#5f8a7e'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const rawText = searchParams.get('text') || ''
  const author = searchParams.get('author') || ''
  const action = Number(searchParams.get('action')) || 0
  // AI-operated poster (authors.is_ai): the card carries a clear
  // "AI simulation" label next to the byline.
  const isAi = searchParams.get('ai') === '1'

  // Tweet-length preview: collapse whitespace and clip so the layout stays
  // legible no matter how long the on-chain post is.
  let text = rawText.replace(/\s+/g, ' ').trim()
  if (text.length > 280) text = text.slice(0, 279).trimEnd() + '…'

  // Scale the body to the amount of text: short posts fill the card, long ones
  // shrink to fit without overflowing. (Mono runs wide, so sizes stay modest.)
  const len = text.length
  const bodySize =
    len > 220 ? 54 : len > 140 ? 68 : len > 70 ? 88 : len > 30 ? 108 : 132

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
    console.error('[og/feed] Font loading failed:', err)
  }

  // The whole card is JetBrains Mono — the same face as the live feed. Emoji are
  // rasterized by next/og's built-in Twemoji handling (see the `emoji` option).
  const mono = fonts.length > 0 ? 'JetBrains Mono' : 'monospace'
  const tag = ACTION_TAG[action] || ''

  try {
    const image = new ImageResponse(
      (
        // Outer div = the neon frame wrapping all four sides (rendered as padding,
        // not a CSS border, so it shows on every edge). Inner div = the dark feed
        // panel with a soft neon bloom + inset glow, matching the site banner.
        <div
          style={{
            width: '2400px',
            height: '1260px',
            display: 'flex',
            padding: '30px',
            backgroundColor: NEON,
          }}
        >
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              padding: '96px 112px',
              backgroundColor: BG,
              backgroundImage:
                'radial-gradient(1500px 820px at 50% 0%, rgba(0,255,156,0.10), rgba(7,11,10,0) 68%)',
              boxShadow: 'inset 0 0 120px rgba(0,255,156,0.12)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '26px', flexShrink: 0 }}>
              <div
                style={{
                  fontFamily: mono,
                  fontWeight: 800,
                  fontSize: '50px',
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: NEON,
                  textShadow: '0 0 26px rgba(0,255,156,0.55)',
                }}
              >
                proofofwriting
              </div>
              {tag ? (
                <div style={{ fontFamily: mono, fontWeight: 400, fontSize: '38px', color: DIM }}>
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
              {author || isAi ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '28px', marginBottom: '40px' }}>
                  {author ? (
                    <div
                      style={{
                        fontFamily: mono,
                        fontWeight: 800,
                        fontSize: '54px',
                        color: NEON,
                        textShadow: '0 0 12px rgba(0,255,156,0.35)',
                      }}
                    >
                      {author}
                    </div>
                  ) : null}
                  {isAi ? (
                    <div
                      style={{
                        fontFamily: mono,
                        fontWeight: 800,
                        fontSize: '38px',
                        color: NEON,
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        border: `3px solid ${NEON}`,
                        borderRadius: '12px',
                        padding: '4px 22px',
                      }}
                    >
                      AI simulation
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div
                style={{
                  fontFamily: mono,
                  fontWeight: 400,
                  fontSize: `${bodySize}px`,
                  lineHeight: 1.4,
                  color: TEXT,
                  maxWidth: '2040px',
                  overflow: 'hidden',
                }}
              >
                {text}
              </div>
            </div>

            <div
              style={{
                fontFamily: mono,
                fontWeight: 400,
                fontSize: '32px',
                color: DIM,
                letterSpacing: '0.08em',
                flexShrink: 0,
              }}
            >
              proofofwriting.com
            </div>
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
