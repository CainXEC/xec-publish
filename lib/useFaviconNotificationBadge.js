'use client'

import { useEffect } from 'react'

// The "lit" favicon: the normal mark is a neon-green pen on a near-black tile.
// When there are unread notifications we FLIP it — green fills the tile, the
// glyph goes dark — the most legible change at 16px and unmistakably on-brand.
// Built once at runtime from the shipped PNG (no extra asset) and cached.
const GREEN = [0, 255, 156] // brand --neon
const INK = [11, 15, 14] // tile ink (near-black)
const CORNER_ALPHA = 24 // below this = the rounded tile's transparent corner

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

/**
 * X-style tab signal, POW flavour: while `active`, swap the tab favicon to the
 * "lit" (inverted) variant; restore the normal mark when it clears. Desktop
 * only — mobile browsers don't render tab favicons. Safari desktop is finicky
 * about dynamic favicons; Chrome/Firefox/Edge honour it.
 */
export function useFaviconNotificationBadge(active) {
  useEffect(() => {
    if (typeof document === 'undefined') return
    // The tab icons, excluding apple-touch-icon (home-screen, not the tab).
    const links = Array.from(document.querySelectorAll('link[rel~="icon"]')).filter(
      (l) => !(l.getAttribute('rel') || '').includes('apple'),
    )
    if (links.length === 0) return

    // Real originals, captured before we mutate anything, to restore later.
    const originals = links.map((l) => l.getAttribute('href'))

    let cancelled = false
    if (active) {
      // Prefer the largest icon as the source so the flip stays crisp on
      // hi-dpi tabs (browsers may pick the 192 for the 32px slot on retina).
      const source =
        links
          .slice()
          .sort((a, b) => sizePx(b) - sizePx(a))[0]
          ?.getAttribute('href') || originals[0]
      if (!badgedUrlPromise) badgedUrlPromise = buildBadgedFavicon(source)
      badgedUrlPromise
        .then((url) => {
          if (!cancelled) links.forEach((l) => l.setAttribute('href', url))
        })
        .catch(() => {
          badgedUrlPromise = null // let a later toggle retry
        })
    }

    return () => {
      cancelled = true
      links.forEach((l, i) => {
        if (originals[i] != null) l.setAttribute('href', originals[i])
      })
    }
  }, [active])
}

function sizePx(link) {
  const m = /(\d+)x\d+/.exec(link.getAttribute('sizes') || '')
  return m ? Number(m[1]) : 0
}
