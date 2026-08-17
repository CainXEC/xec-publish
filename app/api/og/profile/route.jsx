import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { truncateAtWord } from '@/lib/truncateAtWord'
import { isApprovedHandleColor } from '@/lib/handleColors'

export const runtime = 'nodejs'

// Live dark-mode tokens shared with app/api/og + app/api/og/feed, so a profile
// share card reads as the same neon-on-black identity as every other card on
// the site — not a one-off design.
const NEON = '#00ff9c'
const BG = '#070b0a'
const DIM = '#5f8a7e'

const BIO_MAX = 140

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  // "@handle" or a (caller-truncated) raw address — see profileOgMetadata.js.
  let identity = searchParams.get('identity') || 'proofofwriting'
  const colorParam = searchParams.get('color')
  const color = isApprovedHandleColor(colorParam) ? colorParam : NEON
  const bio = truncateAtWord(searchParams.get('bio') || '', BIO_MAX)
  const followers = Number(searchParams.get('followers')) || 0

  identity = truncateAtWord(identity, 44)

  // Scale to length so a short handle fills the card and a long truncated
  // address still fits. (Mono runs wide, so sizes stay modest.) Sizes are for
  // the 1200x630 canvas — half the old 2400x1260, which rendered too slowly for
  // social crawlers (see the ImageResponse note below).
  const len = identity.length
  const identitySize = len > 32 ? 52 : len > 22 ? 66 : len > 12 ? 84 : 98

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
    console.error('[og/profile] Font loading failed:', err)
  }

  const mono = fonts.length > 0 ? 'JetBrains Mono' : 'monospace'

  try {
    const imageResponse = new ImageResponse(
      (
        // Outer div = the neon frame wrapping all four sides (padding, not a CSS
        // border, so it shows on every edge). Inner div = the dark panel with the
        // site's neon bloom + inset glow — same rig as /api/og and /api/og/feed.
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
                  fontSize: `${identitySize}px`,
                  lineHeight: 1.1,
                  color,
                  textShadow: `0 0 14px ${color}66`,
                  maxWidth: '1020px',
                  overflow: 'hidden',
                }}
              >
                {identity}
              </div>

              {bio ? (
                <div
                  style={{
                    fontFamily: mono,
                    fontWeight: 400,
                    fontSize: '29px',
                    lineHeight: 1.5,
                    color: '#8fb3a8',
                    marginTop: '22px',
                    maxWidth: '980px',
                    maxHeight: '135px',
                    overflow: 'hidden',
                  }}
                >
                  {bio}
                </div>
              ) : null}

              {followers > 0 ? (
                <div
                  style={{
                    fontFamily: mono,
                    fontWeight: 400,
                    fontSize: '24px',
                    color: DIM,
                    marginTop: '20px',
                    flexShrink: 0,
                  }}
                >
                  {`${followers.toLocaleString()} ${followers === 1 ? 'follower' : 'followers'}`}
                </div>
              ) : null}
            </div>

            <div
              style={{
                fontFamily: mono,
                fontWeight: 400,
                fontSize: '16px',
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
      {
        // Rasterize at 1200x630 (standard OG size) even though the layout is
        // authored at 2400x1260 — a 2x-size PNG took ~4s to generate, which
        // overran social crawlers' fetch timeout (X dropped the card). Half the
        // linear size = 1/4 the pixels = a much faster raster, and 1200x630 is
        // exactly what X/Facebook display anyway.
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
    console.error('[og/profile] ImageResponse failed:', err)
    return new Response('Failed to generate image', {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
