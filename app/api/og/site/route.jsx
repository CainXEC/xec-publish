import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const runtime = 'nodejs'

// The default social-share card for proofofwriting: the cypherpunk-neon feed
// wordmark on a dark background, framed by the neon bar, matching the site's
// dark-mode identity. Any page without its own OG image (home, feed, marketplace,
// profiles) falls back to this. Rendered at 2× (2400×1260) per the OG convention,
// declared 1200×630. The wordmark uses the SAME face as the site banner —
// JetBrains Mono ExtraBold (800), uppercase, 0.18em tracking.
export async function GET() {
  let fonts = []
  try {
    const jetbrainsFont = await readFile(
      join(process.cwd(), 'public/fonts/jetbrains-mono-800.ttf'),
    )
    fonts = [{ name: 'JetBrains Mono', data: jetbrainsFont, style: 'normal', weight: 800 }]
  } catch (err) {
    console.error('[og/site] Font loading failed:', err)
  }

  const wordmarkFont = fonts.length > 0 ? 'JetBrains Mono' : 'monospace'

  try {
    const imageResponse = new ImageResponse(
      (
        // Outer = the neon frame (a solid bar wrapping all four sides); inner =
        // the dark panel. Rendering the frame as a padded outer div (rather than a
        // border) guarantees it shows on every edge regardless of box model.
        <div
          style={{
            width: '2400px',
            height: '1260px',
            display: 'flex',
            padding: '28px',
            backgroundColor: '#00ff9c',
          }}
        >
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              // Base dark (--bg) with a soft neon bloom rising from the center,
              // plus an inset neon glow so the frame bleeds light inward — the
              // same subtle bloom the neon bar gives off in the site banner.
              backgroundColor: '#070b0a',
              backgroundImage:
                'radial-gradient(1200px 700px at 50% 50%, rgba(0,255,156,0.18), rgba(7,11,10,0) 70%)',
              boxShadow: 'inset 0 0 110px rgba(0,255,156,0.45)',
            }}
          >
            <div
              style={{
                fontFamily: wordmarkFont,
                fontSize: '182px',
                fontWeight: 800,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: '#00ff9c',
                textShadow: '0 0 48px rgba(0,255,156,0.65)',
                // 0.18em tracking adds trailing space after the last glyph; nudge
                // left so the word reads optically centered.
                paddingLeft: '0.18em',
              }}
            >
              proofofwriting
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

    return new Response(imageResponse.body, {
      headers: {
        ...Object.fromEntries(imageResponse.headers.entries()),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'CDN-Cache-Control': 'public, max-age=31536000',
      },
    })
  } catch (err) {
    console.error('[og/site] ImageResponse failed:', err)
    return new Response('Failed to generate image', {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
