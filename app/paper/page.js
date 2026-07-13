import PaperClient from '@/components/feed/PaperClient'
import { getAuthedAccount } from '@/lib/authHelpers'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'The Front Page — proofofwriting',
}

export default async function PaperPage() {
  const acct = await getAuthedAccount()
  return <PaperClient signedIn={acct != null} isAuthor={acct?.authorId != null} />
}
