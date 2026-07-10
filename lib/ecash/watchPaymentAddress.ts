// =============================================================================
//  lib/ecash/watchPaymentAddress.ts  —  CLIENT-SIDE payment nudge (browser only)
//
//  A payment page normally polls its own status endpoint on a timer (every
//  1.2–2.5s), so it notices a payment on average half an interval late. This
//  helper watches the exact address a payment is going to over a Chronik
//  WEBSOCKET and, the instant Chronik pushes a tx touching it, fires the
//  caller's callback — which triggers an immediate status poll instead of
//  waiting for the next tick.
//
//  WHY ONE SHARED, PERSISTENT SOCKET (not one per payment):
//  Opening a fresh chronik-client ws costs ~1.7s to reach a live subscription —
//  it double-handshakes (a throwaway pre-flight PROBE socket, THEN the real
//  one). Chronik only pushes txs that enter the mempool AFTER the subscription
//  is live, so anything paid inside that ~1.7s window is MISSED and falls back
//  to the interval poll. A one-tap like/repost is often approved that fast,
//  which is exactly why reactions felt slower than composed posts. Keeping ONE
//  socket warm for the session makes every subscription a single frame that
//  activates in milliseconds — and prewarmPaymentWatch() opens it at the start
//  of a pay gesture so even the first action's handshake hides behind the
//  /prepare round-trip and the human's Cashtab approval.
//
//  This is a NUDGE, never an authority. The server still verifies the payment
//  (amount + OP_RETURN) and still gates value delivery on Avalanche finality
//  (lib/ecash/finality.ts). A spurious tx costs at most one wasted poll; if the
//  socket never opens, the interval poll still covers the flow unchanged.
// =============================================================================

import { ChronikClient, type WsEndpoint, type WsMsgClient } from "chronik-client";
import { CHRONIK_URLS } from "./chronikEndpoints";

let _client: ChronikClient | null = null;
const client = () => (_client ??= new ChronikClient(CHRONIK_URLS));

// A tx message worth reacting to: the payment has appeared on-chain in some
// form. We poll on ANY of these — the server decides what it means.
const POSITIVE: ReadonlySet<string> = new Set([
  "TX_ADDED_TO_MEMPOOL",
  "TX_CONFIRMED",
  "TX_FINALIZED",
]);

type Listener = (txid: string, msgType: string) => void;

// --- the one shared session socket -----------------------------------------
let _ws: WsEndpoint | null = null;
let _opening = false;
const _listeners = new Set<Listener>();
// Ref-count subscriptions per address so overlapping watches on the same
// address don't unsubscribe each other.
const _subCounts = new Map<string, number>();

function dispatch(msg: WsMsgClient) {
  if (msg.type !== "Tx" || !POSITIVE.has(msg.msgType)) return;
  // A Tx message carries only { txid, msgType } — NOT which subscribed address
  // matched — so fan out to every active listener. Each listener re-verifies
  // its own payment server-side, so a cross-fire is at worst one harmless extra
  // poll; in practice only one payment is pending at a time.
  for (const cb of _listeners) {
    try { cb(msg.txid, msg.msgType); } catch { /* listener's problem */ }
  }
}

// Create + connect the shared socket once, then keep it warm for the session.
// Subscriptions added before it opens are queued by chronik-client and flushed
// on open, so callers never need to await this.
function ensureSocket(): WsEndpoint | null {
  if (typeof window === "undefined") return null;
  if (_ws || _opening) return _ws;
  _opening = true;
  try {
    // Deliberately NO onError handler: chronik-client treats a defined onError
    // as a signal to close-WITHOUT-reconnect, which would kill this persistent
    // socket on the first transient blip. Leaving it undefined lets
    // autoReconnect rotate to the next endpoint and re-send all subscriptions.
    const ws = client().ws({ autoReconnect: true, onMessage: dispatch });
    _ws = ws;
    ws.waitForOpen()
      .catch(() => { if (_ws === ws) _ws = null; }) // all endpoints down → retry next call; poll still covers us
      .finally(() => { _opening = false; });
  } catch {
    _ws = null;
    _opening = false;
  }
  return _ws;
}

/**
 * Pre-open the shared socket so the next subscription activates instantly.
 * Call synchronously at the START of a pay click gesture (before the /prepare
 * round-trip) so the ~1.7s first-open handshake hides behind /prepare + the
 * user's Cashtab approval. Idempotent and cheap — safe to call on every click.
 */
export function prewarmPaymentWatch(): void {
  ensureSocket();
}

/**
 * Watch `address` on the shared socket and call `onTx(txid)` the moment any tx
 * touching it is seen. Returns a disposer that drops this watch (and its
 * address subscription) but leaves the socket warm for the next payment. Call
 * the disposer from a useEffect cleanup.
 *
 * Browser-only. No-ops (returns a do-nothing disposer) if `address` is falsy or
 * `window` is undefined.
 */
export function watchPaymentAddress(
  address: string | null | undefined,
  onTx: Listener,
): () => void {
  if (!address || typeof window === "undefined") return () => {};

  _listeners.add(onTx);
  const ws = ensureSocket();
  const n = _subCounts.get(address) ?? 0;
  if (ws && n === 0) {
    // Safe before the socket is open — chronik-client queues the sub and sends
    // it on connect (and re-sends it on every reconnect).
    try { ws.subscribeToAddress(address); } catch { /* bad addr — poll covers it */ }
  }
  _subCounts.set(address, n + 1);

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    _listeners.delete(onTx);
    const c = _subCounts.get(address) ?? 0;
    if (c <= 1) {
      _subCounts.delete(address);
      try { _ws?.unsubscribeFromAddress(address); } catch { /* ignore */ }
    } else {
      _subCounts.set(address, c - 1);
    }
    // Intentionally leave the socket OPEN — keeping it warm is the whole point.
  };
}
