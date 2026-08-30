'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useReactionPayment } from '@/components/feed/useReactionPayment'
import { REACTIONS } from '@/lib/reactions'

/**
 * Emoji reactions for a single article comment — the comment analogue of the
 * feed's EngagementBar (no repost/quote). Tapping an emoji sends a flat 100 XEC
 * (94/6 to the commenter, or 100% to the platform for 👎) via the shared
 * useReactionPayment flow pointed at /api/comments/react, and the comment carries
 * per-emoji pill counts. Multi-react: you can react as many times as you pay.
 * On your OWN comment the pills are read-only (you can't react to yourself).
 */
export default function CommentReactions({
  targetTxid,
  reactionCounts = {},
  // Server-known "you've reacted to this comment" (cross-device) — fills the ♡+.
  reactedByViewer = false,
  isOwn = false,
}) {
  // Per-emoji counts shown as pills. Seeded from the server truth and re-seeded
  // when it changes — using the "adjust state when a prop changes during render"
  // pattern (keyed on the VALUE, since the prop is a fresh object each render), so
  // an optimistic tap bumps locally until the next server read catches up.
  const rcKey = JSON.stringify(reactionCounts || {})
  const [counts, setCounts] = useState(reactionCounts || {})
  const [seededKey, setSeededKey] = useState(rcKey)
  if (rcKey !== seededKey) {
    setSeededKey(rcKey)
    setCounts(reactionCounts || {})
  }
  const bump = (emoji, delta) =>
    setCounts((c) => {
      const next = { ...c, [emoji]: Math.max(0, (c[emoji] || 0) + delta) }
      if (next[emoji] === 0) delete next[emoji]
      return next
    })

  const {
    reacted,
    pending,
    starting,
    intent,
    inPagePay,
    notice,
    txidInput,
    setTxidInput,
    startReaction,
    verifyManual,
    cancel,
  } = useReactionPayment({
    endpointBase: '/api/comments/react',
    targetTxid,
    reactedByViewer,
    onReacted: () => {}, // pill already bumped optimistically; server reconciles
    onReactFailed: (emoji) => bump(emoji, -1), // payment cancelled/failed → undo
  })

  // The picker reveals on HOVER on desktop (CSS); a TAP toggles it open for touch,
  // where there's no hover. Outside pointerdown closes it.
  const [pickerOpen, setPickerOpen] = useState(false)
  const wrapRef = useRef(null)
  useEffect(() => {
    if (!pickerOpen) return undefined
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setPickerOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [pickerOpen])

  const react = (emoji) => {
    if (pending || starting || isOwn) return
    setPickerOpen(false)
    bump(emoji, +1) // optimistic
    void startReaction('like', undefined, emoji)
  }

  const pills = useMemo(
    () =>
      Object.entries(counts)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1]),
    [counts],
  )

  // "Who reacted" — own comment only (mirrors the feed). `who`: null (unloaded) |
  // 'loading' | 'error' | array of { identity, emoji }. Fetched each time it opens.
  const [whoOpen, setWhoOpen] = useState(false)
  const [who, setWho] = useState(null)
  const toggleWho = () => {
    const opening = !whoOpen
    setWhoOpen(opening)
    if (opening) {
      setWho('loading')
      fetch(`/api/comments/reactions?txid=${targetTxid}`)
        .then((r) => (r.ok ? r.json() : { ok: false }))
        .then((j) => setWho(j.ok ? j.reactors : 'error'))
        .catch(() => setWho('error'))
    }
  }
  const whoGroups = useMemo(() => {
    if (!Array.isArray(who)) return null
    const m = new Map()
    for (const r of who) {
      if (!m.has(r.emoji)) m.set(r.emoji, [])
      m.get(r.emoji).push(r.identity)
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [who])

  return (
    <span className="creact">
      {!isOwn ? (
        // The picker reveals on HOVER / focus of this wrap (CSS), like the feed —
        // a transparent bridge spans the gap so the pointer can travel from the
        // button up into the picker without the hover dropping.
        <span className={`creactwrap${pickerOpen ? ' open' : ''}`} ref={wrapRef}>
          <button
            type="button"
            className="creactbtn"
            disabled={Boolean(pending) && !inPagePay}
            aria-haspopup="menu"
            aria-expanded={pickerOpen}
            aria-label="React · 100 XEC"
            title={reacted ? 'You reacted · React again · 100 XEC' : 'React · 100 XEC'}
            onClick={() => setPickerOpen((v) => !v)}
          >
            {/* Filled once you've reacted; the text variation selector keeps it
                monochrome (the icon's dim color), never the red heart emoji. */}
            {reacted ? '♥︎+' : '♡+'}
          </button>
          {!pending ? (
            <div className="creactpicker" role="menu">
              {REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="creactopt"
                  role="menuitem"
                  onClick={() => react(emoji)}
                  title={`${emoji} · 100 XEC`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
        </span>
      ) : (
        // Your OWN comment: you can't react to yourself, so the ♡+ opens a "who
        // reacted" list instead (mirrors the feed's own-post behavior).
        <span className="creactwrap">
          <button
            type="button"
            className={`creactbtn${whoOpen ? ' on' : ''}`}
            onClick={toggleWho}
            aria-haspopup="menu"
            aria-expanded={whoOpen}
            aria-label="See who reacted"
            title="See who reacted"
          >
            ♡+
          </button>
          {whoOpen ? (
            <div className="cwhoreacted">
              {who === 'loading' ? (
                <p className="cwhonote">Loading…</p>
              ) : who === 'error' ? (
                <p className="cwhonote">Couldn’t load reactions.</p>
              ) : whoGroups && whoGroups.length > 0 ? (
                whoGroups.map(([emoji, names]) => (
                  <div className="cwhorow" key={emoji}>
                    <span className="cwhoemoji" aria-hidden>{emoji}</span>
                    <span className="cwhonames">{names.join(', ')}</span>
                  </div>
                ))
              ) : (
                <p className="cwhonote">No reactions yet.</p>
              )}
            </div>
          ) : null}
        </span>
      )}

      {pills.map(([emoji, n]) => (
        <button
          key={emoji}
          type="button"
          className="creactpill"
          disabled={!isOwn && Boolean(pending) && !inPagePay}
          onClick={() => (isOwn ? toggleWho() : react(emoji))}
          aria-label={isOwn ? `${emoji} reactions — see who` : `React ${emoji}`}
          title={isOwn ? 'See who reacted' : `React ${emoji} · 100 XEC`}
        >
          {emoji} {n}
        </button>
      ))}

      {pending && intent && !inPagePay ? (
        <div className="clikepay">
          <p>
            Confirm <strong>{intent.amountXec} XEC</strong> in Cashtab to react
            {intent.emoji ? ` ${intent.emoji}` : ''}…
          </p>
          <details className="clikepay-manual">
            <summary>Cashtab didn&apos;t open, or already paid?</summary>
            <div style={{ textAlign: 'center', margin: '8px 0 0' }}>
              <a href={intent.cashtabUrl} target="_blank" rel="noreferrer">
                Open in Cashtab
              </a>
            </div>
            <div className="clikepay-row">
              <input
                value={txidInput}
                onChange={(e) => setTxidInput(e.target.value)}
                placeholder="Paste the transaction ID"
                spellCheck={false}
              />
              <button type="button" onClick={() => void verifyManual()}>
                Verify
              </button>
            </div>
          </details>
          {notice ? <p className="clike-notice">{notice}</p> : null}
          <button type="button" className="clike-cancel" onClick={cancel}>
            Cancel
          </button>
        </div>
      ) : notice ? (
        <p className="clike-notice">{notice}</p>
      ) : null}
    </span>
  )
}
