'use client'

import Nav from '@/components/Nav'

const faqItems = [
  {
    q: 'How do I unlock an article?',
    a: 'Click the pay button on any article, and your Cashtab wallet will open with the payment pre-filled. Once you confirm the transaction, the article will unlock automatically within a few seconds.',
  },
  {
    q: 'What wallet do I need?',
    a: (
      <>
        You need a Cashtab wallet. You can create one for free at{' '}
        <a
          href="https://cashtab.com"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
        >
          cashtab.com
        </a>
        . Make sure you have some XEC in your wallet before attempting to unlock an article.
      </>
    ),
  },
  {
    q: "I paid but the article didn't unlock — what do I do?",
    a: (
      <>
        Reach out on{' '}
        <a
          href="https://t.me/proofofwriting"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
        >
          Telegram
        </a>{' '}
        or{' '}
        <a
          href="https://x.com/ProofofWriting"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
        >
          X
        </a>{' '}
        and we&apos;ll make it right.
      </>
    ),
  },
  {
    q: 'How do I sign up as an author?',
    a: `Click "Start Writing" on the homepage and create an account with your email address. You'll also need an eCash wallet address to receive payments.`,
  },
  {
    q: 'How do I get paid?',
    a: "Payments go directly to your XEC wallet address — we never touch your funds. Make sure your wallet address is correctly set in your profile settings. You receive 94% of every unlock.",
  },
  {
    q: 'What is the 6% fee for?',
    a: 'The 6% platform fee covers the cost of running and maintaining Proof Of Writing.',
  },
  {
    q: 'Is my personal information safe?',
    a: "Readers don't need to create an account or provide any personal information. Authors only need an email address to sign up.",
  },
]

export default function SupportPage() {
  return (
    <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
      <Nav />
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
        <section className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-10">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
            Support
          </h1>

          <div className="mt-8">
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">FAQ</h2>
            <dl className="mt-6 space-y-8">
              {faqItems.map((item) => (
                <div key={item.q}>
                  <dt className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                    {item.q}
                  </dt>
                  <dd className="mt-2 text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
                    {item.a}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="mt-10 border-t border-zinc-200 pt-8 dark:border-zinc-700">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Still need help?
            </h2>
            <p className="mt-2 text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
              Contact us on{' '}
              <a
                href="https://t.me/proofofwriting"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
              >
                Telegram
              </a>
              .
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}
