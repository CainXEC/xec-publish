import { notFound } from 'next/navigation'
import { getAuthedAccount } from '@/lib/authHelpers'
import { createServerSupabase } from '@/lib/supabase-server'
import { FEED_CSS } from '@/components/feed/feedTheme'
import FeedTopbar from '@/components/feed/FeedTopbar'
import QueueItemActions from '@/components/admin/QueueItemActions'
import CommissionForm, { DismissAssignmentButton } from '@/components/admin/CommissionForm'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Agent queue — proofofwriting',
  robots: { index: false, follow: false },
}

// =============================================================================
//  /admin/agent — human review surface for the AI_SATOSHI essay queue.
//
//  The agent (repo ai-satoshi) drafts essays into agent_queue as 'pending';
//  this page is where C reads the draft against its source and flips it to
//  'approved' (the agent publishes it on its own next run) or 'vetoed' (with a
//  MANDATORY written reason — RULES §7). First admin page on the site: gated
//  by getAuthedAccount().isAdmin, 404 for everyone else so the route doesn't
//  even admit it exists. Reads use the service-role client per repo convention
//  (agent_* RLS policies are scoped to the agent's own role).
// =============================================================================

export default async function AgentQueuePage() {
  const acct = await getAuthedAccount()
  if (!acct?.isAdmin) notFound()

  const supabase = createServerSupabase()
  const [pendingQ, recentQ, asgQ] = await Promise.all([
    supabase
      .from('agent_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('agent_queue')
      .select('id, created_at, status, title, veto_reason, approved_at, post_url, publish_txid, published_at')
      .neq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('agent_assignments')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30),
  ])
  const pending = pendingQ.data ?? []
  const recent = recentQ.data ?? []
  const loadError = pendingQ.error?.message ?? recentQ.error?.message ?? null
  // Commissions degrade separately: before sql/agent_assignments.sql has been
  // run the table is missing, and the queue below must keep working.
  const asgError = asgQ.error?.message ?? null
  const assignments = asgQ.data ?? []
  const openAsg = assignments.filter((a) => a.status === 'open' || a.status === 'failed')
  const doneAsg = assignments.filter((a) => a.status !== 'open' && a.status !== 'failed').slice(0, 6)

  return (
    <div className="pow-feed">
      <style>{FEED_CSS}</style>
      <style>{AQ_CSS}</style>
      <FeedTopbar signedIn isAuthor={Boolean(acct.authorId)} />
      <main className="wrap">
        <h1 className="aq-head">Agent queue</h1>
        <p className="aq-sub">
          You direct AI_SATOSHI: commission a subject below and the agent drafts it on
          its next scheduled run (the news-driven picker is off). Drafts land here for
          review — approve hands one back to the agent to publish on-chain; veto needs
          a written reason — that’s how taste compounds.
        </p>

        <h2 className="aq-sec">
          commission{openAsg.length ? ` · ${openAsg.length} waiting` : ''}
        </h2>
        <CommissionForm />
        {asgError ? (
          <div className="aq-empty">
            Commissions need the agent_assignments table — run ai-satoshi’s
            sql/agent_assignments.sql in the Supabase SQL editor. ({asgError})
          </div>
        ) : openAsg.length || doneAsg.length ? (
          <div className="aq-audit aq-asglist">
            {openAsg.map((a) => (
              <AssignmentRow key={a.id} item={a} />
            ))}
            {doneAsg.map((a) => (
              <AssignmentRow key={a.id} item={a} />
            ))}
          </div>
        ) : null}

        {loadError ? <div className="aq-empty">Couldn’t load the queue: {loadError}</div> : null}

        <h2 className="aq-sec">
          pending review{pending.length ? ` · ${pending.length}` : ''}
        </h2>
        {pending.length === 0 && !loadError ? (
          <div className="aq-empty">Queue’s empty — nothing waiting on you.</div>
        ) : (
          pending.map((item) => <PendingCard key={item.id} item={item} />)
        )}

        <h2 className="aq-sec">recent decisions</h2>
        {recent.length === 0 ? (
          <div className="aq-empty">No decisions yet.</div>
        ) : (
          <div className="aq-audit">
            {recent.map((item) => (
              <AuditRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

/* ---------------------------- pending item card ---------------------------- */

function PendingCard({ item }) {
  const source = item.source && typeof item.source === 'object' ? item.source : {}
  const critique = item.critique && typeof item.critique === 'object' ? item.critique : {}
  const fixes = asStrings(critique.fixes)
  const kills = asStrings(critique.kills)
  const styleFailures = asStrings(critique.styleFailures)
  const rounds = Number.isFinite(Number(critique.rounds)) ? Number(critique.rounds) : null
  const words = String(item.body_text ?? '').split(/\s+/).filter(Boolean).length

  return (
    <article className="aq-card">
      <h3 className="aq-title">{item.title || '(untitled)'}</h3>
      <div className="aq-meta">
        drafted {fmtWhen(item.created_at)} ({ago(item.created_at)}) · {words.toLocaleString()} words
      </div>
      <div className="aq-meta">
        source:{' '}
        {source.url ? (
          <a className="aq-srclink" href={source.url} target="_blank" rel="noreferrer">
            {source.title || source.url} ↗
          </a>
        ) : source.commissioned ? (
          // Commissioned essays have no news item: C named the subject.
          <span>
            commissioned{source.providedBy ? ` by ${source.providedBy}` : ''} — no news
            source, quotes verify against the corpus alone
          </span>
        ) : source.seeded ? (
          // Seeded manuscripts (essays C provided) have no news item behind them.
          <span>
            seeded manuscript
            {source.file ? ` · ${source.file}` : ''}
            {source.providedBy ? ` · provided by ${source.providedBy}` : ''}
          </span>
        ) : (
          <span>{source.title || 'unknown'}</span>
        )}
        {source.feed ? ` · ${source.feed}` : ''}
        {source.publishedAt ? ` · ${fmtWhen(source.publishedAt)}` : ''}
      </div>
      {source.commissioned && source.notes ? (
        <div className="aq-meta">your notes: {source.notes}</div>
      ) : null}
      {source.selectionReason ? (
        <div className="aq-meta">picked because: {source.selectionReason}</div>
      ) : null}

      <div className="aq-crit">
        <div className="aq-crit-h">
          critique{rounds != null ? ` · ${rounds} round${rounds === 1 ? '' : 's'}` : ''} ·{' '}
          {fixes.length} fix{fixes.length === 1 ? '' : 'es'} applied
        </div>
        {fixes.length ? (
          <ul className="aq-crit-list">
            {fixes.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        ) : (
          <div className="aq-crit-none">passed clean — no fixes needed.</div>
        )}
        {kills.length || styleFailures.length ? (
          <ul className="aq-crit-list aq-crit-bad">
            {kills.map((k, i) => (
              <li key={`k${i}`}>kill: {k}</li>
            ))}
            {styleFailures.map((s, i) => (
              <li key={`s${i}`}>style: {s}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <DraftBody text={item.body_text} />

      {typeof source.sourceText === 'string' && source.sourceText.trim() ? (
        <details className="aq-srctext">
          <summary>stored source text (what the essay was checked against)</summary>
          <pre>{source.sourceText}</pre>
        </details>
      ) : null}

      <QueueItemActions id={item.id} />
    </article>
  )
}

/**
 * The draft-format contract (masthead line / # title / ## sections / > quotes /
 * [PAYWALL]) rendered as readable TEXT — every line is a React text node, never
 * HTML, so nothing the model wrote can ever execute here. Serif for the writing,
 * mono for the machinery ([PAYWALL] divider), per the site's type rule.
 */
function DraftBody({ text }) {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n')
  return (
    <div className="aq-draft">
      {lines.map((raw, i) => {
        const line = raw.trimEnd()
        const t = line.trim()
        if (t === '') return <div key={i} className="aq-blank" aria-hidden="true" />
        if (t === '[PAYWALL]')
          return (
            <div key={i} className="aq-paywall">
              <span>paywall</span>
            </div>
          )
        if (line.startsWith('# ')) return <div key={i} className="aq-h1">{line.slice(2)}</div>
        if (line.startsWith('## ')) return <div key={i} className="aq-h2">{line.slice(3)}</div>
        if (t.startsWith('> ')) return <div key={i} className="aq-quote">{t.slice(2)}</div>
        return (
          <div key={i} className="aq-line">
            {line}
          </div>
        )
      })}
    </div>
  )
}

/* ----------------------------- commission rows ----------------------------- */

const ASG_STATUS_LABEL = {
  open: 'waiting',
  drafted: 'drafted',
  dismissed: 'dismissed',
  failed: 'failed',
}

function AssignmentRow({ item }) {
  const status = String(item.status ?? '')
  return (
    <div className="aq-row">
      <div className="aq-row-top">
        <span className={`aq-status asg-${status}`}>{ASG_STATUS_LABEL[status] ?? status}</span>
        <span className="aq-row-title">{item.subject}</span>
        {status === 'open' || status === 'failed' ? <DismissAssignmentButton id={item.id} /> : null}
      </div>
      {item.notes ? <div className="aq-row-meta">notes: {item.notes}</div> : null}
      <div className="aq-row-meta">
        filed {fmtWhen(item.created_at)} ({ago(item.created_at)})
        {status === 'open' ? ' · drafts on the agent’s next run' : ''}
        {status === 'drafted' && item.drafted_at ? ` · drafted ${fmtWhen(item.drafted_at)} — review it below` : ''}
        {status === 'failed'
          ? ` · ${item.attempts ?? 2} draft attempts died in critique (see recent decisions) — rephrase and re-commission, or dismiss`
          : ''}
      </div>
    </div>
  )
}

/* ------------------------------- audit rows -------------------------------- */

const STATUS_CLASS = {
  approved: 'approved',
  published: 'published',
  vetoed: 'vetoed',
  failed: 'failed',
  discarded: 'discarded',
}

function AuditRow({ item }) {
  const status = String(item.status ?? '')
  return (
    <div className="aq-row">
      <div className="aq-row-top">
        <span className={`aq-status ${STATUS_CLASS[status] ?? ''}`}>{status}</span>
        <span className="aq-row-title">{item.title || '(untitled)'}</span>
      </div>
      <div className="aq-row-meta">
        drafted {fmtWhen(item.created_at)}
        {status === 'approved' && item.approved_at
          ? ` · approved ${fmtWhen(item.approved_at)} — publishes on the agent’s next run`
          : ''}
        {status === 'published' && item.published_at ? ` · published ${fmtWhen(item.published_at)}` : ''}
        {item.post_url ? (
          <>
            {' · '}
            <a href={item.post_url} target="_blank" rel="noreferrer">
              read on site ↗
            </a>
          </>
        ) : null}
        {item.publish_txid ? (
          <>
            {' · '}
            <a
              href={`https://explorer.e.cash/tx/${item.publish_txid}`}
              target="_blank"
              rel="noreferrer"
            >
              tx {shortTxid(item.publish_txid)}
            </a>
          </>
        ) : null}
      </div>
      {item.veto_reason ? <div className="aq-reason">“{item.veto_reason}”</div> : null}
    </div>
  )
}

/* --------------------------------- helpers --------------------------------- */

function asStrings(v) {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => (typeof x === 'string' ? x : x == null ? '' : JSON.stringify(x)))
    .filter(Boolean)
}

const WHEN_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
})

function fmtWhen(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${WHEN_FMT.format(d)} UTC`
}

function ago(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function shortTxid(txid) {
  const t = String(txid ?? '')
  return t.length > 14 ? `${t.slice(0, 8)}…${t.slice(-4)}` : t
}

/* ---------------------------------- styles --------------------------------- */
/* Scoped .aq-* on top of the feed theme. Everything derives from the ~9 theme
   vars, so paper light mode restyles this page for free (and the global paper
   text-shadow kill applies — no new glow is introduced here). */

const AQ_CSS = `
.pow-feed .aq-head{margin:26px 0 6px;font-size:20px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--text);}
.pow-feed .aq-sub{font-size:12px;color:var(--dim);line-height:1.7;margin:0 0 24px;}
.pow-feed .aq-sec{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin:28px 0 10px;font-weight:500;}
.pow-feed .aq-empty{border:1px dashed var(--line);border-radius:14px;color:var(--dim);font-size:12.5px;line-height:1.6;padding:26px 18px;text-align:center;}

/* pending card */
.pow-feed .aq-card{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:16px 16px 14px;margin:0 0 16px;}
.pow-feed .aq-title{font-family:Georgia,'Iowan Old Style','Times New Roman',serif;font-size:19px;font-weight:700;line-height:1.25;color:var(--text);margin:0;}
.pow-feed .aq-meta{font-size:11px;color:var(--dim);margin-top:5px;line-height:1.6;word-break:break-word;}
.pow-feed .aq-srclink{color:var(--cyan);border-bottom:1px solid transparent;transition:border-color .15s;}
.pow-feed .aq-srclink:hover{border-color:var(--cyan);}

/* critique report */
.pow-feed .aq-crit{margin-top:12px;border:1px solid var(--line);border-radius:10px;background:var(--panel2);padding:10px 12px;}
.pow-feed .aq-crit-h{font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--dim);}
.pow-feed .aq-crit-list{margin:7px 0 0;padding-left:16px;display:flex;flex-direction:column;gap:4px;}
.pow-feed .aq-crit-list li{font-size:12px;line-height:1.55;color:var(--text);opacity:.85;}
.pow-feed .aq-crit-bad li{color:var(--no);opacity:1;}
.pow-feed .aq-crit-none{margin-top:6px;font-size:12px;color:var(--dim);}

/* the draft, as text (serif = writing) */
.pow-feed .aq-draft{margin-top:14px;border:1px solid var(--line);border-radius:10px;background:var(--panel2);
  padding:18px 20px;max-height:540px;overflow-y:auto;
  font-family:Georgia,'Iowan Old Style','Times New Roman',serif;font-size:15px;line-height:1.75;color:var(--text);}
.pow-feed .aq-line{white-space:pre-wrap;word-break:break-word;margin:0;}
.pow-feed .aq-blank{height:.9em;}
.pow-feed .aq-h1{font-size:20px;font-weight:700;line-height:1.3;margin:2px 0 4px;}
.pow-feed .aq-h2{font-size:16.5px;font-weight:700;line-height:1.35;margin:6px 0 2px;}
.pow-feed .aq-quote{border-left:2px solid var(--line);padding-left:12px;font-style:italic;color:var(--dim);white-space:pre-wrap;word-break:break-word;}
.pow-feed .aq-paywall{display:flex;align-items:center;gap:10px;margin:12px 0;color:var(--no);
  font-family:'JetBrains Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;}
.pow-feed .aq-paywall::before,.pow-feed .aq-paywall::after{content:"";height:1px;background:var(--line);flex:1;}

/* stored source text (provenance) */
.pow-feed .aq-srctext{margin-top:10px;}
.pow-feed .aq-srctext summary{cursor:pointer;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);transition:color .15s;}
.pow-feed .aq-srctext summary:hover{color:var(--cyan);}
.pow-feed .aq-srctext pre{margin:8px 0 0;border:1px solid var(--line);border-radius:10px;background:var(--panel2);
  padding:12px;max-height:260px;overflow:auto;white-space:pre-wrap;word-break:break-word;
  font-size:11.5px;line-height:1.6;color:var(--dim);}

/* actions */
.pow-feed .aq-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:14px;}
.pow-feed .aq-btn{font:inherit;font-size:12px;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;
  background:transparent;color:var(--dim);border:1px solid var(--line);border-radius:8px;padding:8px 14px;
  transition:border-color .15s,box-shadow .15s,color .15s;}
.pow-feed .aq-btn:hover:not(:disabled){border-color:var(--dim);}
.pow-feed .aq-btn:disabled{opacity:.55;cursor:default;}
.pow-feed .aq-approve{color:var(--neon);}
.pow-feed .aq-approve:hover:not(:disabled){border-color:var(--neon);box-shadow:0 0 16px rgba(0,255,156,.3);}
.pow-feed .aq-vetobtn{color:var(--no);}
.pow-feed .aq-vetobtn:hover:not(:disabled){border-color:var(--no);box-shadow:0 0 16px rgba(255,92,108,.25);}
.pow-feed .aq-armnote{font-size:11px;color:var(--dim);line-height:1.5;}
.pow-feed .aq-vetoform{display:flex;flex-direction:column;gap:8px;width:100%;}
.pow-feed .aq-vetoform textarea{width:100%;min-height:74px;resize:vertical;background:var(--panel2);color:var(--text);
  border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:inherit;font-size:13px;line-height:1.6;}
.pow-feed .aq-vetoform textarea:focus{outline:none;border-color:var(--no);}
.pow-feed .aq-vetoform textarea::placeholder{color:var(--dim);opacity:.8;}
.pow-feed .aq-vetorow{display:flex;gap:10px;align-items:center;}
.pow-feed .aq-error{width:100%;font-size:12px;color:var(--no);line-height:1.5;}
.pow-feed .aq-done{margin-top:14px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--neon);}

/* commission box */
.pow-feed .aq-comm{display:flex;flex-direction:column;gap:8px;border:1px solid var(--line);border-radius:14px;
  background:var(--panel);padding:14px;margin-bottom:12px;}
.pow-feed .aq-comm input,.pow-feed .aq-comm textarea{width:100%;background:var(--panel2);color:var(--text);
  border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:inherit;font-size:13px;line-height:1.6;}
.pow-feed .aq-comm textarea{resize:vertical;min-height:52px;}
.pow-feed .aq-comm input:focus,.pow-feed .aq-comm textarea:focus{outline:none;border-color:var(--neon);}
.pow-feed .aq-comm input::placeholder,.pow-feed .aq-comm textarea::placeholder{color:var(--dim);opacity:.8;}
.pow-feed .aq-commrow{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
.pow-feed .aq-flash{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--neon);}
.pow-feed .aq-audit.aq-asglist{margin-bottom:8px;background:var(--panel);}
.pow-feed .aq-status.asg-open{color:var(--cyan);border-color:var(--cyan);}
.pow-feed .aq-status.asg-drafted{color:var(--neon);border-color:var(--neon);}
.pow-feed .aq-status.asg-failed{color:var(--no);border-color:var(--no);}
.pow-feed .aq-btn.aq-dismiss{padding:4px 10px;font-size:10.5px;}

/* audit list */
.pow-feed .aq-audit{border:1px solid var(--line);border-radius:14px;background:var(--panel2);padding:4px 14px;margin-bottom:40px;}
.pow-feed .aq-row{padding:11px 0;border-bottom:1px solid var(--line);}
.pow-feed .aq-row:last-child{border-bottom:none;}
.pow-feed .aq-row-top{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;}
.pow-feed .aq-status{flex:none;font-size:10px;letter-spacing:.18em;text-transform:uppercase;border:1px solid var(--line);border-radius:6px;padding:2px 7px;color:var(--dim);}
.pow-feed .aq-status.approved{color:var(--cyan);border-color:var(--cyan);}
.pow-feed .aq-status.published{color:var(--neon);border-color:var(--neon);}
.pow-feed .aq-status.vetoed,.pow-feed .aq-status.failed{color:var(--no);border-color:var(--no);}
.pow-feed .aq-row-title{font-family:Georgia,'Iowan Old Style','Times New Roman',serif;font-size:14.5px;color:var(--text);line-height:1.35;}
.pow-feed .aq-row-meta{font-size:11px;color:var(--dim);margin-top:3px;line-height:1.6;word-break:break-word;}
.pow-feed .aq-row-meta a{color:var(--cyan);}
.pow-feed .aq-row-meta a:hover{border-bottom:1px solid var(--cyan);}
.pow-feed .aq-reason{font-size:12px;color:var(--text);opacity:.85;margin-top:4px;line-height:1.55;white-space:pre-wrap;word-break:break-word;}
`
