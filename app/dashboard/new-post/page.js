import { redirect } from 'next/navigation'
import Nav from '@/components/Nav'
import NewPostForm from '@/components/dashboard/NewPostForm'
import { getAuthedAccount } from '@/lib/authHelpers'

export default async function NewPostPage() {
  const acct = await getAuthedAccount()
  if (!acct?.authorId) {
    redirect('/login')
  }

  return (
    <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
      <Nav />
      <NewPostForm />
    </div>
  )
}