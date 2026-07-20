'use client'

// =============================================================================
//  HandleCardImage — the one shared way to render a handle-NFT card image, with
//  a "hover to enlarge" preview built in. Handle cards used to be a bare <img>
//  duplicated across ~7 surfaces (marketplace grid, feed mint cards, quote
//  embeds, the display-handle picker, mint/claim success, the handle carousel).
//  Wherever a card shows, hovering it now floats a larger copy of the SAME art
//  plus the full "@handle" — the name is printed small on the card, so users
//  asked to actually read it.
//
//  The preview renders through a portal at <body> (so a card sitting inside an
//  overflow:hidden grid or a horizontally-scrolling strip can't clip it) and is
//  inline-styled (so it looks the same on every page regardless of whether that
//  page loads the feed theme, the mint theme, or plain Tailwind). It's a
//  pointer-events:none, hover-only affordance: touch devices are unaffected.
//
//  The card art is a fixed 1024×1024 PNG (see app/api/handle-card/[tokenId]),
//  so "larger" needs no backend work — the browser just draws the same src at a
//  bigger size. When no hosted image_url exists yet, fall back to that route.
// =============================================================================

import { useCallback, useState } from 'react'
import type { ImgHTMLAttributes, FocusEvent, MouseEvent } from 'react'
import { createPortal } from 'react-dom'

// Where the hovered card sits, in viewport coords: horizontal center + the
// top/bottom edges, so the preview can flip above/below to stay on screen.
export type CardAnchor = { cx: number; top: number; bottom: number }

const PREVIEW_SIZE = 420 // px; the enlarged art. Native is 1024, so this is crisp.
const GAP = 12 // px between the card and its floating preview

const MARGIN = 8 // px kept clear of every viewport edge
// Popup chrome around the art: 10px padding top+bottom, plus the label's own
// line + the 8px gap above it. Used to reserve vertical room so the sizing and
// the placement math agree on how tall the popup actually is.
const CHROME = 20
const LABEL_BLOCK = 34

// The enlarged art, clamped so the WHOLE popup (art + label + padding) fits the
// viewport. Small desktop windows get a smaller preview rather than one that
// spills off screen.
function fitPreview(requested: number, hasLabel = true): number {
  if (typeof document === 'undefined') return requested
  const w = document.documentElement.clientWidth || requested
  const h = document.documentElement.clientHeight || requested
  const vertical = h - MARGIN * 2 - CHROME - (hasLabel ? LABEL_BLOCK : 0)
  return Math.max(160, Math.min(requested, w - MARGIN * 4, vertical))
}

/**
 * The floating preview itself: a larger copy of the card art + the full
 * "@handle" label. Exported so surfaces with their own hover bookkeeping (the
 * handle carousel) can drop it into their existing portal instead of
 * reimplementing the popup. When `src` is omitted it degrades to a text-only
 * chip (used for the carousel's non-card options like "Address"/"Buy").
 */
