'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveDisplayHandle } from '@/app/dashboard/saveDisplayHandle'

// A wallet can hold hundreds (or more) of handle NFTs, so we never stack them
// all in the layout: the strip scrolls horizontally, a search narrows large
// collections, and we cap how many nodes render at once (the search is the
// escape hatch for anything past the cap). Images lazy-load so off-screen
// cards cost nothing until scrolled into view.
const SEARCH_THRESHOLD = 8
const MAX_RENDER = 100

export default function DashboardHandleCarousel() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [handles, setHandles] = useState([])
  const [activeTokenId, setActiveTokenId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/account/handles', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data?.authenticated) {
          setHandles(Array.isArray(data.handles) ? data.handles : [])
          setActiveTokenId(data.activeTokenId ?? null)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return handles
    return handles.filter((h) => h.handle?.toLowerCase().includes(q))
  }, [handles, query])

  const shown = filtered.slice(0, MAX_RENDER)
  const overflow = filtered.length - shown.length

  async function choose(tokenId) {
    if (saving || tokenId === activeTokenId) return
    setError(null)
    setSaving(true)
    const previous = activeTokenId
    setActiveTokenId(tokenId) // optimistic
    try {
      const result = await saveDisplayHandle({ tokenId })
      if (result?.unauthorized) {
        router.replace('/login')
        return
      }
      if (!result?.ok) {
        setActiveTokenId(previous) // revert
        setError(result?.error || 'Could not update display handle.')
        return
      }
      router.refresh()
    } catch {
      setActiveTokenId(previous)
      setError('Could not update display handle.')
    } finally {
      setSaving(false)
    }
  }

  if (loading || handles.length === 0) return null

  return (
    <div className="dashhandles">
      <div className="dashhandles-head">
        <h2 className="dashsection-title">Your handle</h2>
        {handles.length > SEARCH_THRESHOLD ? (
          <input
            type="search"
            className="dashhandles-search"
            placeholder="Search handles…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search your handles"
          />
        ) : null}
      </div>

      <div className="dashhandles-track" role="radiogroup" aria-label="Display handle">
        <button
          type="button"
          role="radio"
          aria-checked={activeTokenId === null}
          onClick={() => void choose(null)}
          disabled={saving}
          className={`dashhandle${activeTokenId === null ? ' active' : ''}`}
          title="Display your wallet address"
        >
          <span className="dashhandle-addr" aria-hidden>
            0x
          </span>
          <span className="dashhandle-name">Address</span>
        </button>

        {shown.map((h) => (
          <button
            key={h.tokenId}
            type="button"
            role="radio"
            aria-checked={h.tokenId === activeTokenId}
            onClick={() => void choose(h.tokenId)}
            disabled={saving}
            className={`dashhandle${h.tokenId === activeTokenId ? ' active' : ''}`}
            title={`@${h.handle}`}
          >
            {h.imageUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={h.imageUrl}
                alt=""
                loading="lazy"
                className="dashhandle-img"
              />
            ) : (
              <span className="dashhandle-addr" aria-hidden>
                @
              </span>
            )}
            <span className="dashhandle-name">@{h.handle}</span>
          </button>
        ))}

        {overflow > 0 ? (
          <span className="dashhandle-more">
            +{overflow.toLocaleString()} more — search to narrow
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="dashhandles-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
