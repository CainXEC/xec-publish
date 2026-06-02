import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const title = searchParams.get('title') || 'Proof of Writing'
  const author = searchParams.get('author') || ''
  const readTime = searchParams.get('readTime') || ''
  const price = searchParams.get('price') || ''

  const newsreaderFont = await fetch(
    'https://fonts.gstatic.com/s/newsreader/v20/cY9qfjOCX1hbuyalUrK49dLac06G1ZGsZBtoBCzBDXXD9JVF438w.woff2',
  ).then((res) => res.arrayBuffer())

  const courierPrimeFont = await fetch(
    'https://fonts.gstatic.com/s/courierprime/v8/u-450q2lgwslOqpF_6gQ8kELY7pMf-c.woff2',
  ).then((res) => res.arrayBuffer())

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          background: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '60px 64px',
          borderLeft: '8px solid #059669',
          fontFamily: 'Courier Prime, monospace',
        }}
      >
        <div
          style={{
            fontFamily: 'Courier Prime',
            fontSize: '14px',
            letterSpacing: '0.14em',
            color: '#059669',
            textTransform: 'uppercase',
          }}
        >
          PROOF of WRITING
        </div>

        <div
          style={{
            fontFamily: 'Newsreader',
            fontSize: title.length > 80 ? '44px' : '52px',
            lineHeight: 1.15,
            color: '#18181b',
            fontWeight: 500,
            maxWidth: '1000px',
          }}
        >
          {title}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            fontSize: '18px',
            color: '#059669',
            fontFamily: 'Courier Prime',
          }}
        >
          {author ? <span>@{author}</span> : null}
          {readTime ? <span>·</span> : null}
          {readTime ? <span>{readTime} min read</span> : null}
          {price ? <span>·</span> : null}
          {price ? (
            <span>{Number(price).toLocaleString()} XEC to unlock</span>
          ) : null}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: 'Newsreader',
          data: newsreaderFont,
          style: 'normal',
          weight: 500,
        },
        {
          name: 'Courier Prime',
          data: courierPrimeFont,
          style: 'normal',
          weight: 400,
        },
      ],
    },
  )
}
