'use client'
// =============================================================================
//  BottomNav.js — the mobile app-shell bottom tab bar.
//
//  Below 1100px (where the desktop rails don't show) this fixed bar owns
//  navigation, so the topbar hamburger goes away: Feed / Front Page / Live /
//  Marketplace / You. The two rails that only exist as desktop columns get
//  full-screen routes here (/paper, /live). The last tab is "You" → /dashboard
//  for signed-in visitors, and "Login" → /login for signed-out ones (checked
//  via /api/me, re-checked on `sessionChanged`). Hidden at ≥1100px (CSS), where
//  the three columns + topbar nav take over. Mounted once, globally, in layout.
// =============================================================================

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { armLoginLaunch } from '@/lib/ecash/loginLaunch'

const HOME = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 11l8-7 8 7" />
    <path d="M6 10v9h12v-9" />
  </svg>
)
const PAPER = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="5" width="16" height="14" rx="1.5" />
    <path d="M7 9h10M7 12.5h10M7 16h6" />
  </svg>
)
const LIVE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12h4l2.5-7 4 14 2.5-7H21" />
  </svg>
)
const SHOP = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8h12l-1 11a1 1 0 01-1 1H8a1 1 0 01-1-1L6 8z" />
    <path d="M9 8a3 3 0 016 0" />
  </svg>
)
const USER = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20a7 7 0 0114 0" />
  </svg>
)
const TABS = [
  { href: '/', label: 'Feed', icon: HOME, match: (p) => p === '/' },
  { href: '/paper', label: 'Paper', icon: PAPER, match: (p) => p.startsWith('/paper') },
  { href: '/live', label: 'Live', icon: LIVE, match: (p) => p.startsWith('/live') },
  { href: '/marketplace', label: 'Shop', icon: SHOP, match: (p) => p.startsWith('/marketplace') },
  { href: '/dashboard', label: 'You', icon: USER, match: (p) => p.startsWith('/dashboard') },
]

