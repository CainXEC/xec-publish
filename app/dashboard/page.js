import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import DashboardClient from '@/components/dashboard/DashboardClient'

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: posts, error: postsError } = await supabase
    .from('posts')
    .select('*')
    .eq('author_id', user.id)
    .order('created_at', { ascending: false })

  const { data: author } = await supabase
    .from('authors')
    .select('username, bio, xec_address')
    .eq('id', user.id)
    .maybeSingle()

  return (
    <DashboardClient
      email={user.email ?? ''}
      username={author?.username ?? ''}
      bio={author?.bio ?? ''}
      xecAddress={author?.xec_address ?? ''}
      initialPosts={posts ?? []}
      loadError={postsError?.message ?? null}
    />
  )
}
