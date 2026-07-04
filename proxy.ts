import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Maintenance gate. While the site is pre-launch we don't want the public
// hitting /mint, /login, the feed, or any API route. This intercepts every
// request and serves an "under construction" page (HTTP 503) instead.
//
// To relaunch WITHOUT a code change: set env `SITE_LIVE=true` in Vercel.
// Owner preview while gated: visit any page with `?preview=<PREVIEW_BYPASS_TOKEN>`
// (matching the env var). That drops a cookie so subsequent navigation works.

const PREVIEW_COOKIE = 'site_preview'

export function proxy(request: NextRequest) {
  // Site is live — let everything through.
  if (process.env.SITE_LIVE === 'true') {
    return NextResponse.next()
  }

  const bypassToken = process.env.PREVIEW_BYPASS_TOKEN
  const url = request.nextUrl

  if (bypassToken) {
    // First arrival with the token in the query string: set the cookie and
    // redirect to a clean URL so the token doesn't linger in the address bar.
    const previewParam = url.searchParams.get('preview')
    if (previewParam && previewParam === bypassToken) {
      const clean = new URL(url)
      clean.searchParams.delete('preview')
      const res = NextResponse.redirect(clean)
      res.cookies.set(PREVIEW_COOKIE, bypassToken, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      })
      return res
    }

    // Returning owner with a valid cookie: let them through.
    if (request.cookies.get(PREVIEW_COOKIE)?.value === bypassToken) {
      return NextResponse.next()
    }
  }

  return new NextResponse(MAINTENANCE_HTML, {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': '3600',
    },
  })
}

export const config = {
  // Run on everything except Next's static assets and the favicon. API routes
  // are intentionally included so no endpoint is reachable while gated.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

const MAINTENANCE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>proof of writing // under construction</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap');
  :root {
    --bg: #070b0a; --panel: #0d1513; --line: #173a33;
    --text: #d6fff0; --dim: #5f8a7e; --neon: #00ff9c; --cyan: #3df0ff;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 24px;
    background-image:
      radial-gradient(circle at 50% 0%, rgba(0,255,156,0.10), transparent 60%),
      repeating-linear-gradient(0deg, rgba(255,255,255,0.02) 0 1px, transparent 1px 3px);
  }
  .card {
    width: 100%; max-width: 560px;
    border: 1px solid var(--line); border-radius: 14px;
    background: var(--panel);
    padding: 40px 32px; text-align: center;
    box-shadow: 0 0 60px rgba(0,255,156,0.08);
  }
  .eyebrow {
    color: var(--dim); font-size: 12px; letter-spacing: 0.18em;
    text-transform: uppercase; margin-bottom: 20px;
  }
  h1 {
    margin: 0 0 14px; font-size: 26px; font-weight: 700;
    color: var(--neon); text-shadow: 0 0 18px rgba(0,255,156,0.35);
  }
  p { margin: 0 auto; max-width: 42ch; color: var(--text); line-height: 1.6; font-size: 14px; }
  .dim { color: var(--dim); margin-top: 18px; font-size: 12px; }
  .bar {
    margin: 26px auto 0; height: 3px; width: 120px; border-radius: 2px;
    background: linear-gradient(90deg, var(--neon), var(--cyan));
    box-shadow: 0 0 14px rgba(61,240,255,0.5);
  }
</style>
</head>
<body>
  <main class="card">
    <div class="eyebrow">proofofwriting // status</div>
    <h1>Under construction</h1>
    <p>We're putting the finishing touches on something. The site will be live soon — check back shortly.</p>
    <div class="bar"></div>
    <div class="dim">503 · service temporarily unavailable</div>
  </main>
</body>
</html>`
