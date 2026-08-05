'use client'

import { useEffect } from 'react'
import Link from 'next/link'

// Route-level boundary: catches render errors under the root layout so a
// crash anywhere in the app shows this instead of falling through to
// Next's unstyled default screen. Logs the digest so crashes are at least
// traceable in Vercel's server logs / browser console, not silent.
export default function Error({ error, reset }) {
  useEffect(() => {
    console.error('[app/error]', error?.digest ?? '', error)
  }, [error])

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-mono text-sm opacity-60">Something went wrong.</p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded border border-current/30 px-4 py-2 font-mono text-sm hover:opacity-80"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded border border-current/30 px-4 py-2 font-mono text-sm hover:opacity-80"
        >
          Go home
        </Link>
      </div>
      {error?.digest ? (
        <p className="font-mono text-xs opacity-40">ref: {error.digest}</p>
      ) : null}
    </div>
  )
}
