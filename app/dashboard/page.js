import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import DashboardClient from '@/components/dashboard/DashboardClient'

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const admin = createSupabaseAdminClient()

  const [
    { data: posts, error: postsError },
    { data: author },
    { data: notifications },
    { data: unlockRows },
  ] = await Promise.all([
    supabase
      .from('posts')
      .select('*')
      .eq('author_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('authors')
      .select('username, bio, xec_address')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('notifications')
      .select('id, message, post_id, comment_id, read, created_at, posts(slug, title)')
      .eq('author_id', user.id)
      .eq('read', false)
      .order('created_at', { ascending: false })
      .limit(20),
    admin
      ? admin
          .from('unlocks')
          .select('amount_xec, post_id, posts!inner(author_id, legacy)')
          .eq('posts.author_id', user.id)
          .eq('posts.legacy', false)
      : Promise.resolve({ data: null }),
  ])

  const rows = unlockRows ?? []
  let totalXec = 0
  for (const r of rows) {
    const s = Number(r.amount_xec)
    if (Number.isFinite(s)) totalXec += s
  }

  return (
    <DashboardClient
      email={user.email ?? ''}
      username={author?.username ?? ''}
      bio={author?.bio ?? ''}
      xecAddress={author?.xec_address ?? ''}
      notifications={notifications ?? []}
      initialPosts={posts ?? []}
      loadError={postsError?.message ?? null}
      initialTotalUnlocks={rows.length}
      initialTotalXecRaw={totalXec}
    />
  )
}