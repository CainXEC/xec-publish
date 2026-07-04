import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import Nav from '@/components/Nav'
import DashboardClient from '@/components/dashboard/DashboardClient'
import { isAudioStale } from '@/lib/audioConfig'
import { getAuthedAccount } from '@/lib/authHelpers'
export default async function DashboardPage() {
  const acct = await getAuthedAccount()
  if (!acct?.authorId) {
    redirect('/login')
  }
  const authorId = acct.authorId
  const admin = createSupabaseAdminClient()
  const supabase = admin // all queries below run on the service-role client now
  const [
    { data: posts, error: postsError },
    { data: author },
    { data: notifications },
    { data: unlockRows },
  ] = await Promise.all([
    supabase
      .from('posts')
      .select('*')
      .eq('author_id', authorId)
      .order('published', { ascending: true })
      .order('created_at', { ascending: false }),
    supabase
      .from('authors')
      .select('username, bio, xec_address')
      .eq('id', authorId)
      .maybeSingle(),
    supabase
      .from('notifications')
      .select('id, message, post_id, comment_id, read, created_at, posts(slug, title, legacy)')
      .eq('author_id', authorId)
      .eq('read', false)
      .order('created_at', { ascending: false })
      .limit(20),
    admin
      ? admin
          .from('unlocks')
          .select('amount_xec, post_id, posts!inner(author_id)')
          .eq('posts.author_id', authorId)
          .eq('posts.published', true)
      : Promise.resolve({ data: null }),
  ])
  const rows = unlockRows ?? []
  const postsWithAudioStale = (posts ?? []).map((post) => ({
    ...post,
    is_audio_stale: isAudioStale(post.body, post.audio_source_hash),
  }))
  let totalXec = 0
  for (const r of rows) {
    const s = Number(r.amount_xec)
    if (Number.isFinite(s)) totalXec += s
  }
  return (
    <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
      <Nav authorCtaOverride="logout" />
      <DashboardClient
        username={author?.username ?? ''}
        bio={author?.bio ?? ''}
        xecAddress={author?.xec_address ?? ''}
        notifications={notifications ?? []}
        initialPosts={postsWithAudioStale}
        loadError={postsError?.message ?? null}
        initialTotalUnlocks={rows.length}
        initialTotalXecRaw={totalXec}
      />
    </div>
  )
}
