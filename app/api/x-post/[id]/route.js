export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { fetchTweet } from 'react-tweet/api'
import { prepareXPostForEmbed } from '@/lib/xPostData'
import { getClientIp, rateLimit } from '@/lib/rateLimit'

// GET /api/x-post/<id> — one X post's public data, shaped for an embed card
// (components/feed/XEmbed). Fetched server-side from X's syndication endpoint
// (the one X's own embeds use; no API key) so a reader's browser never talks to
// X for the data, and filtered by prepareXPostForEmbed (markup neutralized,
// sensitive media withheld) before it leaves the server.
//
// Response shape is what react-tweet's useTweet expects: { data } on 200; a
// non-2xx makes the card fall back to a plain "view on X" link.
//
// Cached at the CDN (s-maxage) AND in Next's data cache (revalidate), so a post
// embedded in a busy feed costs one upstream fetch an hour, not one per reader.

const ID_RE = /^\d{1,20}$/
const OK_CACHE = 'public, s-maxage=3600, stale-while-revalidate=86400'
const GONE_CACHE = 'public, s-maxage=600, stale-while-revalidate=3600'
const FAIL_CACHE = 'public, s-maxage=60'

export async function GET(req, { params }) {
  const { id } = await params
  if (!ID_RE.test(String(id ?? ''))) {
    return NextResponse.json({ error: 'Invalid post id' }, { status: 400 })
  }

  // Only CDN misses reach here; this just stops a loop of random ids from
  // turning us into a free X scraper (and getting our egress rate-limited).
  if (!(await rateLimit(getClientIp(req), 120, 60, 'x-post'))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    // fetchTweet, not getTweet: same request, minus getTweet's console.error on
    // every deleted/protected post (routine here, not a bug to log).
    const { data: tweet } = await fetchTweet(id, { next: { revalidate: 3600 } })
    const data = prepareXPostForEmbed(tweet)
    if (!data) {
      // Deleted, protected, suspended, or never existed.
      return NextResponse.json(
        { error: 'Post unavailable' },
        { status: 404, headers: { 'Cache-Control': GONE_CACHE } },
      )
    }
    return NextResponse.json({ data }, { headers: { 'Cache-Control': OK_CACHE } })
  } catch {
    return NextResponse.json(
      { error: 'Could not load post' },
      { status: 502, headers: { 'Cache-Control': FAIL_CACHE } },
    )
  }
}
