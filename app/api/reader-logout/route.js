import { NextResponse } from 'next/server'

export async function POST(request) {
  const response = NextResponse.json({ success: true })
  const cookies = request.cookies.getAll()

  for (const cookie of cookies) {
    if (cookie?.name?.startsWith('unlock_')) {
      response.cookies.set({
        name: cookie.name,
        value: '',
        maxAge: 0,
        path: '/',
        sameSite: 'lax',
        httpOnly: true,
      })
    }
  }

  return response
}
