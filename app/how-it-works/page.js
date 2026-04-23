import Nav from '@/components/Nav'

export const metadata = {
  title: 'How it works · Proof of Writing',
  description: 'Everything you need to read or write on Proof of Writing.',
}

const WORDMARK_FONT_FAMILY = "'American Typewriter', serif"

const readersSteps = [
  {
    num: '01',
    title: 'Get a Cashtab wallet',
    body: 'Cashtab is a free web wallet that holds and transacts XEC. It works in any browser and is the fastest way to create an eCash wallet.',
    linkHref: 'https://cashtab.com',
    linkLabel: 'Get Cashtab wallet →',
  },
  {
    num: '02',
    title: 'Buy some XEC',
    body: "Once you have a wallet, you'll need a small amount of XEC inside it. Buy XEC from an exchange — create an account, purchase XEC, then send it to your wallet address (copy and paste carefully).",
    linkHref: 'https://scorecard.cash',
    linkLabel: 'Find exchanges on scorecard.cash →',
  },
  {
    num: '03',
    title: 'Come back and unlock',
    body: "Open any article on Proof of Writing, use the pay button to send the payment from your wallet, and the full story unlocks automatically after a few seconds. You can also click Reader login to send a dust transaction from your wallet so the site remembers which articles you've already unlocked.",
  },
]

const readerFaqItems = [
  {
    q: 'What is eCash (XEC)?',
    a: 'eCash is a fast, low-fee digital cash. Its ticker is XEC. On Proof of Writing, readers send small amounts of XEC to writers to unlock their stories. Transactions confirm in seconds and cost a fraction of a cent.',
  },
  {
    q: 'How do I unlock an article?',
    a: 'Click the pay button on any article and your Cashtab wallet will open with the payment pre-filled. Once you confirm the transaction, the article unlocks automatically within a few seconds.',
  },
  {
    q: "What's the minimum unlock price?",
    a: '100 XEC. Writers can charge more, but never less.',
  },
  {
    q: 'How long does an unlocked article stay unlocked?',
    a: 'Permanently. Once your wallet has paid for an article, you can come back and read it any time.',
  },
  {
    q: 'What wallet do I need?',
    a: 'A Cashtab wallet. You can create one for free at cashtab.com. Make sure you have some XEC in your wallet before attempting to unlock an article.',
  },
  {
    q: 'What if I lose access to my wallet?',
    a: "Your wallet is yours alone — Proof of Writing never holds your funds and can't recover a lost wallet. Always back up your Cashtab seed phrase somewhere safe. If you lose your wallet, you lose access to its funds and to the articles unlocked under that wallet.",
  },
  {
    q: 'Why eCash and not Bitcoin or a stablecoin?',
    a: 'eCash is fast (1-second confirmations) and cheap (sub-cent fees), which makes microtransactions practical. Most other chains either cost too much or settle too slowly for unlocking a 50-cent article.',
  },
  {
    q: "I paid but the article didn't unlock — what do I do?",
    a: "Reach out on Telegram or X and we'll make it right.",
  },
  {
    q: 'Is my personal information safe?',
    a: "Readers don't need an account or any personal information. You only need a wallet.",
  },
]

const writerSteps = [
  {
    num: '01',
    title: 'Sign up with email',
    body: "Click Start writing on the homepage and create an account with your email address. That's all the personal info we collect.",
  },
  {
    num: '02',
    title: 'Set your wallet for payouts',
    body: 'Add your XEC wallet address in your profile settings. This is where every unlock payment goes — directly, instantly, no platform middleman.',
  },
  {
    num: '03',
    title: 'Publish and set your price',
    body: 'Write your post, set an unlock price (minimum 100 XEC), and publish. Readers send XEC to unlock. You keep 94% of every payment.',
  },
]

const writerFaqItems = [
  {
    q: 'How do I sign up as a writer?',
    a: "Click Start writing on the homepage and create an account with your email. You'll also need an eCash wallet address to receive payments.",
  },
  {
    q: 'How do I get paid?',
    a: 'Payments go directly to your XEC wallet — Proof of Writing never touches your funds. Make sure your wallet address is set correctly in your profile settings. You receive 94% of every unlock.',
  },
  {
    q: 'What is the 6% platform fee for?',
    a: 'The 6% covers the cost of running and maintaining Proof of Writing — hosting, development, and support.',
  },
  {
    q: 'Can I edit a post after publishing?',
    a: 'Yes. You can edit any of your published posts at any time from your dashboard.',
  },
  {
    q: 'Is there a minimum unlock price?',
    a: 'Yes — 100 XEC. You can charge more, but the floor is 100 XEC per unlock.',
  },
]

