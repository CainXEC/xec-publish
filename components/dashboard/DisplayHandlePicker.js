'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveDisplayHandle } from '@/app/dashboard/saveDisplayHandle'

/**
 * Lets a wallet that holds one or more handle NFTs choose which one is shown as
 * its identity (nav, comment bylines, profile), or display the raw address.
 *
 * Self-contained: fetches the wallet's CURRENT on-chain holdings from
 * GET /api/account/handles, so it reflects handles bought/transferred in — not
 * just ones minted through this account. Renders nothing until we know the
 * holdings; renders a hint when the wallet holds none.
 */
export default function DisplayHandlePicker() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [handles, setHandles] = useState([])
  const [activeTokenId, setActiveTokenId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

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

  async function choose(tokenId) {
    if (saving || tokenId === activeTokenId) return
    setError(null)
    setSaved(false)
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
      setSaved(true)
      router.refresh()
    } catch {
      setActiveTokenId(previous)
      setError('Could not update display handle.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null
  if (handles.length === 0) {
    return (
      <section className="dashpanel">
        <h2 className="prof-panel-title">Display handle</h2>
        <p className="prof-panel-sub">
          This wallet doesn’t hold any handle NFTs yet. Mint or buy one to display
          it as your identity.
        </p>
      </section>
    )
  }

  const single = handles.length === 1

  return (
    <section className="dashpanel">
      <h2 className="prof-panel-title">Display handle</h2>
      <p className="prof-panel-sub">
        {single
          ? 'Shown as your identity in the nav, on your profile, and on comments.'
          : 'Your wallet holds several handles. Choose which one is shown as your identity.'}
      </p>

      <fieldset className="prof-radios" disabled={saving}>
        {handles.map((h) => {
          const selected = h.tokenId === activeTokenId
          return (
            <label
              key={h.tokenId}
              className={selected ? 'prof-radio sel' : 'prof-radio'}
            >
              <input
                type="radio"
                name="displayHandle"
                checked={selected}
                onChange={() => void choose(h.tokenId)}
              />
              {h.imageUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={h.imageUrl} alt="" className="prof-radio-img" />
              ) : null}
              <span className="prof-radio-name">@{h.handle}</span>
            </label>
          )
        })}

        <label className={activeTokenId === null ? 'prof-radio sel' : 'prof-radio'}>
          <input
            type="radio"
            name="displayHandle"
            checked={activeTokenId === null}
            onChange={() => void choose(null)}
          />
          <span className="prof-radio-addr">Display my wallet address instead</span>
        </label>
      </fieldset>

      {error ? (
        <p className="error" style={{ marginTop: '14px' }} role="alert">
          {error}
        </p>
      ) : null}
      {saved && !error ? (
        <p className="prof-ok" style={{ marginTop: '14px' }} role="status">
          Display handle updated.
        </p>
      ) : null}
    </section>
  )
}
