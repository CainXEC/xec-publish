'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveDisplayHandle } from '@/app/dashboard/saveDisplayHandle'
import HandleCarousel from '@/components/HandleCarousel'

// The dashboard's own-handle picker: lets the author switch which held handle
// their profile displays, inline — no need to open Edit Profile. The held
// handles are fetched on the server (dashboard page) and passed in as props, so
// the carousel renders with the rest of the page instead of popping in after a
// client fetch waterfall. Renders nothing when the wallet holds no handles.
export default function DashboardHandleCarousel({
  initialHandles = [],
  initialAddress = null,
  initialActiveTokenId = null,
}) {
  const router = useRouter()
  const [handles] = useState(initialHandles)
  const [address] = useState(initialAddress)
  const [activeTokenId, setActiveTokenId] = useState(initialActiveTokenId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

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

  if (handles.length === 0) return null

  return (
    <HandleCarousel
      handles={handles}
      title="Your handle"
      activeTokenId={activeTokenId}
      onChoose={(id) => void choose(id)}
      includeAddress
      address={address}
      busy={saving}
      error={error}
    />
  )
}
