'use client'

import { useState } from 'react'
import HandleCarousel from '@/components/HandleCarousel'

// The edit-profile own-handle picker: lets the author choose which held handle
// their profile displays. CONTROLLED and STAGED — like the color picker, a pick
// only updates parent state; nothing is written on-chain until the user hits
// "Save changes". The held handles are fetched on the server (profile page) and
// passed in as props, so the carousel renders with the rest of the page instead
// of popping in after a client fetch waterfall. Renders nothing when the wallet
// holds no handles.
export default function DashboardHandleCarousel({
  initialHandles = [],
  initialAddress = null,
  value = null,
  onChange = null,
  disabled = false,
}) {
  const [handles] = useState(initialHandles)
  const [address] = useState(initialAddress)

  if (handles.length === 0) return null

  return (
    <HandleCarousel
      handles={handles}
      title="Your handle"
      activeTokenId={value}
      onChoose={(id) => onChange?.(id)}
      includeAddress
      address={address}
      busy={disabled}
    />
  )
}
