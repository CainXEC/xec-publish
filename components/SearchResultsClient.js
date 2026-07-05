'use client'

import Link from 'next/link'
import Nav from '@/components/Nav'
import { formatReadingTimeLabel } from '@/lib/getReadingTime'

const PAGE_SIZE = 25

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

function authorFromPost(post) {
  const a = post.authors
  if (!a) return null
  return Array.isArray(a) ? a[0] ?? null : a
}

function truncateTeaserPreview(text, maxLen = 500) {
  const s = text != null ? String(text) : ''
  if (s.length <= maxLen) return s
  return `${s.slice(0, maxLen)}...`
}

function buildSearchHref(query, page) {
  const p = new URLSearchParams({ q: query })
  if (page > 1) p.set('page', String(page))
  return `/search?${p.toString()}`
}

export default function SearchResultsClient({
  query,
  posts,
  page,
  hasNextPage,
  total,
}) {
  const safePage = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : 1
  const hasPrevPage = safePage > 1
  const start = total > 0 ? (safePage - 1) * PAGE_SIZE + 1 : 0
  const end = total > 0 ? Math.min(total, start + Math.max(posts.length, 1) - 1) : 0

  return (
    <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
      <Nav showPostSearch />
      <main className="mx-auto max-w-5xl px-4 pt-6 pb-6 sm:px-6 sm:pb-6">
        <section className="mb-4">
          <h1 className="font-article-title text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-50">
            Search results for "{query.trim()}"
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {total} {total === 1 ? 'match' : 'matches'}
            {total > 0 ? ` • showing ${start}-${end}` : ''}
          </p>
        </section>

        {total === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-8 py-12 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
            <p className="text-base text-zinc-700 dark:text-zinc-300">
              No posts found matching "{query.trim()}". Try a different search.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5 md:gap-2">
            {posts.map((post) => {
              const author = authorFromPost(post)
              const displayHandle = post.display_handle?.trim() || ''
              const username = author?.username?.trim() || 'Unknown'
              const bylineName = displayHandle || username
              const bylineHref = displayHandle
                ? `/@${displayHandle}`
                : `/u/${encodeURIComponent(username)}`
              const postHref = `/posts/${encodeURIComponent(post.slug)}`
              const priceLabel = formatXec(post.price_xec)
              const unlocksN = post.unlockCount ?? 0
              const commentsN = post.commentCount ?? 0
              const unlockStat = unlocksN === 1 ? '🔓 1 unlock' : `🔓 ${unlocksN} unlocks`
              const commentStat =
                commentsN === 1 ? '💬 1 comment' : `💬 ${commentsN} comments`
              const readTime = formatReadingTimeLabel(post.reading_time_minutes)
              return (
                <li key={post.id}>
                  <div className="relative block cursor-pointer overflow-hidden rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition-[box-shadow,border-color] duration-200 hover:border-zinc-400 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-500 dark:hover:shadow-lg/20">
                    <h2 className="font-article-title text-xl font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
                      <Link
                        prefetch={false}
                        href={postHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-sm text-inherit after:absolute after:inset-0 after:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950"
                      >
                        {post.title}
                      </Link>
                    </h2>
                    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
                      <Link
                        href={bylineHref}
                        className="relative z-10 font-medium text-emerald-700 hover:text-emerald-800 underline-offset-2 hover:underline dark:text-emerald-400 dark:hover:text-emerald-300"
                      >
                        {bylineName}
                      </Link>
                      <span aria-hidden className="text-zinc-300 dark:text-zinc-600">
                        ·
                      </span>
                      <time dateTime={(post.published_at ?? post.created_at) ?? undefined}>
                        {formatPublishedDate(post.published_at ?? post.created_at)}
                      </time>
                    </p>
                    <p className="mt-4 break-words line-clamp-4 overflow-hidden text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
                      {truncateTeaserPreview(post.teaser)}
                    </p>
                    <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      <span>{priceLabel} XEC</span>
                      <span className="font-normal text-zinc-600 dark:text-zinc-400">
                        {unlockStat}
                      </span>
                      <span className="font-normal text-zinc-600 dark:text-zinc-400">
                        {commentStat}
                      </span>
                      {readTime ? (
                        <span className="font-normal text-zinc-600 dark:text-zinc-400">
                          {readTime}
                        </span>
                      ) : null}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {total > 0 ? (
          <nav
            aria-label="Search pagination"
            className="mt-2 flex items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-500"
          >
            <div className="min-w-0 flex-1">
              {hasPrevPage ? (
                <Link
                  href={buildSearchHref(query, safePage - 1)}
                  className="inline-block cursor-pointer p-0 text-left font-normal text-inherit underline-offset-2 transition hover:text-zinc-700 hover:underline focus:outline-none focus-visible:underline dark:hover:text-zinc-300"
                >
                  ← Page {safePage - 1}
                </Link>
              ) : (
                <span className="opacity-40">← Previous</span>
              )}
            </div>
            <div className="min-w-0 flex-1 text-right">
              {hasNextPage ? (
                <Link
                  href={buildSearchHref(query, safePage + 1)}
                  className="inline-block cursor-pointer p-0 text-right font-normal text-inherit underline-offset-2 transition hover:text-zinc-700 hover:underline focus:outline-none focus-visible:underline dark:hover:text-zinc-300"
                >
                  Page {safePage + 1} →
                </Link>
              ) : (
                <span className="opacity-40">Next →</span>
              )}
            </div>
          </nav>
        ) : null}
      </main>
    </div>
  )
}
