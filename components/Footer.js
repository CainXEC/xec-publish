import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-zinc-200/80 dark:border-zinc-800">
      <div className="mx-auto max-w-5xl px-4 py-5 text-center text-sm text-zinc-500 dark:text-zinc-400 sm:px-6">
        <Link
          href="/about"
          className="transition hover:text-zinc-700 hover:underline dark:hover:text-zinc-200"
        >
          About
        </Link>{' '}
        |{' '}
        <Link
          href="/support"
          className="transition hover:text-zinc-700 hover:underline dark:hover:text-zinc-200"
        >
          Support
        </Link>{' '}
        |{' '}
        <Link
          href="/leaderboard"
          className="transition hover:text-zinc-700 hover:underline dark:hover:text-zinc-200"
        >
          Leaderboard
        </Link>{' '}
        |{' '}
        <Link
          href="/get-ecash"
          className="transition hover:text-zinc-700 hover:underline dark:hover:text-zinc-200"
        >
          Get eCash
        </Link>
      </div>
    </footer>
  )
}