export default function BottomNav() {
  const pathname = usePathname() || '/'
  // null = unknown (pre-fetch). Signed-out visitors get a "Login" tab instead
  // of "You"; re-checked on `sessionChanged` (paying doubles as login).
  const [authed, setAuthed] = useState(null)
  // Hidden while any ComposeBox textarea is focused: this bar is
  // position:fixed/bottom:0 with no awareness of the on-screen keyboard, so
  // once a composer near the bottom of the page gets focus, the bar can end
  // up floating on top of its Cancel/Pay buttons instead of below them.
  // Counted (not a plain bool) so tabbing between fields — a blur immediately
  // followed by another focus — doesn't flash the bar back on in between; the
  // brief overlap is bridged with a short hide-delay instead of a hard toggle.
  const [composerActive, setComposerActive] = useState(false)
  // The keyboard is actually up. iOS's "hide keyboard" button dismisses the
  // keyboard WITHOUT blurring the textarea, so composer focus alone can't tell
  // us to bring the bar back — the visual viewport can (it grows again when the
  // keyboard closes). We only HIDE the bar when a composer is focused AND the
  // keyboard is up; dismissing the keyboard restores the bar even if focus
  // lingers. Optimistically true on focus so the bar still hides instantly
  // (before the keyboard animates in), and browsers without visualViewport just
  // keep the old focus/blur behavior (it stays true until blur).
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  // Focus depth + "keyboard has been up" live in refs (not effect-locals) so the
  // lifecycle resets below can clear them too.
  const focusCountRef = useRef(0)
  const sawKeyboardRef = useRef(false)

  // Force the bar visible and wipe all "keyboard is up" bookkeeping. The hide
  // state is driven by PAIRED focus/blur + viewport-resize events; several
  // leave-and-return paths never deliver the matching event — a bfcache restore
  // (back/forward, or returning to the Safari tab), or navigating away while a
  // composer is focused — which would otherwise strand the bar hidden. Every
  // such lifecycle moment calls this, so the bar can never stay gone.
  const forceShow = useCallback(() => {
    focusCountRef.current = 0
    sawKeyboardRef.current = false
    setComposerActive(false)
    setKeyboardOpen(false)
  }, [])

  useEffect(() => {
    let hideTimer = null
    const apply = (active) => {
      if (hideTimer) {
        clearTimeout(hideTimer)
        hideTimer = null
      }
      if (active) setComposerActive(true)
      else hideTimer = setTimeout(() => setComposerActive(false), 80)
    }
    const onFocus = () => {
      focusCountRef.current += 1
      apply(true)
      sawKeyboardRef.current = false
      setKeyboardOpen(true) // optimistic hide; the viewport confirms/dismisses
    }
    const onBlur = () => {
      focusCountRef.current = Math.max(0, focusCountRef.current - 1)
      if (focusCountRef.current === 0) apply(false)
    }
    window.addEventListener('pow:composer-focus', onFocus)
    window.addEventListener('pow:composer-blur', onBlur)

    // Keyboard up = the visual viewport is well short of the layout viewport.
    // We only bring the bar back once the keyboard has been UP and then goes
    // DOWN (a real dismissal — iOS's "hide keyboard" button doesn't fire blur).
    // The full-height viewport right after focus (keyboard not open yet) is NOT
    // a dismissal, so it can't flash the bar back on.
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    const onViewport = () => {
      if (!vv) return
      const keyboardUp = window.innerHeight - vv.height > 120
      if (keyboardUp) {
        sawKeyboardRef.current = true
        setKeyboardOpen(true)
      } else if (sawKeyboardRef.current) {
        setKeyboardOpen(false)
      }
    }
    vv?.addEventListener('resize', onViewport)

    return () => {
      window.removeEventListener('pow:composer-focus', onFocus)
      window.removeEventListener('pow:composer-blur', onBlur)
      vv?.removeEventListener('resize', onViewport)
      if (hideTimer) clearTimeout(hideTimer)
    }
  }, [])

  // Returning to the page must never leave the bar hidden: `pageshow` covers a
  // bfcache restore (back/forward or tab switch), and a foreground
  // `visibilitychange` covers app-switching back. If a composer is genuinely
  // still focused (app-switched away mid-compose), leave the viewport handler in
  // charge rather than fighting it; otherwise the keyboard is down and the bar
  // belongs on screen.
  useEffect(() => {
    const onPageShow = () => forceShow()
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      const el = document.activeElement
      const typing = el && (el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (!typing) forceShow()
    }
    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [forceShow])

  useEffect(() => {
    let alive = true
    const check = () => {
      fetch('/api/me', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
          if (alive) setAuthed(Boolean(d?.authenticated))
        })
        .catch(() => {})
    }
    check()
    window.addEventListener('sessionChanged', check)
    return () => {
      alive = false
      window.removeEventListener('sessionChanged', check)
    }
  }, [])

  const tabs = TABS.map((t) =>
    t.href === '/dashboard' && authed === false
      ? {
          ...t,
          href: '/login',
          label: 'Login',
          match: (p) => p.startsWith('/login') || p.startsWith('/dashboard'),
        }
      : t,
  )

  return (
    <nav className={`pow-bnav${composerActive && keyboardOpen ? ' bn-hidden' : ''}`} aria-label="Primary">
      <style>{CSS}</style>
      {tabs.map((t) => {
        const on = t.match(pathname)
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`bn-tab${on ? ' on' : ''}`}
            aria-current={on ? 'page' : undefined}
            // Tapping "Login" pre-opens the Cashtab window in THIS tap gesture so
            // /login can point it at the payment — the only way iOS Safari yields
            // a real new window (see loginLaunch).
            onClick={t.href === '/login' ? () => armLoginLaunch() : undefined}
          >
            <span className="bn-ic" aria-hidden>{t.icon}</span>
            <span className="bn-l">{t.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

const CSS = `
.pow-bnav{display:none;}
@media (max-width:1099px){
  .pow-bnav{position:fixed;left:0;right:0;bottom:0;z-index:80;display:flex;
    background:rgba(7,11,10,.94);backdrop-filter:blur(12px);
    border-top:1px solid #173a33;
    padding:7px 0 calc(7px + env(safe-area-inset-bottom));
    font-family:'JetBrains Mono',ui-monospace,'SF Mono',Menlo,monospace;}
  /* clear the fixed bar so the last content is reachable */
  body{padding-bottom:calc(62px + env(safe-area-inset-bottom));}
  /* A focused composer (see the effect above) hides the bar entirely — with
     the keyboard open there's no space for it anyway, and it would otherwise
     sit on top of the composer's own Cancel/Pay buttons. */
  .pow-bnav.bn-hidden{display:none;}
}
.pow-bnav .bn-tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;
  text-decoration:none;color:#5f8a7e;font-size:10.5px;letter-spacing:.03em;
  -webkit-tap-highlight-color:transparent;}
.pow-bnav .bn-tab.on{color:#00ff9c;}
.pow-bnav .bn-ic{display:inline-flex;}
.pow-bnav .bn-ic svg{width:23px;height:23px;display:block;}
.pow-bnav .bn-tab.on .bn-ic svg{filter:drop-shadow(0 0 6px rgba(0,255,156,.55));}
/* Paper: translucent paper bar, warm hairline, ink-green active tab, no glow. */
html:not(.dark) .pow-bnav{background:rgba(246,244,237,.94);border-top-color:#e3dfd2;}
html:not(.dark) .pow-bnav .bn-tab{color:#5e6155;}
html:not(.dark) .pow-bnav .bn-tab.on{color:#12703c;}
html:not(.dark) .pow-bnav .bn-tab.on .bn-ic svg{filter:none;}
@media (prefers-reduced-motion:reduce){.pow-bnav *{transition:none!important;}}
`
