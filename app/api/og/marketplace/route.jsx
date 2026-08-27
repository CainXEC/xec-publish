import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const runtime = 'nodejs'

// The /marketplace ("Handles") share card — Direction B, "the gallery": the
// pitch is "claim or buy a @handle", so the card reads like a marketplace,
// with sample @handles as little NFT tiles carrying a live-looking status.
// Same neon-on-black identity + neon frame as the feed/site cards. Rendered at
// 1200x630 (not 2x — the 2x cards took ~4s and overran social crawlers).
//
// The three names are CURATED for now (a static template). Populating the tiles
// from real recent mints / Agora listings is a deliberate follow-up — see the
// marketplace metadata note.
const NEON = '#00ff9c'
const BG = '#070b0a'
const TEXT = '#d6fff0'
const DIM = '#5f8a7e'
const CYAN = '#3df0ff'
const AMBER = '#ffcf5c'

// Each tile: the @handle + a status word whose color reads at a glance —
// taken (dim), available (neon, the CTA tile), for sale (amber).
const TILES = [
  { at: '@satoshi', status: 'taken', color: DIM, hot: false },
  { at: '@yourname', status: 'available', color: NEON, hot: true },
  { at: '@nakamoto', status: 'for sale · Agora', color: AMBER, hot: false },
]

export async function GET() {
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
    console.error('[og/marketplace] Font loading failed:', err)
  }
  const mono = fonts.length > 0 ? 'JetBrains Mono' : 'monospace'

  try {
    const image = new ImageResponse(
      (
        // Outer div = the neon frame (padding, not a border, so all four edges
        // show); inner div = the dark panel with the same bloom + inset glow.
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
                'radial-gradient(750px 420px at 50% 28%, rgba(0,255,156,0.12), rgba(7,11,10,0) 70%)',
              boxShadow: 'inset 0 0 60px rgba(0,255,156,0.14)',
            }}
          >
            <div
              style={{
                display: 'flex',
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
              proofofwriting · handles
            </div>

            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
              }}
            >
              {/* gap (not a trailing space, which satori trims) separates the words. */}
              <div style={{ display: 'flex', gap: '0.3em', fontFamily: mono, fontWeight: 800, fontSize: '68px' }}>
                <span style={{ color: TEXT }}>Claim your</span>
                <span style={{ color: NEON, textShadow: '0 0 22px rgba(0,255,156,0.5)' }}>@handle.</span>
              </div>

              <div style={{ display: 'flex', gap: '24px', marginTop: '42px' }}>
                {TILES.map((t) => (
                  <div
                    key={t.at}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      flexGrow: 1,
                      flexBasis: 0,
                      gap: '14px',
                      padding: '28px 26px',
                      borderRadius: '18px',
                      border: `2px solid ${t.hot ? 'rgba(0,255,156,0.7)' : 'rgba(0,255,156,0.32)'}`,
                      backgroundColor: t.hot ? 'rgba(0,255,156,0.07)' : 'rgba(0,255,156,0.035)',
                      boxShadow: t.hot
                        ? 'inset 0 0 34px rgba(0,255,156,0.18)'
                        : 'inset 0 0 26px rgba(0,255,156,0.07)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        fontFamily: mono,
                        fontWeight: 800,
                        fontSize: '38px',
                        color: CYAN,
                        textShadow: '0 0 14px rgba(61,240,255,0.4)',
                      }}
                    >
                      {t.at}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        fontFamily: mono,
                        fontWeight: 400,
                        fontSize: '19px',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: t.color,
                      }}
                    >
                      {t.status}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                fontFamily: mono,
                fontWeight: 400,
                fontSize: '16px',
                letterSpacing: '0.08em',
                color: DIM,
                flexShrink: 0,
              }}
            >
              proofofwriting.com/marketplace
            </div>
          </div>
        </div>
      ),
      { width: 1200, height: 630, fonts: fonts.length > 0 ? fonts : undefined },
    )

    // Replace next/og's default no-cache directive (case-insensitive set) with a
    // year-long immutable cache — same as the feed card.
    const headers = new Headers(image.headers)
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    headers.set('CDN-Cache-Control', 'public, max-age=31536000')
    return new Response(image.body, { headers })
  } catch (err) {
    console.error('[og/marketplace] ImageResponse failed:', err)
    return new Response('Failed to generate image', {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
