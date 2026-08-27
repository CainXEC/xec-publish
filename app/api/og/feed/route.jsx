import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FEED_ACTION } from '@/lib/feedProtocol'
import { truncateAtWord } from '@/lib/truncateAtWord'
import { normalizeOgText } from '@/lib/normalizeOgText'

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

  // Tweet-length preview: tidy whitespace (PRESERVING line breaks so the card
  // reads as written) and clip so the layout stays legible no matter how long
  // the on-chain post is. Callers (feedOgMetadata) already clip at a word — this
  // is the backstop for a hand-built or older-cached URL, and it clips at a word
  // too so no path can cut mid-word.
  const text = truncateAtWord(normalizeOgText(rawText), 280)

  // Scale the body to fit: shrink for long posts (char count) AND for many-line
  // posts (line count), whichever forces smaller, so a bulleted post can't push
  // its own text off the card. Sizes are for the 1200x630 canvas (half the old
  // 2400x1260 — the 2x card took ~4s and overran social crawlers' timeout).
  const len = text.length
  const lineCount = text.split('\n').length
  const byLen = len > 220 ? 27 : len > 140 ? 34 : len > 70 ? 44 : len > 30 ? 54 : 66
  const byLines = lineCount >= 9 ? 27 : lineCount >= 7 ? 34 : lineCount >= 6 ? 44 : lineCount >= 5 ? 54 : 66
  const bodySize = Math.min(byLen, byLines)

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
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '13px', flexShrink: 0 }}>
              <div
                style={{
                  fontFamily: mono,
                  fontWeight: 800,
                  fontSize: '25px',
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: NEON,
                  textShadow: '0 0 13px rgba(0,255,156,0.55)',
                }}
              >
                proofofwriting
              </div>
              {tag ? (
                <div style={{ fontFamily: mono, fontWeight: 400, fontSize: '19px', color: DIM }}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '20px' }}>
                  {author ? (
                    <div
                      style={{
                        fontFamily: mono,
                        fontWeight: 800,
                        fontSize: '27px',
                        color: NEON,
                        textShadow: '0 0 6px rgba(0,255,156,0.35)',
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
                        fontSize: '19px',
                        color: NEON,
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        border: `2px solid ${NEON}`,
                        borderRadius: '6px',
                        padding: '2px 11px',
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
                  maxWidth: '1020px',
                  overflow: 'hidden',
                  // Honor the post's line breaks (long lines still wrap).
                  whiteSpace: 'pre-wrap',
                }}
              >
                {text}
              </div>
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
      { width: 1200, height: 630, fonts: fonts.length > 0 ? fonts : undefined, emoji: 'twemoji' },
    )

    // Build headers via Headers.set (case-INSENSITIVE) so our immutable cache
    // directive REPLACES next/og's default `cache-control: max-age=0,
    // must-revalidate` instead of appending to it. Spreading
    // Object.fromEntries(...) alongside a differently-cased 'Cache-Control' key
    // produced a malformed doubled header
    // ("...max-age=0, must-revalidate, public, max-age=31536000, immutable")
    // whose max-age=0 half fought the year-long cache we want for share cards.
    const headers = new Headers(image.headers)
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    headers.set('CDN-Cache-Control', 'public, max-age=31536000')
    return new Response(image.body, { headers })
  } catch (err) {
    console.error('[og/feed] ImageResponse failed:', err)
    return new Response('Failed to generate image', {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
