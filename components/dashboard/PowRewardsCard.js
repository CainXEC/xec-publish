'use client'

import { useEffect, useState } from 'react'

// Self-serve transparency card (POW airdrop spec §25): shows the logged-in viewer
// their OWN week-to-date reward standing — the Economic/Creation/Engagement split
// behind their Contribution Score, their live rank, and the underlying activity.
// Reads GET /api/pow-rewards/score (auth = the viewer themselves). Read-only.
//
// It shows a LIVE, week-to-date score (not a POW amount): the pool is only split
// into POW when the week closes, so a mid-week POW figure would be misleading.
// Rank + "unique users engaged" nudge the behaviour the score rewards.

// No border/background of its own — this sits directly in the dashboard's
// .dashpanel (which already has its own border), so its own box used to draw
// a redundant nested frame. It's now a plain section like "Your Library" /
// "Your Articles" (title styled the same way), with only the Economic/
// Creation/Engagement cells kept as their own tiles — same treatment as the
// stat tiles above it (.dashstat), just smaller.
const POWCARD_CSS = `
.powcard{margin-top:20px}
.powcard-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}
.powcard-title{margin:0;font-size:14px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;
  color:var(--neon);text-shadow:0 0 8px rgba(0,255,156,.3)}
.powcard-week{color:var(--dim);font-size:12.5px}
.powcard-rank{color:var(--dim);font-size:13px;font-variant-numeric:tabular-nums}
.powcard-cells{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0 0}
.powcard-cell{background:var(--panel2);border:1px solid var(--line);border-radius:9px;padding:10px 11px;text-align:center}
.powcard-cell .l{display:block;font-size:11.5px;color:var(--dim);margin-bottom:3px}
.powcard-cell .v{display:block;font-size:19px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums}
.powcard-total{margin:12px 0 0;font-size:14px;color:var(--text)}
.powcard-total b{color:var(--neon);font-variant-numeric:tabular-nums}
.powcard-act{margin:8px 0 0;font-size:12.5px;color:var(--dim);line-height:1.5}
.powcard-note{margin:10px 0 0;font-size:13px;color:var(--dim)}
.powcard-muted{margin:10px 0 0;color:var(--dim);font-size:13px}
`

const n1 = (x) => (typeof x === 'number' ? x.toFixed(1) : '—')

export default function PowRewardsCard() {
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let active = true
    fetch('/api/pow-rewards/score', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (active) setState({ status: 'done', data: d }) })
      .catch(() => { if (active) setState({ status: 'error' }) })
    return () => { active = false }
  }, [])

  const d = state.status === 'done' ? state.data : null
  const found = d?.ok && d.found
  const excluded = state.status === 'done' && d?.ok && d.found === false && d.reason === 'excluded'

  return (
    <div className="powcard">
      <style>{POWCARD_CSS}</style>
      <div className="powcard-head">
        <span className="powcard-title">Your POW this week</span>
        {found ? (
          <span className="powcard-rank">
            #{d.rank} of {d.participants} · {d.isoWeek}
          </span>
        ) : d?.isoWeek ? (
          <span className="powcard-week">{d.isoWeek}</span>
        ) : null}
      </div>

      {state.status === 'loading' && <p className="powcard-muted">Loading your standing…</p>}
      {state.status === 'error' && <p className="powcard-muted">Couldn’t load your rewards standing.</p>}

      {excluded && (
        <p className="powcard-note">
          Your account funds the weekly reward pool, so it’s excluded from earning —
          the POW goes to the community. You still power the whole thing. 🙏
        </p>
      )}
      {state.status === 'done' && !found && !excluded && d?.reason === 'no_activity' && (
        <p className="powcard-note">
          No contribution yet this week. Publish, unlock a writer, reply, or bring in
          genuine activity — POW rewards the people who make Proof of Writing more
          valuable to others, paid out weekly.
        </p>
      )}
      {state.status === 'done' && !d?.ok && (
        <p className="powcard-muted">Rewards standing is unavailable right now.</p>
      )}

      {found && (
        <>
          <div className="powcard-cells">
            <div className="powcard-cell"><span className="l">Economic</span><span className="v">{n1(d.economicScore)}</span></div>
            <div className="powcard-cell"><span className="l">Creation</span><span className="v">{n1(d.creationScore)}</span></div>
            <div className="powcard-cell"><span className="l">Engagement</span><span className="v">{n1(d.engagementScore)}</span></div>
          </div>
          <p className="powcard-total">
            Contribution score <b>{n1(d.contributionScore)}</b>
          </p>
          {d.activity && (
            <p className="powcard-act">
              This week so far: {Math.round(d.activity.platformXec).toLocaleString()} XEC platform revenue
              {' · '}{d.activity.articles} article{d.activity.articles === 1 ? '' : 's'}
              {' · '}{d.activity.feedPosts} post{d.activity.feedPosts === 1 ? '' : 's'}
              {' · '}{d.activity.replies} repl{d.activity.replies === 1 ? 'y' : 'ies'}
              {' · '}{d.activity.unlocksMade}/{d.activity.unlocksReceived} unlocks made/received
              {' · '}<b>{d.activity.uniqueCounterparties}</b> unique users engaged
            </p>
          )}
        </>
      )}
    </div>
  )
}
