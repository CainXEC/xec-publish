'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

export default function ScrollToTopOnRouteChange() {
  const pathname = usePathname()

  useEffect(() => {
    if (typeof window === 'undefined') return
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual'
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    console.log('[scroll-fix] route changed', pathname, 'scrollY:', window.scrollY)

    const scrollAllTargets = () => {
      const y = window.scrollY || window.pageYOffset || 0
      if (y > 0) {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
        document.documentElement.scrollTop = 0
        document.body.scrollTop = 0
      }
    }

    scrollAllTargets()
    console.log('[scroll-fix] after immediate scrollTo, scrollY:', window.scrollY)

    const timeouts = [50, 150, 400].map((delay) =>
      setTimeout(() => {
        scrollAllTargets()
        console.log(`[scroll-fix] after ${delay}ms scrollTo, scrollY:`, window.scrollY)
      }, delay),
    )

    return () => timeouts.forEach(clearTimeout)
  }, [pathname])

  return null
}
