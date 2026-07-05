'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// The cypherpunk-neon pages (feed, profiles, article lists, mint) take over the
// full viewport with their own scoped theme, so the global footer is hidden on
// them. Everything else (dashboard, article reader, about, etc.) keeps it.
const NEON_PREFIXES = ['/profile', '/feed', '/mint', '/marketplace', '/dashboard']

export default function Footer() {
  const pathname = usePathname()
  if (pathname === '/') return null
  if (pathname.startsWith('/@')) return null // pretty profile + article-list URLs
  if (NEON_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return null
  }

  return (
    <footer className="border-t-[0.5px] border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-5xl items-center justify-center gap-4 px-4 py-6 sm:gap-6 sm:px-6">
        <Link
          href="/marketplace"
          className="text-[13px] text-zinc-500 transition hover:underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          Marketplace
        </Link>
        <Link
          href="/leaderboard"
          className="text-[13px] text-zinc-500 transition hover:underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          Leaderboard
        </Link>
        <Link
          href="/about"
          className="text-[13px] text-zinc-500 transition hover:underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          About
        </Link>
        <Link
          href="/how-it-works"
          className="text-[13px] text-zinc-500 transition hover:underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          How it works
        </Link>
      </div>
    </footer>
  )
}
