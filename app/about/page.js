'use client'

import Link from 'next/link'
import Nav from '@/components/Nav'

const WORDMARK_FONT_FAMILY =
  "'American Typewriter', var(--font-courier-prime), 'Courier New', serif"

export default function AboutPage() {
  return (
    <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
      <Nav />
      <main className="mx-auto max-w-2xl px-4 pt-4 pb-6 sm:px-6 sm:pt-6 sm:pb-6">
        <section>
          <h1
            className="text-[clamp(2rem,5vw,3.25rem)] tracking-tight text-zinc-900 dark:text-zinc-50"
            style={{ fontFamily: WORDMARK_FONT_FAMILY, fontWeight: 500, lineHeight: 1.1 }}
          >
            About Proof of Writing
          </h1>
          <div className="mt-5 space-y-4 text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
            <p>
              Proof Of Writing is a writing app that runs on crypto rails. All you need is an email
              address to sign up as an author, and an eCash wallet to receive payments and pay for
              content.
            </p>
            <p>
              While platforms like Substack charge a 10% fee (plus 3-6% on top for credit card
              processing), Proof of Writing only charges 6% total. In addition, since this platform
              runs on eCash, when a reader sends a transaction, their wallet automatically splits the
              payment between the author&apos;s address and the platform address so Proof of Writing
              never touches your funds. Notably, eCash transaction fees are essentially free.
            </p>
            <p>
              Furthermore, only Proof Of Writing allows users to unlock content on a per article
              basis, not to mention authors can charge as little or as much as they want while keeping
              a greater percentage of their revenue.
            </p>
            <p>
              If you believe in the power of words, and want a world that values substance over slop,
              Proof Of Writing was made for you.
            </p>
          </div>
          <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">
            Want to learn how the platform works?{' '}
            <Link
              href="/how-it-works"
              className="text-zinc-700 underline underline-offset-2 transition-colors hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
            >
              Read How it works →
            </Link>
          </p>
          <p className="mt-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            <a
              href="https://t.me/proofofwriting"
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-zinc-700 hover:underline dark:hover:text-zinc-200"
            >
              Telegram
            </a>{' '}
            |{' '}
            <a
              href="https://x.com/ProofofWriting"
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-zinc-700 hover:underline dark:hover:text-zinc-200"
            >
              X (Twitter)
            </a>
          </p>
        </section>
      </main>
    </div>
  )
}
