import { getAuthedAccount } from '@/lib/authHelpers'
import { FEED_CSS } from '@/components/feed/feedTheme'
import FeedTopbar from '@/components/feed/FeedTopbar'
import PocketPanel from '@/components/pocket/PocketPanel'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Pocket — proofofwriting',
  description:
    'Your spending balance: one-tap likes, replies, unlocks and comments — non-custodial, derived from your own wallet signature.',
}

// A route, not a modal: the setup ceremony hops to a Cashtab tab and back,
// survives refresh, and is deep-linkable from error copy.
export default async function PocketPage() {
  const acct = await getAuthedAccount()
  return (
    <div className="pow-feed">
      <style>{FEED_CSS}</style>
      <FeedTopbar signedIn={acct != null} isAuthor={Boolean(acct?.authorId)} />
      <main className="wrap" style={{ paddingTop: '28px' }}>
        <PocketPanel />
      </main>
    </div>
  )
}
