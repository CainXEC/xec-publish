import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { truncateAtWord } from '@/lib/truncateAtWord'

export const runtime = 'nodejs'

// Same dark-mode tokens as app/api/og/profile + /feed, so a forum share card
// reads as the same neon-on-black identity as every other card on the site.
const NEON = '#00ff9c'
const CYAN = '#3df0ff'
const BG = '#070b0a'
const DIM = '#5f8a7e'

const DESC_MAX = 150

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const slug = truncateAtWord(searchParams.get('slug') || 'forum', 26)
  const title = truncateAtWord(searchParams.get('title') || '', 64)
  const desc = truncateAtWord(searchParams.get('desc') || '', DESC_MAX)
  const posts = Number(searchParams.get('posts')) || 0
  const runner = truncateAtWord(searchParams.get('runner') || '', 30)

  // Scale the /f/slug headline to its length so a short name fills the card and a
  // long one still fits. Sizes are for the 1200x630 canvas.
  const nameLen = slug.length + 3 // account for the "/f/" prefix
  const nameSize = nameLen > 26 ? 58 : nameLen > 18 ? 72 : nameLen > 12 ? 88 : 104

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
    console.error('[og/forum] Font loading failed:', err)
  }

  const mono = fonts.length > 0 ? 'JetBrains Mono' : 'monospace'

  const statParts = []
  if (posts > 0) statParts.push(`${posts.toLocaleString()} ${posts === 1 ? 'post' : 'posts'}`)
  if (runner) statParts.push(`runner ${runner}`)
  const stat = statParts.join('   ·   ')

  try {
    const imageResponse = new ImageResponse(
      (
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
              {/* "FORUM" kicker so the card reads as a community at a glance,
                  not a profile. */}
              <div
                style={{
                  fontFamily: mono,
                  fontWeight: 800,
                  fontSize: '22px',
                  letterSpacing: '0.32em',
                  textTransform: 'uppercase',
                  color: CYAN,
                  marginBottom: '18px',
                }}
              >
                Forum
              </div>

              <div
                style={{
                  fontFamily: mono,
                  fontWeight: 800,
                  fontSize: `${nameSize}px`,
                  lineHeight: 1.05,
                  color: NEON,
                  textShadow: `0 0 14px ${NEON}66`,
                  maxWidth: '1020px',
                  overflow: 'hidden',
                }}
              >
                {`/f/${slug}`}
              </div>

              {title ? (
                <div
                  style={{
                    fontFamily: mono,
                    fontWeight: 400,
                    fontSize: '34px',
                    lineHeight: 1.3,
                    color: '#d6fff0',
                    marginTop: '20px',
                    maxWidth: '1000px',
                    maxHeight: '90px',
                    overflow: 'hidden',
                  }}
                >
                  {title}
                </div>
              ) : null}

              {desc ? (
                <div
                  style={{
                    fontFamily: mono,
                    fontWeight: 400,
                    fontSize: '26px',
                    lineHeight: 1.45,
                    color: '#8fb3a8',
                    marginTop: '18px',
                    maxWidth: '980px',
                    maxHeight: '115px',
                    overflow: 'hidden',
                  }}
                >
                  {desc}
                </div>
              ) : null}
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-end',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  fontFamily: mono,
                  fontWeight: 400,
                  fontSize: '24px',
                  color: DIM,
                }}
              >
                {stat}
              </div>
              <div
                style={{
                  fontFamily: mono,
                  fontWeight: 400,
                  fontSize: '16px',
                  color: DIM,
                  letterSpacing: '0.08em',
                }}
              >
                proofofwriting.com
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
    console.error('[og/forum] ImageResponse failed:', err)
    return new Response('Failed to generate image', {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
