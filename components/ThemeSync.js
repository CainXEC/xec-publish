'use client'

import { useEffect } from 'react'

// Keeps the theme consistent across every open tab. The `storage` event fires
// only in OTHER same-origin tabs (never the one that wrote the value), so when
// ThemeToggle writes localStorage.theme in one tab, every other open tab flips
// its <html>.dark class immediately — instead of silently drifting until its
// next reload/navigation and then appearing to change "on its own". Mounted
// once globally in the root layout so it works on every page, including ones
// that don't render the toggle itself. (Same cross-tab pattern as notifSync /
// the Pocket.) ThemeToggle has its own matching listener to keep its icon in
// step; toggling the class here is idempotent, so both running is harmless.
export default function ThemeSync() {
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== 'theme' || !e.newValue) return
      document.documentElement.classList.toggle('dark', e.newValue === 'dark')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return null
}
