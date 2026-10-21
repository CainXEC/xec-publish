import { notFound } from 'next/navigation'
import { getAuthedAccount } from '@/lib/authHelpers'
import { adminDb } from '@/lib/db'
import { ordersNeedingAttention, CLAIM_GRACE_SEC } from '@/lib/mintPaymentAlerts'
import { FEED_CSS } from '@/components/feed/feedTheme'
import FeedTopbar from '@/components/feed/FeedTopbar'
import DismissMintAlert from '@/components/admin/DismissMintAlert'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Mint money — proofofwriting',
  robots: { index: false, follow: false },
}

// =============================================================================
//  /admin/mints — mint money that needs a person (lib/mintPaymentAlerts).
//
//  Two lists: payments to the mint wallet that no order claimed (recorded by
//  the 5-minute cron in mint_payment_alerts), and orders holding a payment they
//  haven't finished with (stuck / refund failed / overdue). Reached from the
//  admin bell. Gated by getAuthedAccount().isAdmin, 404 for everyone else.
//  Nothing here moves money — it only makes sure none of it sits unnoticed.
// =============================================================================

const ATTENTION_TEXT = {
  delivery_stuck:
    'Delivery owed. The mint failed repeatedly and was parked for review. Fix the cause, then deliver (or refund) by hand.',
  refund_failed:
    'Refund owed. The name couldn’t be delivered, the refund didn’t broadcast, and nothing retries it.',
  delivery_overdue:
    'Paid over an hour ago and still not delivered. The reconciler keeps retrying; look if it stays here.',
  refund_overdue:
    'Lost a double-buy over an hour ago and the refund still hasn’t gone out. The reconciler keeps retrying.',
}

const ATTENTION_LABEL = {
  delivery_stuck: 'stuck',
  refund_failed: 'refund owed',
  delivery_overdue: 'delivery late',
  refund_overdue: 'refund late',
}

export default async function MintMoneyPage() {
  const acct = await getAuthedAccount()
  if (!acct?.isAdmin) notFound()

  const supabase = adminDb()
  const [openQ, resolvedQ, orders] = await Promise.all([
    supabase
      .from('mint_payment_alerts')
      .select('*')
      .is('resolved_at', null)
      .order('seen_at', { ascending: false })
      .limit(100),
    supabase
      .from('mint_payment_alerts')
      .select('*')
      .not('resolved_at', 'is', null)
      .order('resolved_at', { ascending: false })
      .limit(20),
    ordersNeedingAttention(supabase).catch((e) => ({ error: String(e?.message ?? e) })),
  ])
  // Before sql/mint_payment_alerts.sql has run the table is missing; the
  // orders list below must keep working.
  const alertsError = openQ.error?.message ?? null
  const open = openQ.data ?? []
  const resolved = resolvedQ.data ?? []
  const ordersError = Array.isArray(orders) ? null : orders.error
  const owed = Array.isArray(orders) ? orders : []

  // Name the order a tagged payment was meant for, when that intent exists.
  const tagged = [...new Set(open.map((a) => a.mint_id).filter(Boolean))]
  const { data: intents } = tagged.length
    ? await supabase.from('pending_mints').select('id, handle, status').in('id', tagged)
    : { data: [] }
  const intentById = new Map((intents ?? []).map((r) => [r.id, r]))

  return (
    <div className="pow-feed">
      <style>{FEED_CSS}</style>
      <style>{MM_CSS}</style>
      <FeedTopbar signedIn isAuthor={Boolean(acct.authorId)} />
      <main className="wrap">
        <h1 className="aq-head">Mint money</h1>
        <p className="aq-sub">
          Buyers’ money the handle-mint pipeline hasn’t finished with. Nothing on this page moves
          money: it makes sure none of it sits unnoticed. A payment shows up here once it has gone{' '}
          {Math.round(CLAIM_GRACE_SEC / 60)} minutes without an order taking it, and clears by
          itself when one does.
        </p>

        <h2 className="aq-sec">unclaimed payments{open.length ? ` · ${open.length}` : ''}</h2>
        {alertsError ? (
          <div className="aq-empty">
            Unclaimed-payment alerts need the mint_payment_alerts table — run
            sql/mint_payment_alerts.sql in the Supabase SQL editor. ({alertsError})
          </div>
        ) : open.length === 0 ? (
          <div className="aq-empty">
            Nothing unclaimed. Every purchase-sized payment to the mint wallet in the last 7 days
            was taken by an order.
          </div>
        ) : (
          open.map((a) => <AlertCard key={a.txid} alert={a} intent={intentById.get(a.mint_id)} />)
        )}

        <h2 className="aq-sec">orders holding a payment{owed.length ? ` · ${owed.length}` : ''}</h2>
        {ordersError ? (
          <div className="aq-empty">Couldn’t load orders: {ordersError}</div>
        ) : owed.length === 0 ? (
          <div className="aq-empty">None. Every paid order was delivered or refunded.</div>
        ) : (
          <div className="aq-audit">
            {owed.map((o) => (
              <OrderRow key={o.id} order={o} />
            ))}
          </div>
        )}

        {resolved.length ? (
          <>
            <h2 className="aq-sec">recently resolved</h2>
            <div className="aq-audit">
              {resolved.map((a) => (
                <ResolvedRow key={a.txid} alert={a} />
              ))}
            </div>
          </>
        ) : null}
      </main>
    </div>
  )
}

