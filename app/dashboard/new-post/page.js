import { redirect } from 'next/navigation'
import Nav from '@/components/Nav'
import NewPostForm from '@/components/dashboard/NewPostForm'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export default async function NewPostPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
      <Nav />
      <NewPostForm />
    </div>
  )
}
