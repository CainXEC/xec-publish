import Link from 'next/link'
import { redirect } from 'next/navigation'
import Nav from '@/components/Nav'
import NewPostForm from '@/components/dashboard/NewPostForm'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthedAccount } from '@/lib/authHelpers'

export default async function EditPostPage({ params }) {
  const resolved = await params
  const postId = typeof resolved?.id === 'string' ? resolved.id : ''

  if (!postId) {
    return (
      <div className="flex min-h-full flex-1 flex-col bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
        <Nav />
        <main className="mx-auto w-full max-w-2xl">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Post not found</h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              This post does not exist or you do not have permission to edit it.
            </p>
          </div>
        </main>
      </div>
    )
  }

  const acct = await getAuthedAccount()
  if (!acct?.authorId) {
    redirect('/login')
  }

  const supabase = createSupabaseAdminClient()
  const { data: post, error: postError } = await supabase
    .from('posts')
    .select(
      'id, title, slug, teaser, body, price_xec, published, published_at, author_id, publish_paid',
    )
    .eq('id', postId)
    .eq('author_id', acct.authorId)
    .maybeSingle()

  if (postError) {
    return (
      <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
        <Nav />
        <div className="flex flex-1 items-center justify-center px-4 py-16">
          <div className="w-full max-w-xl rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-red-600 dark:text-red-400">{postError.message}</p>
            <Link
              href="/login"
              className="mt-4 inline-block text-sm font-medium text-zinc-900 underline dark:text-zinc-200"
            >
              Go to login
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!post) {
    return (
      <div className="flex min-h-full flex-1 flex-col bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
        <Nav />
        <main className="mx-auto w-full max-w-2xl">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Post not found</h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              This post does not exist or you do not have permission to edit it.
            </p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
      <Nav />
      <NewPostForm existingPost={post} />
    </div>
  )
}
