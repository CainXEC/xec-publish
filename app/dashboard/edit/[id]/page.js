import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import NewPostForm from '@/components/dashboard/NewPostForm'

export default async function EditPostPage({ params }) {
  const resolved = await params
  const postId = typeof resolved?.id === 'string' ? resolved.id : ''

  if (!postId) {
    return (
      <div className="flex min-h-full flex-1 flex-col bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
        <main className="mx-auto w-full max-w-2xl">
          <Link
            href="/dashboard"
            className="text-sm font-medium text-zinc-700 underline dark:text-zinc-300"
          >
            ← Back to dashboard
          </Link>
          <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Post not found</h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              This post does not exist or you do not have permission to edit it.
            </p>
          </div>
        </main>
      </div>
    )
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: post, error: postError } = await supabase
    .from('posts')
    .select(
      'id, title, slug, teaser, body, price_xec, published, published_at, author_id, publish_paid',
    )
    .eq('id', postId)
    .eq('author_id', user.id)
    .maybeSingle()

  if (postError) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-zinc-950">
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
    )
  }

  if (!post) {
    return (
      <div className="flex min-h-full flex-1 flex-col bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
        <main className="mx-auto w-full max-w-2xl">
          <Link
            href="/dashboard"
            className="text-sm font-medium text-zinc-700 underline dark:text-zinc-300"
          >
            ← Back to dashboard
          </Link>
          <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Post not found</h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              This post does not exist or you do not have permission to edit it.
            </p>
          </div>
        </main>
      </div>
    )
  }

  return <NewPostForm existingPost={post} />
}
