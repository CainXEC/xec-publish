'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveHandleColor } from '@/app/dashboard/saveHandleColor'
import { HANDLE_COLORS } from '@/lib/handleColors'

/**
 * Lets any signed-in wallet choose the color its handle appears in across the
 * site (feed bylines, article byline, profile header, nav). Self-contained: reads
 * the account's current color from GET /api/me and saves each pick immediately
 * via the account-scoped saveHandleColor action — so it works for reader-only
 * handle holders too, not just authors. Tapping the selected swatch again clears
 * back to the default neon byline.
 */
export default function HandleColorPicker() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [color, setColor] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data?.authenticated) setColor(data.handleColor ?? '')
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function choose(next) {
    if (saving) return
    setError(null)
    setSaved(false)
    setSaving(true)
    const previous = color
    setColor(next) // optimistic
    try {
      const result = await saveHandleColor({ color: next || null })
      if (result?.unauthorized) {
        router.replace('/login')
        return
      }
      if (!result?.ok) {
        setColor(previous) // revert
        setError(result?.error || 'Could not update handle color.')
        return
      }
      setSaved(true)
      router.refresh()
    } catch {
      setColor(previous)
      setError('Could not update handle color.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  return (
    <section className="dashpanel">
      <h2 className="prof-panel-title">Handle color</h2>
      <p className="prof-panel-sub">
        The color your handle appears in across the site. Tap the selected swatch
        again to reset to the default.
      </p>

      <div className="prof-swatches" role="radiogroup" aria-label="Handle color">
        {HANDLE_COLORS.map((c) => {
          const selected = color === c.value
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={c.label}
              title={c.label}
              disabled={saving}
              onClick={() => void choose(selected ? '' : c.value)}
              className={`prof-swatch${selected ? ' sel' : ''}`}
              style={{ '--sw': c.value }}
            />
          )
        })}
      </div>

      {error ? (
        <p className="error" style={{ marginTop: '14px' }} role="alert">
          {error}
        </p>
      ) : null}
      {saved && !error ? (
        <p className="prof-ok" style={{ marginTop: '14px' }} role="status">
          Handle color updated.
        </p>
      ) : null}
    </section>
  )
}
