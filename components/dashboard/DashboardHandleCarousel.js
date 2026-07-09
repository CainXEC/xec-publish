'use client'

import { useState } from 'react'
import HandleCarousel from '@/components/HandleCarousel'

// The edit-profile own-handle picker: lets an account choose which held handle
// their profile displays. CONTROLLED and STAGED — like the color picker, a pick
// only updates parent state; nothing is written on-chain until the user hits
// "Save changes". The held handles are fetched on the server (profile page) and
// passed in as props, so the carousel renders with the rest of the page instead
// of popping in after a client fetch waterfall. Always renders: an account with
// no handles still sees its eCash address option plus a "Buy handle" prompt.
export default function DashboardHandleCarousel({
  initialHandles = [],
  initialAddress = null,
  value = null,
  onChange = null,
  disabled = false,
}) {
  const [handles] = useState(initialHandles)
  const [address] = useState(initialAddress)

  return (
    <HandleCarousel
      handles={handles}
      title="Your handle"
      activeTokenId={value}
      onChoose={(id) => onChange?.(id)}
      includeAddress
      address={address}
      busy={disabled}
      buyHandleHref={handles.length === 0 ? '/marketplace' : null}
    />
  )
}
