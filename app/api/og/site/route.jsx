import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const runtime = 'nodejs'

// The default social-share card for proofofwriting: the cypherpunk-neon feed
// wordmark on a dark background, matching the site's dark-mode identity. Any
// page without its own OG image (home, feed, marketplace, profiles) falls back
// to this. Rendered at 2× (2400×1260) per the OG convention, declared 1200×630.
export async function GET() {
  let fonts = []
  try {
    const courierPrimeFont = await readFile(
      join(process.cwd(), 'public/fonts/courier-prime-400.ttf'),
    )
    fonts = [{ name: 'Courier Prime', data: courierPrimeFont, style: 'normal', weight: 400 }]
  } catch (err) {
    console.error('[og/site] Font loading failed:', err)
  }

  const wordmarkFont = fonts.length > 0 ? 'Courier Prime' : 'monospace'

  try {
    const imageResponse = new ImageResponse(
      (
        <div
          style={{
            width: '2400px',
            height: '1260px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            // Base dark (--bg) with a soft neon bloom rising from the center.
            backgroundColor: '#070b0a',
            backgroundImage:
              'radial-gradient(1200px 700px at 50% 46%, rgba(0,255,156,0.16), rgba(7,11,10,0) 70%)',
            borderLeft: '24px solid #00ff9c',
          }}
        >
          <div
            style={{
              fontFamily: wordmarkFont,
              fontSize: '196px',
              fontWeight: 400,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: '#00ff9c',
              textShadow: '0 0 48px rgba(0,255,156,0.65)',
            }}
          >
            proofofwriting
          </div>

          <div
            style={{
              marginTop: '64px',
              fontFamily: wordmarkFont,
              fontSize: '52px',
              letterSpacing: '0.24em',
              textTransform: 'uppercase',
              color: '#3df0ff',
              textShadow: '0 0 24px rgba(61,240,255,0.4)',
            }}
          >
            Pay with eCash to unlock the full story
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
