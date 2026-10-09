import { redirect } from 'next/navigation'
import NewPostForm from '@/components/dashboard/NewPostForm'
import FeedTopbar from '@/components/feed/FeedTopbar'
import { FEED_CSS } from '@/components/feed/feedTheme'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { formatIdentity } from '@/lib/formatIdentity'
import { getWriteSidebarData } from '@/lib/getWriteSidebarData'
import { restoreArticleBodyForEditing } from '@/lib/articleBodyLinks'

// A neon shell matching the editor's pow-feed theme, for the not-found / error
// states that render instead of the form.
function EditStateShell({ title, message }) {
  return (
    <div className="pow-feed">
      <style>{FEED_CSS}</style>
      <FeedTopbar signedIn isAuthor showLogout marketplaceMobileOnly />
      <main className="wrap" style={{ paddingTop: '28px' }}>
        <section className="dashpanel">
          <h1 className="dashwelcome">{title}</h1>
          <p className="dashbio">{message}</p>
        </section>
      </main>
    </div>
  )
}

export default async function EditPostPage({ params }) {
  const resolved = await params
  const postId = typeof resolved?.id === 'string' ? resolved.id : ''

  if (!postId) {
    return (
      <EditStateShell
        title="Post not found"
        message="This post does not exist or you do not have permission to edit it."
      />
    )
  }

  const acct = await getAuthedAccount()
  if (!acct?.authorId) {
    redirect('/login')
  }

  const supabase = adminDb()
  const { data: post, error: postError } = await supabase
    .from('posts')
    .select(
      'id, title, slug, teaser, body, price_xec, published, published_at, author_id, publish_paid',
    )
    .eq('id', postId)
    .eq('author_id', acct.authorId)
    .maybeSingle()

  if (postError) {
    return <EditStateShell title="Could not load post" message={postError.message} />
  }

  if (!post) {
    return (
      <EditStateShell
        title="Post not found"
        message="This post does not exist or you do not have permission to edit it."
      />
    )
  }

  const sidebar = await getWriteSidebarData({
    authorId: acct.authorId,
    accountId: acct.accountId,
  })
  const identity = formatIdentity(acct.handle, acct.address)

  // Turn any stored YouTube embed back into its watch-URL so the editor keeps it
  // (TipTap has no node for the embed iframe and would otherwise drop it); the
  // publish transform re-embeds it on save.
  const editablePost = { ...post, body: restoreArticleBodyForEditing(post.body) }

  return (
    <NewPostForm
      existingPost={editablePost}
      sidebar={sidebar}
      identity={identity}
      handleColor={acct.handle ? acct.handleColor : null}
    />
  )
}