/* -------------------------------- rows -------------------------------- */

function AlertCard({ alert, intent }) {
  return (
    <div className="aq-card">
      <div className="aq-row-top">
        <span className="aq-status failed">unclaimed</span>
        <span className="aq-row-title">{amountLabel(alert.sats, alert.pow_atoms)}</span>
      </div>
      <div className="aq-meta">
        from {alert.payer_address ?? 'unknown sender'}
        <br />
        first seen {fmtWhen(alert.seen_at)} ({ago(alert.seen_at)}) ·{' '}
        <TxLink txid={alert.txid} />
        <br />
        {alert.mint_id
          ? intent
            ? `tagged for the @${intent.handle} order (now ${intent.status})`
            : `tagged for order ${alert.mint_id}, which doesn’t exist`
          : Number(alert.pow_atoms) > 0
            ? 'a POW send (POW never carries an order tag)'
            : 'no order tag — likely sent by hand to the copied address'}
      </div>
      <DismissMintAlert txid={alert.txid} />
    </div>
  )
}

function OrderRow({ order }) {
  const amount =
    order.pay_token === 'pow'
      ? `${order.expected_atoms ?? '?'} POW`
      : amountLabel(order.expected_sats, 0)
  return (
    <div className="aq-row">
      <div className="aq-row-top">
        <span className="aq-status failed">{ATTENTION_LABEL[order.attention]}</span>
        <span className="aq-row-title">@{order.handle}</span>
      </div>
      <div className="aq-reason">{ATTENTION_TEXT[order.attention]}</div>
      <div className="aq-row-meta">
        {amount} · status {order.status} · intent {fmtWhen(order.created_at)} ({ago(order.created_at)})
        {order.attempts ? ` · ${order.attempts} mint attempt${order.attempts === 1 ? '' : 's'}` : ''}
        {order.payer_address ? ` · payer ${order.payer_address}` : ''}
        {order.payment_txid ? (
          <>
            {' · '}
            <TxLink txid={order.payment_txid} />
          </>
        ) : null}
        <br />
        order {order.id}
        {order.error ? ` · last error: ${order.error}` : ''}
      </div>
    </div>
  )
}

function ResolvedRow({ alert }) {
  return (
    <div className="aq-row">
      <div className="aq-row-top">
        <span className={`aq-status ${alert.resolution === 'claimed' ? 'published' : ''}`}>
          {alert.resolution}
        </span>
        <span className="aq-row-title">{amountLabel(alert.sats, alert.pow_atoms)}</span>
      </div>
      <div className="aq-row-meta">
        {alert.resolution === 'claimed' ? 'taken by an order' : 'dismissed'} {fmtWhen(alert.resolved_at)} ·{' '}
        <TxLink txid={alert.txid} />
      </div>
      {alert.note ? <div className="aq-reason">{alert.note}</div> : null}
    </div>
  )
}

