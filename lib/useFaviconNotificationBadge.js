'use client'

import { useEffect } from 'react'

// The "lit" favicon: the normal mark is a neon-green pen on a near-black tile.
// When there are unread notifications we FLIP it — green fills the tile, the
// glyph goes dark — the most legible change at 16px and unmistakably on-brand.
// Built once at runtime from the shipped PNG (no extra asset) and cached.
const GREEN = [0, 255, 156] // brand --neon
const INK = [11, 15, 14] // tile ink (near-black)
const CORNER_ALPHA = 24 // below this = the rounded tile's transparent corner
const ORIG_ATTR = 'data-fav-orig' // stashes a link's real href while badged

let badgedUrlPromise = null

function buildBadgedFavicon(srcUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const size = Math.min(img.naturalWidth || 32, 192) || 32
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('no 2d context'))
      ctx.drawImage(img, 0, 0, size, size)
      let image
      try {
        image = ctx.getImageData(0, 0, size, size) // same-origin PNG → not tainted
      } catch (e) {
        return reject(e)
      }
      const px = image.data
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < CORNER_ALPHA) continue // keep transparent corners
        const r = px[i]
        const g = px[i + 1]
        const b = px[i + 2]
        // The bright green pen is the glyph; the dark tile is the background.
        const isGlyph = g > 110 && g >= r && g >= b
        const c = isGlyph ? INK : GREEN
        px[i] = c[0]
        px[i + 1] = c[1]
        px[i + 2] = c[2]
        // alpha untouched so anti-aliased edges stay smooth
      }
      ctx.putImageData(image, 0, 0)
      try {
        resolve(canvas.toDataURL('image/png'))
      } catch (e) {
        reject(e)
      }
    }
    img.onerror = () => reject(new Error('favicon load failed'))
    img.src = srcUrl
  })
}

// The tab icons, excluding apple-touch-icon (home-screen, not the tab).
function tabIconLinks() {
  return Array.from(document.querySelectorAll('link[rel~="icon"]')).filter(
    (l) => !(l.getAttribute('rel') || '').includes('apple'),
  )
}

function sizePx(link) {
  const m = /(\d+)x\d+/.exec(link.getAttribute('sizes') || '')
  return m ? Number(m[1]) : 0
}

/**
 * X-style tab signal, POW flavour: while `active`, swap the tab favicon to the
 * "lit" (inverted) variant; restore the normal mark when it clears.
 *
 * Robustness: Next re-emits the root-layout icon <link>s on client navigation
 * (often replacing the elements), which would revert our swap. So we stash each
 * link's real href on the element itself (data-fav-orig) and re-apply on any
 * <head> mutation and on focus — re-querying the live links each time rather
 * than holding a stale reference. Desktop only (mobile tabs show no favicon);
 * Safari desktop is finicky about dynamic favicons, Chrome/Firefox/Edge honour it.
 */
export function useFaviconNotificationBadge(active) {
  useEffect(() => {
    if (typeof document === 'undefined' || !active) return undefined

    let cancelled = false
    let badgedUrl = null

    const apply = () => {
      if (!badgedUrl) return
      for (const link of tabIconLinks()) {
        if (link.getAttribute('href') === badgedUrl) continue // already lit (no loop)
        if (!link.hasAttribute(ORIG_ATTR)) {
          link.setAttribute(ORIG_ATTR, link.getAttribute('href') || '')
        }
        link.setAttribute('href', badgedUrl)
      }
    }

    const restore = () => {
      for (const link of Array.from(document.querySelectorAll(`link[${ORIG_ATTR}]`))) {
        const orig = link.getAttribute(ORIG_ATTR)
        if (orig) link.setAttribute('href', orig)
        link.removeAttribute(ORIG_ATTR)
      }
    }

    // Build the lit variant (cached) from the largest icon so it stays crisp on
    // hi-dpi tabs, then apply once ready.
    const links = tabIconLinks()
    const source =
      links.slice().sort((a, b) => sizePx(b) - sizePx(a))[0]?.getAttribute('href') ||
      links[0]?.getAttribute('href')
    if (source) {
      if (!badgedUrlPromise) badgedUrlPromise = buildBadgedFavicon(source)
      badgedUrlPromise
        .then((url) => {
          if (cancelled) return
          badgedUrl = url
          apply()
        })
        .catch(() => {
          badgedUrlPromise = null // let a later toggle retry
        })
    }

    // Re-apply if Next rewrites/re-emits the icon links, or on focus.
    const head = document.head
    const observer = head ? new MutationObserver(apply) : null
    observer?.observe(head, { childList: true, subtree: true })
    const reassert = () => apply()
    window.addEventListener('focus', reassert)
    document.addEventListener('visibilitychange', reassert)

    return () => {
      cancelled = true
      observer?.disconnect()
      window.removeEventListener('focus', reassert)
      document.removeEventListener('visibilitychange', reassert)
      restore()
    }
  }, [active])
}
