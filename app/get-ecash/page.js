import Link from 'next/link'
import Nav from '@/components/Nav'

export const metadata = {
  title: 'Get eCash',
  description:
    'Simple steps to get a wallet, buy XEC, and unlock articles on Proof Of Writing.',
}

const linkClass =
  'font-medium text-emerald-700 underline-offset-2 transition hover:underline dark:text-emerald-400'

function StepCard({ number, title, children }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white dark:bg-emerald-500 dark:text-emerald-950"
          aria-hidden
        >
          {number}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 sm:text-2xl">
            {title}
          </h2>
          <div className="mt-3 space-y-3 text-base leading-relaxed text-zinc-700 dark:text-zinc-300">
            {children}
          </div>
        </div>
      </div>
    </section>
  )
}

export default function GetEcashPage() {
  return (
    <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
      <Nav />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="mb-10">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
            Get eCash (XEC)
          </h1>
          <p className="mt-4 text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
            New to crypto? No problem. eCash (ticker{' '}
            <span className="font-medium text-zinc-800 dark:text-zinc-200">XEC</span>) is what you
            use to unlock stories here. Follow these three steps and you&apos;ll be reading in no
            time.
          </p>
        </header>

        <div className="flex flex-col gap-6">
          <StepCard number={1} title="Get a wallet">
            <p>
              A wallet is a free app or website that holds your XEC. Pick whichever feels easier —
              you can always try the other one later.
            </p>
            <ul className="list-inside list-disc space-y-2 pl-1">
              <li>
                <a
                  href="https://cashtab.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClass}
                >
                  Cashtab
                </a>{' '}
                — works in your browser. Great if you want the quickest start.
              </li>
              <li>
                For a list of all available eCash wallets, visit{' '}
                <a
                  href="https://e.cash/wallets"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClass}
                >
                  e.cash/wallets
                </a>
                .
              </li>
            </ul>
          </StepCard>

          <StepCard number={2} title="Buy some XEC">
            <p>
              Once you have a wallet, you&apos;ll need a small amount of XEC inside it. You can buy
              XEC from an exchange — create an account there, purchase XEC, then send it to the
              address your wallet shows you (copy and paste carefully).
            </p>
            <p className="font-medium text-zinc-800 dark:text-zinc-200">Popular options:</p>
            <ul className="list-inside list-disc space-y-2 pl-1">
              <li>
                <a
                  href="https://www.coinex.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClass}
                >
                  CoinEx
                </a>
              </li>
              <li>
                <a
                  href="https://uphold.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClass}
                >
                  Uphold
                </a>
              </li>
            </ul>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Every exchange looks a bit different; if you get stuck, their help pages or support
              can walk you through buying and withdrawing XEC.
            </p>
          </StepCard>

          <StepCard number={3} title="Come back and unlock">
            <p>
              When your wallet has XEC, you&apos;re ready. Open any article on Proof Of Writing, use
              the pay button to send a tiny payment from your wallet, and the full story unlocks
              automatically after a few seconds.
            </p>
            <p>
              If we ask for your wallet address on an article page, paste the receive address from
              your wallet — that helps us know you&apos;ve paid so we can show you the unlocked
              content.
            </p>
            <p>
              <Link
                href="/"
                className={linkClass}
              >
                Back to the homepage
              </Link>{' '}
              to browse stories, or visit{' '}
              <Link
                href="/support"
                className={linkClass}
              >
                Support
              </Link>{' '}
              if something doesn&apos;t work the way you expect.
            </p>
          </StepCard>
        </div>
      </main>
    </div>
  )
}