function TxLink({ txid }) {
  return (
    <a href={`https://explorer.e.cash/tx/${txid}`} target="_blank" rel="noreferrer">
      tx {shortTxid(txid)}
    </a>
  )
}

/* --------------------------------- helpers --------------------------------- */

/** "10,000 XEC", or "10 POW" for a POW send (whose XEC is just 546-sat dust). */
function amountLabel(sats, powAtoms) {
  if (Number(powAtoms) > 0) return `${Number(powAtoms).toLocaleString('en-US')} POW`
  return `${(Number(sats) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} XEC`
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

// Same look as /admin/agent (same class names; only this page loads this copy).
const MM_CSS = `
.pow-feed .aq-head{margin:26px 0 6px;font-size:20px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--text);}
.pow-feed .aq-sub{font-size:12px;color:var(--dim);line-height:1.7;margin:0 0 24px;}
.pow-feed .aq-sec{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin:28px 0 10px;font-weight:500;}
.pow-feed .aq-empty{border:1px dashed var(--line);border-radius:14px;color:var(--dim);font-size:12.5px;line-height:1.6;padding:26px 18px;text-align:center;}
.pow-feed .aq-card{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:16px 16px 14px;margin:0 0 16px;}
.pow-feed .aq-meta{font-size:11px;color:var(--dim);margin-top:5px;line-height:1.6;word-break:break-word;}
.pow-feed .aq-meta a,.pow-feed .aq-row-meta a{color:var(--cyan);}
.pow-feed .aq-meta a:hover,.pow-feed .aq-row-meta a:hover{border-bottom:1px solid var(--cyan);}
.pow-feed .aq-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:14px;}
.pow-feed .aq-btn{font:inherit;font-size:12px;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;
  background:transparent;color:var(--dim);border:1px solid var(--line);border-radius:8px;padding:8px 14px;
  transition:border-color .15s,box-shadow .15s,color .15s;}
.pow-feed .aq-btn:hover:not(:disabled){border-color:var(--dim);}
.pow-feed .aq-btn:disabled{opacity:.55;cursor:default;}
.pow-feed .aq-vetoform{display:flex;flex-direction:column;gap:8px;width:100%;}
.pow-feed .aq-vetoform textarea{width:100%;min-height:74px;resize:vertical;background:var(--panel2);color:var(--text);
  border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:inherit;font-size:13px;line-height:1.6;}
.pow-feed .aq-vetoform textarea:focus{outline:none;border-color:var(--cyan);}
.pow-feed .aq-vetoform textarea::placeholder{color:var(--dim);opacity:.8;}
.pow-feed .aq-vetorow{display:flex;gap:10px;align-items:center;}
.pow-feed .aq-error{width:100%;font-size:12px;color:var(--no);line-height:1.5;}
.pow-feed .aq-done{margin-top:14px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--neon);}
.pow-feed .aq-audit{border:1px solid var(--line);border-radius:14px;background:var(--panel2);padding:4px 14px;margin-bottom:40px;}
.pow-feed .aq-row{padding:11px 0;border-bottom:1px solid var(--line);}
.pow-feed .aq-row:last-child{border-bottom:none;}
.pow-feed .aq-row-top{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;}
.pow-feed .aq-status{flex:none;font-size:10px;letter-spacing:.18em;text-transform:uppercase;border:1px solid var(--line);border-radius:6px;padding:2px 7px;color:var(--dim);}
.pow-feed .aq-status.published{color:var(--neon);border-color:var(--neon);}
.pow-feed .aq-status.failed{color:var(--no);border-color:var(--no);}
.pow-feed .aq-row-title{font-family:Georgia,'Iowan Old Style','Times New Roman',serif;font-size:14.5px;color:var(--text);line-height:1.35;}
.pow-feed .aq-row-meta{font-size:11px;color:var(--dim);margin-top:3px;line-height:1.6;word-break:break-word;}
.pow-feed .aq-reason{font-size:12px;color:var(--text);opacity:.85;margin-top:4px;line-height:1.55;white-space:pre-wrap;word-break:break-word;}
`
