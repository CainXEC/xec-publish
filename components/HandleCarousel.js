'use client'

import { useCallback, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import EcashIcon from '@/components/EcashIcon'

// The horizontally-scrolling strip of handle-NFT cards, shared by the dashboard
// (interactive: pick your own display handle) and the public profile (read-only:
// show what an author holds). A wallet can hold hundreds of handles, so we never
// stack them all: the strip scrolls, a search narrows large collections, and we
// cap how many nodes render at once (search is the escape hatch past the cap).
// Images lazy-load so off-screen cards cost nothing until scrolled into view.
const SEARCH_THRESHOLD = 8
const MAX_RENDER = 100

function HandleCardBody({ handle, imageUrl }) {
  // With a rendered card, show ONLY the card image — the handle is printed on the
  // card itself, and the full "@handle" still appears in the hover tooltip. A
  // handle with no card image falls back to the "@" glyph + name so it's still
  // identifiable.
  if (imageUrl) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img src={imageUrl} alt={`@${handle}`} loading="lazy" className="dashhandle-img" />
    )
  }
  return (
    <>
      <span className="dashhandle-addr" aria-hidden>
        @
      </span>
      <span className="dashhandle-name">@{handle}</span>
    </>
  )
}

export default function HandleCarousel({
  handles = [],
  title = 'Handles',
  activeTokenId = undefined,
  onChoose = null, // provide to make cards selectable; omit for read-only display
  includeAddress = false, // show an "Address" option (display-your-address picker)
  address = null, // the wallet address, shown in full on hover of the Address card
  buyHandleHref = null, // when set, append a "Buy handle" card linking out (e.g. marketplace)
  busy = false,
  error = null,
}) {
  const [query, setQuery] = useState('')
  // Hover/focus tooltip. Rendered in a portal at <body> so the strip's
  // horizontal scroll (overflow-x) can't clip a card's floating label.
  const [tip, setTip] = useState(null) // { text, x, y } | null
  const interactive = typeof onChoose === 'function'

  const showTip = useCallback((event, text) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setTip({ text, x: rect.left + rect.width / 2, y: rect.top })
  }, [])
  const hideTip = useCallback(() => setTip(null), [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return handles
    return handles.filter((h) => h.handle?.toLowerCase().includes(q))
  }, [handles, query])

  const shown = filtered.slice(0, MAX_RENDER)
  const overflow = filtered.length - shown.length

  // Render even with zero handles in the interactive picker (still shows the
  // Address option + a Buy-handle prompt); read-only empty collapses to nothing.
  if (handles.length === 0 && !interactive && !buyHandleHref) return null

  const cardProps = (label) => ({
    onMouseEnter: (e) => showTip(e, label),
    onMouseLeave: hideTip,
    onFocus: (e) => showTip(e, label),
    onBlur: hideTip,
  })

  return (
    <div className="dashhandles">
      <div className="dashhandles-head">
        <h2 className="dashsection-title">{title}</h2>
        {handles.length > SEARCH_THRESHOLD ? (
          <input
            type="search"
            className="dashhandles-search"
            placeholder="Search handles…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search handles"
          />
        ) : null}
      </div>

      <div
        className="dashhandles-track"
        role={interactive ? 'radiogroup' : undefined}
        aria-label={interactive ? 'Display handle' : undefined}
      >
        {shown.map((h) => {
          const label = `@${h.handle}`
          return interactive ? (
            <button
              key={h.tokenId}
              type="button"
              role="radio"
              aria-checked={h.tokenId === activeTokenId}
              onClick={() => onChoose(h.tokenId)}
              disabled={busy}
              className={`dashhandle${h.tokenId === activeTokenId ? ' active' : ''}${h.imageUrl ? ' hasimg' : ''}`}
              {...cardProps(label)}
            >
              <HandleCardBody handle={h.handle} imageUrl={h.imageUrl} />
            </button>
          ) : (
            <div
              key={h.tokenId ?? h.handle}
              className={`dashhandle static${h.imageUrl ? ' hasimg' : ''}`}
              tabIndex={0}
              {...cardProps(label)}
            >
              <HandleCardBody handle={h.handle} imageUrl={h.imageUrl} />
            </div>
          )
        })}

        {overflow > 0 ? (
          <span className="dashhandle-more">
            +{overflow.toLocaleString()} more — search to narrow
          </span>
        ) : null}

        {/* The "use my address instead of a handle" option lives LAST, after the
            wallet's handles — picking it clears the display handle (tokenId null).
            Hovering reveals the full address behind the truncated card label. */}
        {includeAddress && interactive ? (
          <button
            type="button"
            role="radio"
            aria-checked={activeTokenId === null}
            onClick={() => onChoose(null)}
            disabled={busy}
            className={`dashhandle${activeTokenId === null ? ' active' : ''}`}
            {...(address ? cardProps(address) : {})}
          >
            <span className="dashhandle-addr" aria-hidden>
              <EcashIcon size={22} />
            </span>
            <span className="dashhandle-name">Address</span>
          </button>
        ) : null}

        {/* No handle yet — point at the marketplace to buy one. */}
        {buyHandleHref ? (
          <Link
            href={buyHandleHref}
            className="dashhandle buy"
            {...cardProps('Buy a handle on the marketplace')}
          >
            <span className="dashhandle-addr" aria-hidden>
              +
            </span>
            <span className="dashhandle-name">Buy</span>
          </Link>
        ) : null}
      </div>

      {error ? (
        <p className="dashhandles-error" role="alert">
          {error}
        </p>
      ) : null}

      {tip && typeof document !== 'undefined'
        ? createPortal(
            <div className="dashhandle-tip" style={{ left: tip.x, top: tip.y }}>
              {tip.text}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
