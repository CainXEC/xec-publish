import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import ArticleAudioPlayer from '@/components/ArticleAudioPlayer'
import Nav from '@/components/Nav'
import { isAudioStale } from '@/lib/audioConfig'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { publishDraftPost } from './actions'

function authorFromPost(post) {
  const a = post.authors
  if (!a) return null
  return Array.isArray(a) ? a[0] ?? null : a
}

export default async function DraftPreviewPage({ params }) {
  const { id: rawId } = await params
  const id = typeof rawId === 'string' ? rawId.trim() : ''
  if (!id) {
    notFound()
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: post, error } = await supabase
    .from('posts')
    .select(
      'id, title, slug, teaser, body, created_at, author_id, audio_url, audio_source_hash, authors(username)',
    )
    .eq('id', id)
    .eq('author_id', user.id)
    .maybeSingle()

  if (error || !post) {
    notFound()
  }

  if (post.published) {
    notFound()
  }

  const author = authorFromPost(post)
  const username = author?.username?.trim()
  const bodyHtml = typeof post.body === 'string' ? post.body : ''
  const audioUrl = typeof post.audio_url === 'string' ? post.audio_url.trim() : ''
  const audioIsStale = isAudioStale(post.body, post.audio_source_hash)

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <Nav />
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/50">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
            Preview — this post is not yet published
          </p>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Link
              href="/dashboard"
              className="text-sm font-medium text-amber-900 underline-offset-2 hover:underline dark:text-amber-100"
            >
              ← Back to dashboard
            </Link>
            <form action={publishDraftPost}>
              <input type="hidden" name="postId" value={post.id} />
              <button
                type="submit"
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-500 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400"
              >
                Publish
              </button>
            </form>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <article className="overflow-hidden rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="font-article-title text-3xl font-semibold leading-tight text-zinc-900 dark:text-zinc-50">
            {post.title}
            {audioUrl ? (
              <span
                className="ml-2 align-middle text-2xl"
                title="Audio narration available"
                aria-label="Audio narration available"
              >
                🎧
              </span>
            ) : null}
          </h1>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            By{' '}
            {username ? (
              <Link
                href={`/u/${encodeURIComponent(username)}`}
                className="font-medium text-emerald-700 hover:text-emerald-800 underline-offset-2 hover:underline dark:text-emerald-400 dark:hover:text-emerald-300"
              >
                @{username}
              </Link>
            ) : (
              'Unknown author'
            )}
          </p>

          {audioUrl ? (
            <div className="mt-4 mb-4">
              <ArticleAudioPlayer postId={post.id} isStale={audioIsStale} />
            </div>
          ) : null}

          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Preview
            </h2>
            <p className="mt-2 break-words whitespace-pre-wrap text-base leading-7 text-zinc-800 dark:text-zinc-200">
              {post.teaser}
            </p>
          </section>

          <section className="mt-10 border-t border-zinc-200 pt-8 dark:border-zinc-700">
            <div
              className="prose prose-zinc dark:prose-invert max-w-none text-base"
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          </section>
        </article>
      </main>
    </div>
  )
}