function ChevronRight() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-150 group-open:rotate-90 dark:text-zinc-400"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M6 3.5L10.5 8L6 12.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function StepCard({ step }) {
  return (
    <article className="rounded-md bg-zinc-100 px-5 py-4 dark:bg-zinc-900/80">
      <p className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">{step.num}</p>
      <h3 className="mt-1 text-base font-medium text-zinc-900 dark:text-zinc-100">{step.title}</h3>
      <p className="mt-1.5 text-[13px] leading-[1.5] text-zinc-600 dark:text-zinc-400">
        {step.body}
      </p>
      {step.linkHref ? (
        <p className="mt-3 text-sm">
          <a
            href={step.linkHref}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-emerald-700 underline-offset-2 transition hover:underline dark:text-emerald-400"
          >
            {step.linkLabel}
          </a>
        </p>
      ) : null}
    </article>
  )
}

function FaqList({ items }) {
  return (
    <div className="rounded-md border-[0.5px] border-zinc-200 bg-transparent dark:border-zinc-800">
      {items.map((item, idx) => (
        <details
          key={item.q}
          className={`group ${idx === items.length - 1 ? '' : 'border-b-[0.5px] border-zinc-200 dark:border-zinc-800'}`}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-zinc-900 marker:content-none dark:text-zinc-100">
            <span>{item.q}</span>
            <ChevronRight />
          </summary>
          <div className="px-4 pb-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {item.a}
          </div>
        </details>
      ))}
    </div>
  )
}

export default function HowItWorksPage() {
  return (
    <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
      <Nav />
      <main className="mx-auto max-w-[720px] px-4 pt-8 pb-6 sm:px-6">
        <header className="text-center">
          <h1
            className="text-[clamp(2rem,5vw,3.25rem)] tracking-tight text-zinc-900 dark:text-zinc-50"
            style={{ fontFamily: WORDMARK_FONT_FAMILY, fontWeight: 500, lineHeight: 1.1 }}
          >
            How it works
          </h1>
          <p className="mt-3 text-base text-zinc-600 dark:text-zinc-400">
            Everything you need to read or write on Proof of Writing.
          </p>
        </header>

        <section className="mt-12">
          <h2
            className="text-[28px] text-zinc-900 dark:text-zinc-50"
            style={{ fontFamily: WORDMARK_FONT_FAMILY, fontWeight: 500, lineHeight: 1.1 }}
          >
            For readers
          </h2>
          <div className="mt-4 flex flex-col gap-4">
            {readersSteps.map((step) => (
              <StepCard key={step.num} step={step} />
            ))}
          </div>
        </section>

        <section className="mt-12">
          <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Reader FAQ</h3>
          <div className="mt-4">
            <FaqList items={readerFaqItems} />
          </div>
        </section>

        <section className="mt-12">
          <h2
            className="text-[28px] text-zinc-900 dark:text-zinc-50"
            style={{ fontFamily: WORDMARK_FONT_FAMILY, fontWeight: 500, lineHeight: 1.1 }}
          >
            For writers
          </h2>
          <div className="mt-4 flex flex-col gap-4">
            {writerSteps.map((step) => (
              <StepCard key={step.num} step={step} />
            ))}
          </div>
        </section>

        <section className="mt-12">
          <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Writer FAQ</h3>
          <div className="mt-4">
            <FaqList items={writerFaqItems} />
          </div>
        </section>

        <section className="mt-12 rounded-md bg-zinc-100 px-6 py-6 text-center dark:bg-zinc-900/80">
          <h3 className="text-base font-medium text-zinc-900 dark:text-zinc-100">Still need help?</h3>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Reach us on{' '}
            <a
              href="https://t.me/proofofwriting"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-emerald-700 underline-offset-2 transition hover:underline dark:text-emerald-400"
            >
              Telegram
            </a>{' '}
            or{' '}
            <a
              href="https://x.com/ProofofWriting"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-emerald-700 underline-offset-2 transition hover:underline dark:text-emerald-400"
            >
              X
            </a>{' '}
            — we usually respond within a day.
          </p>
        </section>
      </main>
    </div>
  )
}
