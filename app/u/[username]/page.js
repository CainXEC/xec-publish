import Link from 'next/link'
import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'

function formatXec(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '0'
  return n.toFixed(8).replace(/\.?0+$/, '')
}

function formatPublishedDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function commentCountFromPost(post) {
  const c = post.comments
  if (!c) return 0
  const row = Array.isArray(c) ? c[0] : c
  const count = row?.count
  const n = typeof count === 'number' ? count : Number(count)
  return Number.isFinite(n) ? n : 0
}

export default async function AuthorProfilePage({ params }) {
  const { username: raw } = await params
  if (typeof raw !== 'string' || !raw.trim()) {
    notFound()
  }

  const username = decodeURIComponent(raw.trim())

  const { data: author, error: authorError } = await supabase
    .from('authors')
    .select('id, username, bio')
    .eq('username', username)
    .maybeSingle()

  if (authorError || !author) {
    notFound()
  }

  const { data: posts, error: postsError } = await supabase
    .from('posts')
    .select('id, title, slug, teaser, price_xec, created_at, comments(count)')
    .eq('author_id', author.id)
    .eq('published', true)
    .order('created_at', { ascending: false })

  const postList = postsError ? [] : (posts ?? [])
  const showPostsError = Boolean(postsError)
  const bioText =
    author.bio != null && String(author.bio).trim() !== ''
      ? String(author.bio).trim()
      : ''

  return (
    <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <Link
          href="/"
          className="inline-block text-sm font-medium text-emerald-700 underline-offset-4 hover:underline dark:text-emerald-400"
        >
          ← Back to home
        </Link>

        <header className="mt-8 border-b border-zinc-200 pb-10 dark:border-zinc-800">
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Author
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-5xl">
            @{author.username}
          </h1>
          {bioText ? (
            <p className="mt-6 max-w-2xl whitespace-pre-wrap text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
              {bioText}
            </p>
          ) : null}
        </header>

        <section className="mt-10">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Published posts
          </h2>

          {showPostsError ? (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900/50 dark:bg-red-950/40">
              <p className="text-sm text-red-800 dark:text-red-200">
                {postsError.message}
              </p>
            </div>
          ) : postList.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-8 py-14 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
              <p className="text-base text-zinc-700 dark:text-zinc-300">No posts yet</p>
            </div>
          ) : (
            <ul className="mt-6 flex flex-col gap-6">
              {postList.map((post) => {
                const postHref = `/posts/${encodeURIComponent(post.slug)}`
                const priceLabel = formatXec(post.price_xec)
                const commentsN = commentCountFromPost(post)
                const commentStat =
                  commentsN === 1 ? '💬 1 comment' : `💬 ${commentsN} comments`

                return (
                  <li key={post.id}>
                    <article className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
                      <h3 className="text-xl font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
                        <Link
                          href={postHref}
                          className="transition hover:text-emerald-700 dark:hover:text-emerald-400"
                        >
                          {post.title}
                        </Link>
                      </h3>
                      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                        <time dateTime={post.created_at ?? undefined}>
                          {formatPublishedDate(post.created_at)}
                        </time>
                        <span aria-hidden className="mx-2 text-zinc-300 dark:text-zinc-600">
                          ·
                        </span>
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">
                          {priceLabel} XEC
                        </span>
                        <span aria-hidden className="mx-2 text-zinc-300 dark:text-zinc-600">
                          ·
                        </span>
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">
                          {commentStat}
                        </span>
                      </p>
                      <p className="mt-4 line-clamp-3 text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
                        {post.teaser}
                      </p>
                    </article>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}
