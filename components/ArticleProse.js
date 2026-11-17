'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import XEmbed from '@/components/feed/XEmbed'

/**
 * An article body: the server-sanitized HTML, plus the one piece of it that has
 * to be live React — embedded X posts. The stored body only holds an empty
 * placeholder per post (`<div class="xembed-slot" data-x-id="…">`, see
 * lib/articleBodyLinks); after the HTML is in the DOM, each placeholder gets an
 * XEmbed card portaled into it. Re-scans whenever the HTML changes (a
 * translation swap, an unlock revealing the rest), since React replaces the
 * whole subtree — and every placeholder — when it re-sets innerHTML.
 *
 * Everything else about the body is unchanged: same element, same className,
 * same sanitized bytes. YouTube needs none of this (a plain iframe).
 */
export default function ArticleProse({ html, className = 'prose' }) {
  const ref = useRef(null)
  const [slots, setSlots] = useState([])
  // MUST be referentially stable: React 19 re-writes innerHTML whenever the
  // dangerouslySetInnerHTML OBJECT changes, not just its string — so a fresh
  // { __html } on the re-render that adds the portals wiped every placeholder
  // (and the card inside it) right after it was found.
  const inner = useMemo(() => ({ __html: html }), [html])

  // Reading the DOM that innerHTML just produced IS syncing with an external
  // system — the placeholders only exist after commit — so the setState below
  // is the intended pattern here, not a derived-state shortcut.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const root = ref.current
    if (!root || !html || !html.includes('xembed-slot')) {
      setSlots((prev) => (prev.length ? [] : prev))
      return
    }
    const found = []
    for (const el of root.querySelectorAll('div.xembed-slot[data-x-id]')) {
      const id = el.getAttribute('data-x-id') || ''
      if (/^\d{1,20}$/.test(id)) found.push({ el, id })
    }
    setSlots(found)
  }, [html])
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <>
      <div ref={ref} className={className} dangerouslySetInnerHTML={inner} />
      {slots.map(({ el, id }, i) => createPortal(<XEmbed id={id} />, el, `${i}-${id}`))}
    </>
  )
}
