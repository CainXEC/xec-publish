'use client'

import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="mt-auto border-t-[0.5px] border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-5xl items-center justify-center gap-4 px-4 py-6 sm:gap-6 sm:px-6">
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
