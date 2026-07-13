import LiveClient from '@/components/feed/LiveClient'
import { getAuthedAccount } from '@/lib/authHelpers'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Live on eCash — proofofwriting',
}

export default async function LivePage() {
  const acct = await getAuthedAccount()
  return <LiveClient signedIn={acct != null} isAuthor={acct?.authorId != null} />
}
