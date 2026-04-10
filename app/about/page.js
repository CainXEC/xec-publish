'use client'

import Link from 'next/link'
import Nav from '@/components/Nav'

export default function AboutPage() {
  return (
    <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
      <Nav />
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
        <section className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-10">
          <h1
            className="text-3xl sm:text-4xl"
            style={{ fontWeight: 700, letterSpacing: '-0.02em' }}
          >
            <span style={{ color: '#1D9E75' }}>About Proof Of </span>
            <span style={{ color: 'var(--color-text-primary)' }}>Writing</span>
          </h1>
          <div className="mt-5 space-y-4 text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
            <p>
              Proof Of Writing is a writing app that runs on crypto rails. All you need is an email
              address to sign up to publish and an eCash wallet to receive payments and pay for
              content.
            </p>
            <p>
              Proof Of Writing never touches your funds and only charges a 6% platform fee. By
              comparison, Substack charges 10% plus an additional 3-6% for credit card processing.
            </p>
            <p>
              By leveraging the eCash network, authors can charge as little or as much as they want
              for each article while keeping a greater percentage of their revenue.
            </p>
          </div>
          <div className="mt-8">
            <Link
              href="/login"
              className="inline-flex rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400"
            >
              Start Writing
            </Link>
          </div>
        </section>
      </main>
    </div>
  )
}
