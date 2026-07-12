import { redirect } from 'next/navigation'
import NewPostForm from '@/components/dashboard/NewPostForm'
import { getAuthedAccount } from '@/lib/authHelpers'
import { getWriteSidebarData } from '@/lib/getWriteSidebarData'

export default async function NewPostPage() {
  const acct = await getAuthedAccount()
  if (!acct?.authorId) {
    redirect('/login')
  }

  const sidebar = await getWriteSidebarData({
    authorId: acct.authorId,
    accountId: acct.accountId,
  })
  const identity = acct.handle ? `@${acct.handle}` : acct.address

  return (
    <NewPostForm
      sidebar={sidebar}
      identity={identity}
      handleColor={acct.handle ? acct.handleColor : null}
    />
  )
}