export function HandleCardPreview({
  anchor,
  src,
  label,
  size: rawSize = PREVIEW_SIZE,
}: {
  anchor: CardAnchor
  src?: string | null
  label?: string | null
  size?: number
}) {
  if (typeof window === 'undefined') return null

  const size = fitPreview(rawSize, Boolean(label))
  const height = (src ? size + CHROME : 24) + (label ? LABEL_BLOCK : 0)
  const vw = document.documentElement?.clientWidth || window.innerWidth || size
  const vh = document.documentElement?.clientHeight || window.innerHeight || height

  // Prefer above the card, flip below when the card sits too near the top —
  // but pick whichever side actually has more room when NEITHER fits, so a card
  // in the middle of a short window doesn't get shoved off the bottom edge.
  const roomAbove = anchor.top - GAP - MARGIN
  const roomBelow = vh - anchor.bottom - GAP - MARGIN
  const placeBelow = height <= roomAbove ? false : height <= roomBelow || roomBelow > roomAbove

  // Then clamp into the viewport regardless: the popup is pointer-events:none,
  // so overlapping the hovered card in a cramped window is harmless — being cut
  // off by the window edge is not. Position from the real top (no vertical
  // transform) so this clamp is exact.
  const wanted = placeBelow ? anchor.bottom + GAP : anchor.top - GAP - height
  const top = Math.min(Math.max(wanted, MARGIN), Math.max(MARGIN, vh - height - MARGIN))

  // Keep the horizontally-centered popup fully on screen. Pin the popup width
  // (image + 10px padding each side) so the centering math matches what renders.
  const popupWidth = (src ? size : 120) + CHROME
  const half = popupWidth / 2
  const left = Math.min(Math.max(anchor.cx, half + MARGIN), Math.max(half + MARGIN, vw - half - MARGIN))

  return (
    <div
      role="tooltip"
      style={{
        position: 'fixed',
        left,
        top,
        transform: 'translateX(-50%)',
        zIndex: 10000,
        pointerEvents: 'none',
        boxSizing: 'border-box',
        width: src ? popupWidth : undefined,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        padding: src ? 10 : '6px 10px',
        background: 'rgba(12,14,16,0.97)',
        border: '1px solid rgba(255,255,255,0.14)',
        borderRadius: src ? 14 : 8,
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
      }}
    >
      {src ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          // maxWidth:'none' defeats the global `img{max-width:100%}` reset, which
          // would otherwise collapse the enlarged art back down to nothing.
          style={{
            width: size,
            height: size,
            maxWidth: 'none',
            maxHeight: 'none',
            borderRadius: 8,
            display: 'block',
          }}
        />
      ) : null}
      {label ? (
        <span
          style={{
            color: '#f2f2f2',
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '0.01em',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--font-jetbrains-mono, ui-monospace, monospace)',
          }}
        >
          {label}
        </span>
      ) : null}
    </div>
  )
}

type Props = {
  /** Hosted card image URL (handles.image_url). */
  src?: string | null
  /** Fallback when there's no hosted url yet: /api/handle-card/<tokenId>. */
  tokenId?: string | null
  /** The bare handle (no "@"); drives the preview label + default alt text. */
  handle?: string | null
  className?: string
  /** Override the default alt (pass "" to keep the thumbnail decorative). */
  alt?: string
  previewSize?: number
} & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'className'>

/**
 * A handle-card <img> that shows an enlarged preview + full @handle on hover.
 * Drop-in for a plain <img>: keep the same className so existing layout CSS
 * still applies. Renders nothing when neither a src nor a tokenId is available.
 */
export default function HandleCardImage({
  src,
  tokenId,
  handle,
  className,
  alt,
  previewSize = PREVIEW_SIZE,
  ...imgProps
}: Props) {
  const finalSrc = src || (tokenId ? `/api/handle-card/${tokenId}` : '')
  const [anchor, setAnchor] = useState<CardAnchor | null>(null)

  const show = useCallback(
    (e: MouseEvent<HTMLImageElement> | FocusEvent<HTMLImageElement>) => {
      const r = e.currentTarget.getBoundingClientRect()
      // No point popping a "larger" copy over a card that's already this big or
      // bigger (e.g. the thread reading pane renders the card near full size).
      if (r.width >= fitPreview(previewSize) - 8) return
      setAnchor({ cx: r.left + r.width / 2, top: r.top, bottom: r.bottom })
    },
    [previewSize],
  )
  const hide = useCallback(() => setAnchor(null), [])

  if (!finalSrc) return null

  const label = handle ? `@${handle}` : null

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={finalSrc}
        alt={alt ?? (label ? `${label} handle NFT card` : 'handle NFT card')}
        className={className}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        {...imgProps}
      />
      {anchor && typeof document !== 'undefined'
        ? createPortal(
            <HandleCardPreview anchor={anchor} src={finalSrc} label={label} size={previewSize} />,
            document.body,
          )
        : null}
    </>
  )
}
