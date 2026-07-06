'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveDisplayHandle } from '@/app/dashboard/saveDisplayHandle'
import HandleCarousel from '@/components/HandleCarousel'

// The dashboard's own-handle picker: fetches the session wallet's handles and
// lets the author switch which one their profile displays, inline — no need to
// open Edit Profile. Renders nothing until at least one handle loads.
export default function DashboardHandleCarousel() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [handles, setHandles] = useState([])
  const [activeTokenId, setActiveTokenId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

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
    <HandleCarousel
      handles={handles}
      title="Your handle"
      activeTokenId={activeTokenId}
      onChoose={(id) => void choose(id)}
      busy={saving}
      error={error}
    />
  )
}
