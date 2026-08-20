'use client'

// =============================================================================
//  TranslateButton — shared "文A" (translate) control for feed posts and articles.
//  Posts { kind, id, lang } to /api/translate (which fetches + translates the
//  content server-side, gated by the same paywall check the reader uses) and
//  hands the result to the parent, which swaps it in for the original. Defaults
//  the target to the viewer's browser locale and remembers their last pick.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { TRANSLATE_LANGS, normalizeLang } from '@/lib/translateLangs'
import {
  getTranslation,
  setTranslation,
  clearTranslation,
  getArticleIntent,
  setArticleIntent,
  clearArticleIntent,
} from '@/lib/translateStore'

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
  // `pending` drives the visible "Translating…" caption. It's a subset of `busy`:
  // only a USER-initiated translate sets it, so the silent cache-rehydrate on
  // mount (below) stays quiet — that one is near-instant from Redis and would
  // just flicker a caption on every load of an already-translated article.
  const [pending, setPending] = useState(false)
  const [active, setActive] = useState(false)
  const [error, setError] = useState('')
  const rootRef = useRef(null)

  // onTranslated is an inline arrow that changes identity each render; ref it so
  // the re-apply effect below can depend only on (kind, id).
  const onTranslatedRef = useRef(onTranslated)
  useEffect(() => {
    onTranslatedRef.current = onTranslated
  }, [onTranslated])

  const isArticle = kind === 'article'

  // The one place that talks to /api/translate. `silent` is for the durable
  // rehydrate (below): a failed re-fetch just drops back to the original quietly
  // rather than showing an error, and the durable intent stays so the next load
  // retries. Re-fetching is cheap — the server serves it from the shared Redis
  // cache, so re-applying a translation never re-spends API credits.
  const translateTo = async (lang, { silent = false } = {}) => {
    setBusy(true)
    if (!silent) {
      setError('')
      setPending(true)
    }
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
        if (silent) setActive(false)
        else
          setError(
            res.status === 429
              ? 'Too many requests — slow down.'
              : 'Translation unavailable.',
          )
        return
      }
      setActive(true)
      setTranslation(kind, id, data) // survives in-app navigation / re-render
      // Articles also persist durably (localStorage) so they stay translated
      // for you across reloads and future visits, and the front-page rail can
      // show the translated title.
      if (isArticle) setArticleIntent(id, { lang: data.lang || lang, title: data.title })
      onTranslatedRef.current?.(data) // { translated, title?, lang }
    } catch {
      if (silent) setActive(false)
      else setError('Network hiccup — try again.')
    } finally {
      setBusy(false)
      setPending(false)
    }
  }

  // translateTo is re-created each render; ref it so the mount effect can
  // rehydrate without re-running whenever the parent re-renders.
  const translateToRef = useRef(translateTo)
  useEffect(() => {
    translateToRef.current = translateTo
  })

  // A translation follows its content: re-apply it on mount instead of resetting
  // to the original. First the in-memory payload (feed post → its thread, etc.);
  // then, for ARTICLES, the durable choice — re-fetch that language (from the
  // Redis cache, no new API spend) so an article you translated stays translated
  // across reloads and return visits. Runs when (kind, id) changes.
  useEffect(() => {
    const cached = getTranslation(kind, id)
    if (cached) {
      setActive(true)
      onTranslatedRef.current?.(cached)
      return
    }
    if (isArticle) {
      const intent = getArticleIntent(id)
      if (intent?.lang) {
        setActive(true) // optimistic ↩; corrected to original if the re-fetch fails
        void translateToRef.current?.(intent.lang, { silent: true })
        return
      }
    }
    setActive(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id])

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const run = (lang) => {
    setOpen(false)
    void translateTo(lang)
  }

  const showOriginal = () => {
    setActive(false)
    setError('')
    clearTranslation(kind, id) // viewer chose the original — don't re-apply later
    if (isArticle) clearArticleIntent(id) // and forget the durable choice
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
          <span className="tb-glyph" aria-hidden="true">文A</span>
          {busy ? <span className="tb-dots" aria-hidden="true" /> : null}
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

      {pending ? (
        <span className="tb-loading" role="status" aria-live="polite">
          Translating<span className="tb-dots" aria-hidden="true" />
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
/* The "文A" translate mark: the international translate glyph (CJK + Latin).
   JetBrains Mono has no CJK, so 文 falls back to a system CJK face — a touch
   tighter + bolder so the two scripts read as one small icon, not two letters. */
.tb-glyph{font-weight:700;letter-spacing:-.01em;font-size:14px;line-height:1;}
.tb-on{opacity:.85;}
.tb-note{font-size:11px;opacity:.55;font-style:italic;}
/* The "Translating…" caption: a plainly readable pending state (NOT the faded
   italic of .tb-note — the whole point is that it's noticeable on a slow first
   translation). A soft pulse plus animated dots read as "working", not stuck. */
.tb-loading{display:inline-flex;align-items:center;font-size:12px;opacity:.9;white-space:nowrap;
  color:inherit;animation:tb-pulse 1.6s ease-in-out infinite;}
.tb-dots{display:inline-block;width:1.1em;text-align:left;}
.tb-dots::after{content:'…';animation:tb-dots 1.4s steps(1,end) infinite;}
@keyframes tb-dots{0%{content:'.';}33%{content:'..';}66%{content:'…';}}
@keyframes tb-pulse{0%,100%{opacity:.55;}50%{opacity:1;}}
@media (prefers-reduced-motion:reduce){
  .tb-loading{animation:none;opacity:.9;}
  .tb-dots::after{content:'…';animation:none;}
}
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
