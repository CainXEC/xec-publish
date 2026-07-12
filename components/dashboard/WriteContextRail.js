'use client'

// =============================================================================
//  WriteContextRail — the write page's LEFT rail: author context while writing.
//  Your other drafts (quick-switch), a stats glance (unlocks / earned /
//  followers), and live writing stats (words / reading time) off the current
//  body. Appears only at ≥1400px (the feed's front-page-rail breakpoint).
// =============================================================================

import { useMemo } from 'react'
import Link from 'next/link'
import { calculateReadingTimeMinutes } from '@/lib/calculateReadingTimeMinutes'
import { formatReadingTimeLabel } from '@/lib/getReadingTime'

function wordCount(html) {
  const text = String(html ?? '')
    .replace(/<div[^>]*data-paywall-break(?:="true")?[^>]*>\s*<\/div>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .trim()
  if (!text) return 0
  return text.split(/\s+/).length
}

export default function WriteContextRail({
  drafts = [],
  stats = { unlocks: 0, earnedXec: 0, followers: 0 },
  body = '',
  currentPostId = null,
}) {
  const { words, readingLabel } = useMemo(
    () => ({
      words: wordCount(body),
      readingLabel: formatReadingTimeLabel(calculateReadingTimeMinutes(body)) || 'under a min',
    }),
    [body],
  )

  return (
    <div className="wc">
      <p className="wc-eyebrow">Your drafts</p>
      <nav className="wc-drafts">
        {currentPostId == null ? (
          <span className="wc-draft is-current">
            <span className="wc-dot wc-dot-new" aria-hidden />
            New article <span className="wc-draft-state">· editing</span>
          </span>
        ) : null}
        {drafts.map((d) => {
          const isCurrent = d.id === currentPostId
          const label = d.title.trim() || 'Untitled'
          const content = (
            <>
              <span
                className={`wc-dot ${d.published ? 'wc-dot-pub' : 'wc-dot-draft'}`}
                aria-hidden
              />
              <span className="wc-draft-label">{label}</span>
              {isCurrent ? <span className="wc-draft-state">· editing</span> : null}
            </>
          )
          return isCurrent ? (
            <span key={d.id} className="wc-draft is-current">
              {content}
            </span>
          ) : (
            <Link key={d.id} href={`/dashboard/edit/${d.id}`} className="wc-draft">
              {content}
            </Link>
          )
        })}
        {drafts.length === 0 && currentPostId != null ? (
          <span className="wc-draft wc-empty">No other drafts yet.</span>
        ) : null}
      </nav>

      <div className="wc-stats">
        <div className="wc-stat">
          <span className="wc-stat-label">Total unlocks</span>
          <span className="wc-stat-val">{stats.unlocks.toLocaleString()}</span>
        </div>
        <div className="wc-stat">
          <span className="wc-stat-label">Earned</span>
          <span className="wc-stat-val">
            {stats.earnedXec.toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
            <span className="wc-stat-unit">XEC</span>
          </span>
        </div>
        <div className="wc-stat">
          <span className="wc-stat-label">Followers</span>
          <span className="wc-stat-val">{stats.followers.toLocaleString()}</span>
        </div>
      </div>

      <div className="wc-writing">
        <span>{words.toLocaleString()} {words === 1 ? 'word' : 'words'}</span>
        <span>{readingLabel}</span>
      </div>
    </div>
  )
}
