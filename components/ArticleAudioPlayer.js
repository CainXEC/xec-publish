'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const SPEED_OPTIONS = [1, 1.25, 1.5, 2]

function formatAudioTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const wholeSeconds = Math.floor(seconds)
  const mins = Math.floor(wholeSeconds / 60)
  const secs = wholeSeconds % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

export default function ArticleAudioPlayer({ postId, isStale = false }) {
  const audioRef = useRef(null)
  const shouldResumePlaybackRef = useRef(false)
  const isRefreshingRef = useRef(false)

  const [loading, setLoading] = useState(true)
  const [hidden, setHidden] = useState(false)
  const [signedUrl, setSignedUrl] = useState('')
  const [expiresAtMs, setExpiresAtMs] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)

  const canPlay = Boolean(signedUrl) && !loading && !hidden
  const progressMax = Number.isFinite(duration) && duration > 0 ? duration : 1
  const progressValue = Number.isFinite(currentTime) ? Math.min(currentTime, progressMax) : 0
  const speedOptions = useMemo(() => SPEED_OPTIONS, [])

  const requestSignedUrl = useCallback(async () => {
    if (!postId) return { ok: false, status: 400, reason: 'missing-post-id' }

    let walletAddress = ''
    if (typeof window !== 'undefined') {
      walletAddress = (localStorage.getItem('readerWalletAddress') || '').trim()
    }

    const query = new URLSearchParams({ post_id: postId })
    if (walletAddress) {
      query.set('walletAddress', walletAddress)
    }

    const res = await fetch(`/api/audio/signed-url?${query.toString()}`, {
      cache: 'no-store',
      credentials: 'include',
    })

    if (!res.ok) {
      return { ok: false, status: res.status, reason: 'request-failed' }
    }

    const data = await res.json().catch(() => ({}))
    const url = typeof data?.url === 'string' ? data.url.trim() : ''
    const expiresIn = Number(data?.expires_in)
    if (!url || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      return { ok: false, status: 500, reason: 'invalid-payload' }
    }

    return { ok: true, url, expiresIn }
  }, [postId])

  const refreshSignedUrl = useCallback(
    async ({ retryPlayback = false } = {}) => {
      if (isRefreshingRef.current) return false
      isRefreshingRef.current = true
      try {
        const result = await requestSignedUrl()
        if (!result.ok) {
          if (result.status === 403 || result.status === 404) {
            setHidden(true)
          }
          return false
        }
        setSignedUrl(result.url)
        setExpiresAtMs(Date.now() + result.expiresIn * 1000)
        if (retryPlayback) {
          shouldResumePlaybackRef.current = true
        }
        return true
      } finally {
        isRefreshingRef.current = false
      }
    },
    [requestSignedUrl],
  )

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setHidden(false)
      const result = await requestSignedUrl()
      if (cancelled) return

      if (!result.ok) {
        if (result.status === 403 || result.status === 404) {
          setHidden(true)
        }
        setLoading(false)
        return
      }

      setSignedUrl(result.url)
      setExpiresAtMs(Date.now() + result.expiresIn * 1000)
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [requestSignedUrl])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.playbackRate = playbackRate
  }, [playbackRate, signedUrl])

  useEffect(() => {
    if (!signedUrl || !shouldResumePlaybackRef.current) return
    const audio = audioRef.current
    if (!audio) return
    shouldResumePlaybackRef.current = false
    void audio.play().then(
      () => setIsPlaying(true),
      () => setIsPlaying(false),
    )
  }, [signedUrl])

  const playAudio = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) return

    const isExpired = expiresAtMs > 0 && Date.now() >= expiresAtMs
    if (isExpired) {
      const refreshed = await refreshSignedUrl({ retryPlayback: true })
      if (!refreshed) return
      return
    }

    try {
      await audio.play()
      setIsPlaying(true)
    } catch {
      const refreshed = await refreshSignedUrl({ retryPlayback: true })
      if (!refreshed) {
        setIsPlaying(false)
      }
    }
  }, [expiresAtMs, refreshSignedUrl])

  const togglePlayPause = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      await playAudio()
      return
    }
    audio.pause()
    setIsPlaying(false)
  }, [playAudio])

  const handleScrub = useCallback((e) => {
    const audio = audioRef.current
    if (!audio) return
    const nextTime = Number(e.target.value)
    if (!Number.isFinite(nextTime)) return
    audio.currentTime = nextTime
    setCurrentTime(nextTime)
  }, [])

  const handleSpeedChange = useCallback((e) => {
    const nextRate = Number(e.target.value)
    if (!Number.isFinite(nextRate)) return
    setPlaybackRate(nextRate)
  }, [])

  if (hidden) return null
  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white/80 p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300">
        Loading audio narration...
      </div>
    )
  }
  if (!canPlay) return null

  return (
    <section className="rounded-xl border border-zinc-200 bg-white/90 p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/70">
      <p className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-200">
        🎧 AI audio narration
      </p>

      <audio
        ref={audioRef}
        src={signedUrl}
        preload="none"
        onTimeUpdate={() => {
          const audio = audioRef.current
          if (!audio) return
          setCurrentTime(audio.currentTime || 0)
        }}
        onLoadedMetadata={() => {
          const audio = audioRef.current
          if (!audio) return
          setDuration(audio.duration || 0)
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onError={() => {
          void refreshSignedUrl({ retryPlayback: isPlaying || shouldResumePlaybackRef.current })
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void togglePlayPause()}
          className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          aria-label={isPlaying ? 'Pause narration' : 'Play narration'}
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>

        <div className="min-w-[10rem] flex-1">
          <input
            type="range"
            min={0}
            max={progressMax}
            step="0.1"
            value={progressValue}
            onChange={handleScrub}
            className="h-8 w-full cursor-pointer"
            aria-label="Audio progress"
          />
          <div className="mt-1 flex items-center justify-between text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
            <span>{formatAudioTime(currentTime)}</span>
            <span>{formatAudioTime(duration)}</span>
          </div>
        </div>

        <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-2.5 text-sm text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200">
          <span className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Speed
          </span>
          <select
            value={playbackRate}
            onChange={handleSpeedChange}
            className="bg-transparent py-1 text-sm outline-none"
            aria-label="Playback speed"
          >
            {speedOptions.map((option) => (
              <option key={option} value={option}>
                {option}x
              </option>
            ))}
          </select>
        </label>
      </div>
      {isStale ? (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          ⚠️ Audio is from a previous version of this article.
        </p>
      ) : null}
    </section>
  )
}
