'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Nav from '@/components/Nav'

/** `total_xec` from the leaderboard RPC is in satoshis (1 XEC = 100 satoshis). */
function formatXec(satoshis) {
  const n = Number(satoshis)
  const xec = Number.isFinite(n) ? n / 100 : 0
  return xec.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' XEC'
}

const TIME_FILTER_OPTIONS = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: '1y', label: '1y' },
  { id: 'all', label: 'All time' },
]

const sortBtnActive =
  'rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400'
const sortBtnInactive =
  'rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900'

const timeFilterBtnActive =
  'rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 md:px-3 md:py-2 md:text-sm dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400'
const timeFilterBtnInactive =
  'rounded-lg border border-zinc-300 bg-transparent px-2.5 py-1.5 text-xs font-medium text-zinc-800 transition hover:bg-zinc-50 md:px-3 md:py-2 md:text-sm dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-900'

export default function LeaderboardPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [sortMode, setSortMode] = useState('unlocks')
  const [timeFilter, setTimeFilter] = useState('all')
  /** `null` = loading or failed to load (show —). */
  const [platformStats, setPlatformStats] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const params = new URLSearchParams({ timeFilter })
      const res = await fetch(`/api/leaderboard?${params}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to load leaderboard')
      }
      setRows(Array.isArray(data?.rows) ? data.rows : [])
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load leaderboard')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [timeFilter])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let cancelled = false

    async function loadPlatformStats() {
      try {
        const res = await fetch('/api/leaderboard/stats')
        const data = await res.json().catch(() => ({}))
        if (!res.ok || cancelled) {
          return
        }
        const totalUnlocks = Number(data?.total_unlocks)
        const totalXec = Number(data?.total_xec)
        if (!Number.isFinite(totalUnlocks) || !Number.isFinite(totalXec)) {
          return
        }
        if (!cancelled) {
          setPlatformStats({ total_unlocks: totalUnlocks, total_xec: totalXec })
        }
      } catch {
        /* leave platformStats null → show — */
      }
    }

    void loadPlatformStats()
    return () => {
      cancelled = true
    }
  }, [])

  const sortedRows = useMemo(() => {
    const copy = [...rows]
    if (sortMode === 'earned') {
      copy.sort(
        (a, b) =>
          b.total_xec - a.total_xec ||
          b.total_unlocks - a.total_unlocks,
      )
    } else {
      copy.sort(
        (a, b) =>
          b.total_unlocks - a.total_unlocks ||
          b.total_xec - a.total_xec,
      )
    }
    return copy
  }, [rows, sortMode])

  return (
    <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
      <Nav />

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-4 max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
            Author Leaderboard
          </h1>
          <p className="mt-3 text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
            Rankings by unlocks or author earnings.
          </p>
        </div>

        <div
          className="mb-2 flex w-full gap-2"
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

        <div
          className="mb-2 flex flex-wrap items-center gap-1.5 md:gap-2"
          role="group"
          aria-label="Leaderboard time range"
        >
          {TIME_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              aria-pressed={timeFilter === opt.id}
              onClick={() => setTimeFilter(opt.id)}
              className={
                timeFilter === opt.id ? timeFilterBtnActive : timeFilterBtnInactive
              }
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="mb-3 rounded-lg border border-zinc-200/70 bg-zinc-100/40 px-2 py-2.5 sm:px-4 dark:border-zinc-800/70 dark:bg-zinc-900/30">
          <p className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs text-zinc-500 dark:text-zinc-500">
            <span>
              <span className="text-zinc-600 dark:text-zinc-400">Total Unlocks</span>
              <span className="mx-1.5 text-zinc-400 dark:text-zinc-600">·</span>
              <span className="font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
                {platformStats ? platformStats.total_unlocks : '—'}
              </span>
            </span>
            <span>
              <span className="text-zinc-600 dark:text-zinc-400">Total Earned by Authors</span>
              <span className="mx-1.5 text-zinc-400 dark:text-zinc-600">·</span>
              <span className="font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
                {platformStats ? formatXec(platformStats.total_xec) : '—'}
              </span>
            </span>
          </p>
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
                  <li key={row.author_id} role="row">
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
                        {row.post_count}
                      </span>
                      <span className="text-right tabular-nums text-zinc-900 dark:text-zinc-50">
                        {sortMode === 'unlocks' ? (
                          row.total_unlocks
                        ) : (
                          <span className="block truncate text-xs font-semibold leading-tight">
                            {formatXec(row.total_xec)}
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
                      key={row.author_id}
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
                        {row.post_count}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-800 dark:text-zinc-200">
                        {row.total_unlocks}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
                        {formatXec(row.total_xec)}
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
