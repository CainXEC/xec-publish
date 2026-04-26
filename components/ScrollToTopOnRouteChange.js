'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

export default function ScrollToTopOnRouteChange() {
  const pathname = usePathname()

  useEffect(() => {
    if (typeof window === 'undefined') return

    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })

    const timeoutId = setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    }, 50)

    return () => clearTimeout(timeoutId)
  }, [pathname])

  return null
}
