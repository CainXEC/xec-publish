'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Nav from '@/components/Nav'
import { supabase } from '@/lib/supabase-browser'

const AUTHOR_SHARE = 0.94

function formatXec(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '0'
  return n.toFixed(8).replace(/\.?0+$/, '')
}

const sortBtnActive =
  'rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400'
const sortBtnInactive =
  'rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900'

async function fetchUnlocksBatched(postIds) {
  if (postIds.length === 0) return []
  const chunkSize = 500
  const rows = []
  for (let i = 0; i < postIds.length; i += chunkSize) {
    const chunk = postIds.slice(i, i + chunkSize)
    const { data, error } = await supabase
      .from('unlocks')
      .select('post_id, amount_xec')
      .in('post_id', chunk)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
  }
  return rows
}

export default function LeaderboardPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [sortMode, setSortMode] = useState('unlocks')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const { data: posts, error: postsError } = await supabase
        .from('posts')
        .select('id, author_id')
        .eq('published', true)

      if (postsError) throw new Error(postsError.message)

      const postList = posts ?? []
      if (postList.length === 0) {
        setRows([])
        setLoading(false)
        return
      }

      const postById = new Map(postList.map((p) => [p.id, p]))
      const authorIds = [...new Set(postList.map((p) => p.author_id).filter(Boolean))]

      const { data: authors, error: authorsError } = await supabase
        .from('authors')
        .select('id, username')
        .in('id', authorIds)

      if (authorsError) throw new Error(authorsError.message)

      const authorUsername = new Map((authors ?? []).map((a) => [a.id, a.username ?? '']))

      const postCountByAuthor = new Map()
      for (const p of postList) {
        const aid = p.author_id
        if (!aid) continue
        postCountByAuthor.set(aid, (postCountByAuthor.get(aid) || 0) + 1)
      }

      const unlockRows = await fetchUnlocksBatched(postList.map((p) => p.id))
      const unlockCountByAuthor = new Map()
      const rawXecByAuthor = new Map()

      for (const u of unlockRows) {
        const post = postById.get(u.post_id)
        if (!post?.author_id) continue
        const aid = post.author_id
        const amt = Number(u.amount_xec)
        const safeAmt = Number.isFinite(amt) ? amt : 0
        unlockCountByAuthor.set(aid, (unlockCountByAuthor.get(aid) || 0) + 1)
        rawXecByAuthor.set(aid, (rawXecByAuthor.get(aid) || 0) + safeAmt)
      }

      const built = authorIds.map((authorId) => {
        const username = (authorUsername.get(authorId) || '').trim() || 'unknown'
        return {
          authorId,
          username,
          postCount: postCountByAuthor.get(authorId) || 0,
          unlockCount: unlockCountByAuthor.get(authorId) || 0,
          earnedXec: (rawXecByAuthor.get(authorId) || 0) * AUTHOR_SHARE,
        }
      })

      setRows(built)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load leaderboard')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const sortedRows = useMemo(() => {
    const copy = [...rows]
    if (sortMode === 'earned') {
      copy.sort((a, b) => b.earnedXec - a.earnedXec || b.unlockCount - a.unlockCount)
    } else {
      copy.sort((a, b) => b.unlockCount - a.unlockCount || b.earnedXec - a.earnedXec)
    }
    return copy
  }, [rows, sortMode])

  return (
    <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
      <Nav />

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-8 max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
            Author leaderboard
          </h1>
          <p className="mt-3 text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
            Rankings by unlocks or author earnings.
          </p>
        </div>

        <div
          className="mb-6 flex w-full gap-2"
          role="group"
          aria-label="Sort leaderboard"
        >
          <button
            type="button"
            aria-pressed={sortMode === 'unlocks'}
            onClick={() => setSortMode('unlocks')}
            className={`min-w-0 flex-1 text-center ${sortMode === 'unlocks' ? sortBtnActive : sortBtnInactive}`}
          >
            🔓 Most Unlocked
          </button>
          <button
            type="button"
            aria-pressed={sortMode === 'earned'}
            onClick={() => setSortMode('earned')}
            className={`min-w-0 flex-1 text-center ${sortMode === 'earned' ? sortBtnActive : sortBtnInactive}`}
          >
            💰 Most Earned
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading leaderboard…</p>
        ) : loadError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900/50 dark:bg-red-950/40">
            <p className="text-sm text-red-800 dark:text-red-200">{loadError}</p>
          </div>
        ) : sortedRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-8 py-14 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
            <p className="text-base text-zinc-700 dark:text-zinc-300">
              No published posts yet — check back soon.
            </p>
          </div>
        ) : (
          <>
            <div className="md:hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div
                className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.75rem_5.75rem] items-center gap-x-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400"
                role="row"
              >
                <span className="tabular-nums">#</span>
                <span>Author</span>
                <span className="text-right">Posts</span>
                <span className="text-right">
                  {sortMode === 'unlocks' ? 'Unlocks' : 'Earned'}
                </span>
              </div>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {sortedRows.map((row, index) => (
                  <li key={row.authorId} role="row">
                    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.75rem_5.75rem] items-center gap-x-2 px-3 py-2.5 text-sm">
                      <span className="font-medium tabular-nums text-zinc-600 dark:text-zinc-400">
                        #{index + 1}
                      </span>
                      <Link
                        href={`/u/${encodeURIComponent(row.username)}`}
                        className="min-w-0 truncate font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
                      >
                        @{row.username}
                      </Link>
                      <span className="text-right tabular-nums text-zinc-800 dark:text-zinc-200">
                        {row.postCount}
                      </span>
                      <span className="text-right tabular-nums text-zinc-900 dark:text-zinc-50">
                        {sortMode === 'unlocks' ? (
                          row.unlockCount
                        ) : (
                          <span className="block truncate text-xs font-semibold leading-tight">
                            {formatXec(row.earnedXec)} XEC
                          </span>
                        )}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="hidden overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm md:block dark:border-zinc-800 dark:bg-zinc-900">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950">
                    <th className="px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-50">Rank</th>
                    <th className="px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-50">Author</th>
                    <th className="px-4 py-3 text-right font-semibold text-zinc-900 dark:text-zinc-50">
                      Posts
                    </th>
                    <th className="px-4 py-3 text-right font-semibold text-zinc-900 dark:text-zinc-50">
                      Unlocks
                    </th>
                    <th className="px-4 py-3 text-right font-semibold text-zinc-900 dark:text-zinc-50">
                      XEC Earned
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, index) => (
                    <tr
                      key={row.authorId}
                      className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                    >
                      <td className="px-4 py-3 font-medium tabular-nums text-zinc-600 dark:text-zinc-400">
                        #{index + 1}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/u/${encodeURIComponent(row.username)}`}
                          className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
                        >
                          @{row.username}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-800 dark:text-zinc-200">
                        {row.postCount}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-800 dark:text-zinc-200">
                        {row.unlockCount}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
                        {formatXec(row.earnedXec)} XEC
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
