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

  const { data: notifications } = await supabase
    .from('notifications')
    .select('id, message, post_id, comment_id, read, created_at, posts(slug, title)')
    .eq('author_id', user.id)
    .eq('read', false)
    .order('created_at', { ascending: false })
    .limit(20)

  return (
    <DashboardClient
      email={user.email ?? ''}
      username={author?.username ?? ''}
      bio={author?.bio ?? ''}
      xecAddress={author?.xec_address ?? ''}
      notifications={notifications ?? []}
      initialPosts={posts ?? []}
      loadError={postsError?.message ?? null}
    />
  )
}
