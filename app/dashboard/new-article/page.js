import { redirect } from 'next/navigation'
import NewPostForm from '@/components/dashboard/NewPostForm'
import { getAuthedAccount } from '@/lib/authHelpers'

export default async function NewPostPage() {
  const acct = await getAuthedAccount()
  if (!acct?.authorId) {
    redirect('/login')
  }

  return <NewPostForm />
}
