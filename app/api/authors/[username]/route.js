import { NextResponse } from 'next/server'
import { loadAuthorProfileByUsername } from '@/lib/loadAuthorProfile'

export async function GET(_request, { params }) {
  const { username: raw } = await params
  const username = typeof raw === 'string' ? raw : ''

  const { error, author, posts, totalUnlocks, totalEarnings } =
    await loadAuthorProfileByUsername(username)

  if (error) {
    return NextResponse.json({ error }, { status: 500 })
  }
  if (!author) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  return NextResponse.json(
    { author, posts, totalUnlocks, totalEarnings },
    {
      headers: {
        'Cache-Control': 's-maxage=30, stale-while-revalidate=300',
      },
    },
  )
}
