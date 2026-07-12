'use client'

// =============================================================================
//  WriteReaderPreview — the write page's RIGHT rail: "as readers will see it".
//  A pure function of the live editor state (title / body / price) — no fetching.
//  Shows the published card, the paywall teaser + the lock a non-paying reader
//  hits, and the 94/6 split + an earnings projection. Everything updates as the
//  author types, so the paywall placement and the money are never a guess.
// =============================================================================

import { useMemo } from 'react'
import { splitPostBodyAtPaywall } from '@/lib/splitPostBodyAtPaywall'
import { calculateReadingTimeMinutes, } from '@/lib/calculateReadingTimeMinutes'
import { formatReadingTimeLabel } from '@/lib/getReadingTime'
import { computePaymentSplit } from '@/lib/paymentSplit'

const TEASER_CLAMP = 200

// HTML → plain text for the teaser preview: drop the paywall marker + tags,
// collapse whitespace. Good enough for a preview (the real teaser is derived
// server-side on publish).
function htmlToText(html) {
  return String(html ?? '')
    .replace(/<div[^>]*data-paywall-break(?:="true")?[^>]*>\s*<\/div>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function shortenIdentity(identity) {
  const s = String(identity ?? '').trim()
  if (!s) return 'you'
  if (s.startsWith('@')) return s
  const bare = s.replace(/^ecash:/, '')
  return bare.length > 16 ? `${bare.slice(0, 8)}…${bare.slice(-4)}` : bare
}

export default function WriteReaderPreview({
  title = '',
  body = '',
  priceXec = '',
  identity = '',
  handleColor = null,
}) {
  const { teaser, hasPaywall, readingLabel } = useMemo(() => {
    const { bodyPublic, hasPaywall } = splitPostBodyAtPaywall(body)
    const text = htmlToText(bodyPublic)
    const clamped =
      text.length > TEASER_CLAMP ? `${text.slice(0, TEASER_CLAMP).trimEnd()}…` : text
    return {
      teaser: clamped,
      hasPaywall,
      readingLabel: formatReadingTimeLabel(calculateReadingTimeMinutes(body)),
    }
  }, [body])

  const priceNum = Number(priceXec)
  const validPrice = Number.isFinite(priceNum) && priceNum > 0
  const split = validPrice ? computePaymentSplit(priceNum) : null
  const priceText = validPrice ? `${priceNum.toLocaleString()} XEC` : 'Free'

  const bylineDisplay = shortenIdentity(identity)
  const isHandle = bylineDisplay.startsWith('@')
  const metaParts = [bylineDisplay, readingLabel].filter(Boolean)

  return (
    <div className="wp">
      <p className="wp-eyebrow">As readers will see it</p>

      <div className="wp-card">
        <span className="wp-card-tag">Article</span>
        <span className="wp-card-title">{title.trim() || 'Untitled story'}</span>
        {teaser ? <span className="wp-card-teaser">{teaser}</span> : (
          <span className="wp-card-teaser wp-dim">Your opening lines show here…</span>
        )}
        <span className="wp-card-meta">
          <span style={isHandle && handleColor ? { color: handleColor } : undefined}>
            {metaParts.join(' · ')}
          </span>
          {metaParts.length ? ' · ' : ''}
          <span className="wp-card-price">{priceText}</span>
        </span>
      </div>

      {validPrice ? (
        hasPaywall ? (
          <div className="wp-lock">
            <span className="wp-lock-icon" aria-hidden>🔒</span>
            <span>The rest is for readers · Unlock {priceText}</span>
          </div>
        ) : (
          <div className="wp-lock wp-lock-warn">
            <span className="wp-lock-icon" aria-hidden>⚠</span>
            <span>No paywall marker yet — the whole story is free. Add the 🔒 break.</span>
          </div>
        )
      ) : (
        <div className="wp-lock wp-lock-free">
          <span>Free to read — set a price to earn.</span>
        </div>
      )}

      {split ? (
        <div className="wp-money">
          <div className="wp-money-row">
            <span>You keep 94%</span>
            <strong>{split.authorAmount.toLocaleString()} XEC</strong>
          </div>
          <div className="wp-money-row wp-dim">
            <span>Platform 6%</span>
            <span>{split.platformAmount.toLocaleString()} XEC</span>
          </div>
          <div className="wp-money-proj">
            <div className="wp-money-row">
              <span>10 unlocks →</span>
              <strong>{(split.authorAmount * 10).toLocaleString()} XEC</strong>
            </div>
            <div className="wp-money-row">
              <span>100 unlocks →</span>
              <strong>{(split.authorAmount * 100).toLocaleString()} XEC</strong>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
