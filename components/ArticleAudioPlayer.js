'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const SPEED_OPTIONS = [1, 1.25, 1.5, 2]

function formatAudioTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const wholeSeconds = Math.floor(seconds)
  const mins = Math.floor(wholeSeconds / 60)
  const secs = wholeSeconds % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

function PlayIcon() {
  return (
    <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  )
}

function BigPlayPauseButton({ isPlaying, disabled, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void onClick()}
      aria-label={isPlaying ? 'Pause narration' : 'Play narration'}
      className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-emerald-600 transition active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500"
    >
      {isPlaying ? <PauseIcon /> : <PlayIcon />}
    </button>
  )
}

function ScrubberTrack({
  currentTime,
  duration,
  onSeek,
  scrubRef,
}) {
  const safeDur = Number.isFinite(duration) && duration > 0 ? duration : 0
  const pct = safeDur > 0 ? Math.min(100, (currentTime / safeDur) * 100) : 0

  const seekFromEvent = (clientX) => {
    const el = scrubRef.current
    if (!el || safeDur <= 0) return
    const rect = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    onSeek(ratio * safeDur)
  }

  return (
    <div
      ref={scrubRef}
      role="slider"
      tabIndex={0}
      aria-valuemin={0}
      aria-valuemax={Math.round(safeDur)}
      aria-valuenow={Math.round(currentTime)}
      aria-label="Audio progress"
      onClick={(e) => seekFromEvent(e.clientX)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        const delta = e.key === 'ArrowLeft' ? -5 : 5
        onSeek(Math.min(safeDur, Math.max(0, currentTime + delta)))
      }}
      className="relative h-[3px] w-full min-w-0 cursor-pointer rounded-full bg-zinc-200 dark:bg-zinc-800"
    >
      <div
        className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-emerald-600 dark:bg-emerald-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export default function ArticleAudioPlayer({
  postId,
  isStale = false,
}) {
  const audioRef = useRef(null)
  const scrubRef = useRef(null)
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

  const seekTo = useCallback((t) => {
    const audio = audioRef.current
    if (!audio) return
    const next = Number(t)
    if (!Number.isFinite(next)) return
    audio.currentTime = next
    setCurrentTime(next)
  }, [])

  const skipBy = useCallback((deltaSec) => {
    const audio = audioRef.current
    if (!audio) return
    const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Infinity
    const next = Math.min(dur, Math.max(0, (audio.currentTime || 0) + deltaSec))
    audio.currentTime = next
    setCurrentTime(next)
  }, [])

  const cycleSpeed = useCallback(() => {
    setPlaybackRate((r) => {
      const idx = SPEED_OPTIONS.indexOf(r)
      const nextIdx = idx < 0 ? 0 : (idx + 1) % SPEED_OPTIONS.length
      return SPEED_OPTIONS[nextIdx]
    })
  }, [])

  if (hidden) return null

  if (loading) {
    return (
      <div className="w-full rounded-lg border-[0.5px] border-zinc-200 bg-zinc-100 px-3 py-2.5 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
        Loading audio narration...
      </div>
    )
  }

  if (!canPlay) return null

  const cardClass =
    'w-full rounded-lg border-[0.5px] border-zinc-200 bg-zinc-100 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900'
  const timeLabel = `${formatAudioTime(currentTime)} / ${formatAudioTime(duration > 0 ? duration : 0)}`

  return (
    <>
      <section className={cardClass} aria-label="Article audio narration">
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

        <div className="flex items-center gap-2">
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => skipBy(-15)}
              className="flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center text-[9px] font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              aria-label="Skip back 15 seconds"
            >
              -15
            </button>
            <BigPlayPauseButton isPlaying={isPlaying} disabled={false} onClick={togglePlayPause} />
            <button
              type="button"
              onClick={() => skipBy(15)}
              className="flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center text-[9px] font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              aria-label="Skip forward 15 seconds"
            >
              +15
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <ScrubberTrack
              scrubRef={scrubRef}
              currentTime={currentTime}
              duration={duration}
              onSeek={seekTo}
            />
          </div>
          <span
            className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-zinc-600 dark:text-zinc-400"
            aria-live="polite"
          >
            {timeLabel}
          </span>
          <div className="shrink-0">
            <button
              type="button"
              onClick={cycleSpeed}
              className="cursor-pointer rounded bg-zinc-200/60 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 transition hover:bg-zinc-300/60 dark:bg-zinc-800/60 dark:text-zinc-300 dark:hover:bg-zinc-700/70"
              aria-label={`Playback speed ${playbackRate}x, click to change`}
            >
              {playbackRate}x
            </button>
          </div>
        </div>
      </section>
      {isStale ? (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          ⚠️ Audio is from a previous version of this article.
        </p>
      ) : null}
    </>
  )
}
