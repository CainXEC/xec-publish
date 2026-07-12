'use client'

// =============================================================================
//  TranslateButton — shared "🌐 Translate" control for feed posts and articles.
//  Posts { kind, id, lang } to /api/translate (which fetches + translates the
//  content server-side, gated by the same paywall check the reader uses) and
//  hands the result to the parent, which swaps it in for the original. Defaults
//  the target to the viewer's browser locale and remembers their last pick.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { TRANSLATE_LANGS, normalizeLang } from '@/lib/translateLangs'

const LS_KEY = 'pow_translate_lang'

export default function TranslateButton({
  kind,
  id,
  onTranslated,
  onShowOriginal,
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState(false)
  const [error, setError] = useState('')
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const run = async (lang) => {
    setOpen(false)
    setBusy(true)
    setError('')
    try {
      localStorage.setItem(LS_KEY, lang)
    } catch {
      /* ignore */
    }
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, id, lang }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setError(
          res.status === 429
            ? 'Too many requests — slow down.'
            : 'Translation unavailable.',
        )
        return
      }
      setActive(true)
      onTranslated?.(data) // { translated, title?, lang }
    } catch {
      setError('Network hiccup — try again.')
    } finally {
      setBusy(false)
    }
  }

  const showOriginal = () => {
    setActive(false)
    setError('')
    onShowOriginal?.()
  }

  // Preferred language first (browser locale or last pick), then the rest.
  const preferred = (() => {
    try {
      const saved = localStorage.getItem(LS_KEY)
      if (saved && normalizeLang(saved)) return normalizeLang(saved)
    } catch {
      /* ignore */
    }
    if (typeof navigator !== 'undefined') {
      const n = normalizeLang(navigator.language)
      if (n) return n
    }
    return null
  })()
  const langs = preferred
    ? [
        ...TRANSLATE_LANGS.filter((l) => l.code === preferred),
        ...TRANSLATE_LANGS.filter((l) => l.code !== preferred),
      ]
    : TRANSLATE_LANGS

  return (
    <span className={`tb ${className}`} ref={rootRef}>
      {active ? (
        <button
          type="button"
          className="tb-btn tb-on"
          onClick={showOriginal}
          aria-label="Show original"
          title="AI translation — show original"
        >
          ↩
        </button>
      ) : (
        <button
          type="button"
          className="tb-btn"
          disabled={busy}
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Translate"
          title="Translate"
        >
          {busy ? '🌐…' : '🌐'}
        </button>
      )}

      {open && !active ? (
        <span className="tb-menu" role="menu">
          {langs.map((l) => (
            <button
              key={l.code}
              type="button"
              role="menuitem"
              className="tb-item"
              onClick={() => run(l.code)}
            >
              {l.label}
            </button>
          ))}
        </span>
      ) : null}

      {error ? <span className="tb-err">{error}</span> : null}
      <style>{TB_CSS}</style>
    </span>
  )
}

const TB_CSS = `
.tb{position:relative;display:inline-flex;align-items:center;gap:8px;}
.tb-btn{background:transparent;border:none;color:inherit;font:inherit;font-size:13px;
  cursor:pointer;opacity:.72;padding:2px 0;white-space:nowrap;transition:opacity .12s;line-height:1.2;}
.tb-btn:hover{opacity:1;}
.tb-btn:disabled{opacity:.5;cursor:default;}
.tb-on{opacity:.85;}
.tb-note{font-size:11px;opacity:.55;font-style:italic;}
.tb-err{font-size:11px;color:#ff5c6c;}
.tb-menu{position:absolute;top:100%;left:0;margin-top:8px;z-index:60;display:flex;
  flex-direction:column;min-width:160px;max-height:260px;overflow:auto;
  background:#0d1513;color:#d6fff0;border:1px solid #173a33;border-radius:10px;
  padding:6px;box-shadow:0 10px 28px rgba(0,0,0,.4);scrollbar-width:thin;}
html:not(.dark) .tb-menu{background:#ffffff;color:#07271d;border-color:#bfe6d5;}
.tb-item{text-align:left;background:transparent;border:none;color:inherit;font:inherit;
  font-size:13px;padding:7px 10px;border-radius:7px;cursor:pointer;}
.tb-item:hover{background:rgba(0,176,110,.14);}
`
