'use client'
// =============================================================================
//  SearchClient.js — the /search page body. One search bar; results grouped
//  Articles / Posts / People (the Twitter pattern), where the active tab is
//  just the ?type= query param. Snippets come from ts_headline over the FREE
//  portion of an article only (sql/search.sql) — a locked article renders with
//  a lock glyph, its price, and the teaser showing where the hit landed: a
//  search hit on a paywall is a conversion surface, not something to hide.
//  Address pastes resolve through the same /@identifier profile chain the rest
//  of the app uses.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import FeedTopbar from '@/components/feed/FeedTopbar'
import { FEED_CSS } from '@/components/feed/feedTheme'
import { parseSnippetSegments } from '@/lib/searchSnippet'

const TABS = [
  { key: null, label: 'All' },
  { key: 'articles', label: 'Articles' },
  { key: 'posts', label: 'Posts' },
  { key: 'people', label: 'People' },
]

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M15.8 15.8L21 21" />
  </svg>
)

const LockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="5" y="10.5" width="14" height="9.5" rx="1.5" />
    <path d="M8 10.5V7.5a4 4 0 018 0v3" />
  </svg>
)

function fmtXec(n) {
  const num = Number(n)
  return Number.isFinite(num) ? num.toLocaleString('en-US') : ''
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

function shortAddress(addr) {
  const a = String(addr ?? '')
  return a.length > 18 ? `${a.slice(0, 9)}…${a.slice(-6)}` : a
}

function Snippet({ text }) {
  const segments = parseSnippetSegments(text)
  if (segments.length === 0) return null
  return (
    <p className="srch-snip">
      {segments.map((s, i) => (s.mark ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>))}
    </p>
  )
}

function ArticleRow({ r }) {
  return (
    <Link href={r.route} className="srch-row">
      <div className="srch-row-head">
        {r.locked ? (
          <span className="srch-lock" title="Paid article">
            <LockIcon />
          </span>
        ) : null}
        <span className="srch-title">{r.title}</span>
      </div>
      <div className="srch-meta">
        {r.byline?.handle ? (
          <span className="srch-byline" style={r.byline.color ? { color: r.byline.color } : undefined}>
            @{r.byline.handle}
          </span>
        ) : null}
        {r.readingTimeMinutes ? <span>{r.readingTimeMinutes} min read</span> : null}
        {r.locked && Number(r.priceXec) > 0 ? (
          <span className="srch-price">{fmtXec(r.priceXec)} XEC unlocks</span>
        ) : null}
        <span>{fmtDate(r.publishedAt)}</span>
      </div>
      <Snippet text={r.snippet} />
    </Link>
  )
}

function PostRow({ r }) {
  return (
    <Link href={r.route} className="srch-row">
      <div className="srch-meta srch-post-head">
        <span
          className="srch-byline"
          style={r.identityColor ? { color: r.identityColor } : undefined}
        >
          {r.identity?.startsWith('@') ? r.identity : shortAddress(r.identity)}
        </span>
        <span>{fmtDate(r.createdAt)}</span>
      </div>
      <Snippet text={r.snippet} />
    </Link>
  )
}

function PersonRow({ r }) {
  const label = r.handle ? `@${r.handle}` : shortAddress(r.identity ?? r.id)
  return (
    <Link href={r.route} className="srch-row srch-person">
      <span
        className={r.handle ? 'srch-handle' : 'srch-addr'}
        style={r.handle && r.handleColor ? { color: r.handleColor } : undefined}
      >
        {label}
      </span>
    </Link>
  )
}

export default function SearchClient({
  initialQuery = '',
  initialType = null,
  signedIn = false,
  isAuthor = false,
}) {
  const [input, setInput] = useState(initialQuery)
  const [type, setType] = useState(initialType)
  const [data, setData] = useState(null) // last successful /api/search body
  const [phase, setPhase] = useState(initialQuery ? 'loading' : 'idle')
  const seqRef = useRef(0)

  const runSearch = useCallback(async (rawQuery, rawType) => {
    const q = rawQuery.trim().slice(0, 200)
    const seq = ++seqRef.current
    if (!q) {
      setData(null)
      setPhase('idle')
      return
    }
    setPhase('loading')
    try {
      const params = new URLSearchParams({ q })
      if (rawType) params.set('type', rawType)
      const res = await fetch(`/api/search?${params}`, { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (seq !== seqRef.current) return // a newer keystroke superseded us
      if (!res.ok || !body?.ok) {
        setPhase('error')
        return
      }
      setData(body)
      setPhase('ready')
    } catch {
      if (seq === seqRef.current) setPhase('error')
    }
  }, [])

  // Debounced search + shallow URL sync, so every state stays linkable
  // without a server round-trip per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      void runSearch(input, type)
      const params = new URLSearchParams()
      if (input.trim()) params.set('q', input.trim().slice(0, 200))
      if (type) params.set('type', type)
      const qs = params.toString()
      window.history.replaceState(null, '', qs ? `/search?${qs}` : '/search')
    }, 250)
    return () => clearTimeout(timer)
  }, [input, type, runSearch])

  const results = data?.results ?? { articles: [], posts: [], people: [] }
  const total = results.articles.length + results.posts.length + results.people.length
  const query = data?.query ?? ''

  const sections = [
    { key: 'articles', label: 'Articles', items: results.articles, Row: ArticleRow },
    { key: 'posts', label: 'Posts', items: results.posts, Row: PostRow },
    { key: 'people', label: 'People', items: results.people, Row: PersonRow },
  ]
  const visibleSections = type ? sections.filter((s) => s.key === type) : sections

  let body = null
  if (phase === 'idle') {
    body = (
      <p className="srch-status">
        Search articles, feed posts, and people — or paste an eCash address to
        jump straight to a profile.
      </p>
    )
  } else if (phase === 'error') {
    body = <p className="srch-status">Search is unavailable right now — try again shortly.</p>
  } else if (data && total === 0 && phase === 'ready') {
    body = (
      <p className="srch-status">
        {data.addressQuery
          ? 'No account found at that address yet.'
          : `No results for “${query}”.`}
      </p>
    )
  } else if (data) {
    body = visibleSections
      .filter((s) => s.items.length > 0)
      .map((s) => (
        <section key={s.key} className="srch-sec">
          {type ? null : (
            <div className="srch-sec-head">
              <span>{s.label}</span>
              <button type="button" className="srch-sec-more" onClick={() => setType(s.key)}>
                see all →
              </button>
            </div>
          )}
          {s.items.map((r) => (
            <s.Row key={`${s.key}:${r.id}`} r={r} />
          ))}
        </section>
      ))
  }

  return (
    <div className="pow-feed">
      <style>{FEED_CSS}</style>
      <style>{SEARCH_CSS}</style>
      <FeedTopbar signedIn={signedIn} isAuthor={isAuthor} />
      <main className="wrap srch-wrap">
        <form
          className="srch-bar"
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            void runSearch(input, type)
          }}
        >
          <span className="srch-ic">
            <SearchIcon />
          </span>
          <input
            className="srch-input"
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search — or paste an eCash address"
            aria-label="Search"
            autoFocus
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
          />
          {phase === 'loading' ? <span className="srch-live" aria-hidden>…</span> : null}
        </form>

        <div className="tabs srch-tabs" role="tablist" aria-label="Result type">
          {TABS.map((t) => {
            const on = (type ?? null) === t.key
            return (
              <button
                key={t.label}
                type="button"
                role="tab"
                aria-selected={on}
                className={`tab${on ? ' on' : ''}`}
                onClick={() => setType(t.key)}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {body}
      </main>
    </div>
  )
}

const SEARCH_CSS = `
.pow-feed .srch-wrap{padding-top:18px;}
.pow-feed .srch-bar{display:flex;align-items:center;gap:10px;background:var(--panel);
  border:1px solid var(--line);border-radius:12px;padding:12px 14px;}
.pow-feed .srch-bar:focus-within{border-color:var(--cyan);box-shadow:0 0 14px rgba(61,240,255,.14);}
.pow-feed .srch-ic{display:inline-flex;color:var(--dim);flex:none;}
.pow-feed .srch-ic svg{width:18px;height:18px;}
.pow-feed .srch-input{flex:1;min-width:0;background:none;border:none;outline:none;
  color:var(--text);font:inherit;font-size:15px;}
.pow-feed .srch-input::placeholder{color:var(--dim);opacity:.85;}
.pow-feed .srch-input::-webkit-search-cancel-button{-webkit-appearance:none;}
.pow-feed .srch-live{color:var(--cyan);font-weight:800;flex:none;}
.pow-feed .srch-tabs{margin-top:16px;}
.pow-feed .srch-status{margin:20px 2px;font-size:13.5px;line-height:1.6;color:var(--dim);}
.pow-feed .srch-sec{margin-top:20px;}
.pow-feed .srch-sec-head{display:flex;align-items:baseline;gap:8px;margin:0 2px 2px;
  font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);}
.pow-feed .srch-sec-more{margin-left:auto;background:none;border:none;padding:0;
  color:var(--cyan);font:inherit;font-size:12px;cursor:pointer;letter-spacing:.04em;}
.pow-feed .srch-sec-more:hover{color:var(--neon);}
.pow-feed .srch-row{display:block;padding:14px 2px;border-bottom:1px solid var(--line);}
.pow-feed .srch-row:hover .srch-title{color:var(--neon);}
.pow-feed .srch-row-head{display:flex;align-items:center;gap:8px;min-width:0;}
.pow-feed .srch-lock{display:inline-flex;color:var(--cyan);flex:none;}
.pow-feed .srch-lock svg{width:15px;height:15px;}
.pow-feed .srch-title{font-size:15.5px;font-weight:700;color:var(--text);transition:color .15s;
  overflow-wrap:anywhere;}
.pow-feed .srch-meta{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;margin-top:4px;
  font-size:12px;color:var(--dim);font-variant-numeric:tabular-nums;}
.pow-feed .srch-post-head{margin-top:0;}
.pow-feed .srch-byline{font-weight:700;color:var(--neon);}
.pow-feed .srch-price{color:var(--cyan);font-weight:700;}
.pow-feed .srch-snip{margin:7px 0 0;font-size:13.5px;line-height:1.55;color:var(--dim);
  overflow-wrap:anywhere;}
.pow-feed .srch-snip mark{background:none;color:var(--neon);font-weight:700;}
.pow-feed .srch-person{display:flex;align-items:center;}
.pow-feed .srch-handle{font-size:16px;font-weight:800;color:var(--neon);}
.pow-feed .srch-addr{font-size:13px;color:var(--dim);word-break:break-all;}
`
