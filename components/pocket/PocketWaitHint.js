'use client'

import { usePocket } from '@/lib/pocket/store'

/**
 * A one-line funnel shown on a Cashtab payment-wait screen: "Skip this wait with
 * your Pocket". Rendered only for a signed-in viewer who has NO Pocket yet
 * (status 'none') — a Pocket payment is instant and never reaches a wait screen,
 * so anyone seeing one is a candidate. Opens /pocket in a NEW tab so tapping it
 * never abandons the in-flight payment the wait is polling for.
 */
export default function PocketWaitHint() {
  const pocket = usePocket()
  if (pocket.status !== 'none') return null
  return (
    <div className="pocket-wait-hint">
      <style>{HINT_CSS}</style>
      <a className="pocket-wait-link" href="/pocket" target="_blank" rel="noopener noreferrer">
        ⚡ Skip this wait with your Pocket
      </a>
    </div>
  )
}

const HINT_CSS = `
.pocket-wait-hint { margin: 12px 0 0; text-align: center; }
/* Scoped two-deep so the neon color beats a global "a { color: inherit }". */
.pocket-wait-hint .pocket-wait-link {
  font-size: 12.5px; font-weight: 600; text-decoration: none;
  color: var(--neon, #00ff9c);
  border-bottom: 1px dashed color-mix(in srgb, var(--neon, #00ff9c) 55%, transparent);
  padding-bottom: 1px;
}
.pocket-wait-hint .pocket-wait-link:hover { border-bottom-style: solid; }
`
