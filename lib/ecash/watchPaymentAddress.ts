// =============================================================================
//  lib/ecash/watchPaymentAddress.ts  —  CLIENT-SIDE payment nudge (browser only)
//
//  A payment page normally polls its own status endpoint on a timer (every
//  1.2–2.5s), so it notices a payment on average half an interval late. This
//  helper opens a Chronik WEBSOCKET in the user's tab and watches the exact
//  address the payment is going to. The instant Chronik pushes a tx touching
//  that address (mempool first-seen, no timer), we fire the caller's callback —
//  which simply triggers an immediate status poll instead of waiting for the
//  next tick. Detection collapses from "up to one interval" to "one round-trip".
//
//  This is a NUDGE, never an authority. The server still verifies the payment
//  (amount + OP_RETURN) and still gates value delivery on Avalanche finality
//  (lib/ecash/finality.ts). A spurious or unrelated tx on the watched address
//  costs at most one wasted poll — it can never unlock anything on its own. If
//  the socket never opens (blocked/offline), the existing interval poll still
//  covers the flow unchanged. Websockets belong on the CLIENT for snappy labels;
//  the backend stays poll-based because Vercel serverless can't hold a socket.
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

/**
 * Open a Chronik websocket, subscribe to `address`, and call `onTx(txid)` the
 * moment any tx touching that address is seen. Returns a disposer that
 * unsubscribes and closes the socket — call it from a useEffect cleanup.
 *
 * Safe to call in a browser client component only. No-ops (returns a disposer
 * that does nothing) if `address` is falsy or `window` is undefined.
 */
export function watchPaymentAddress(
  address: string | null | undefined,
  onTx: (txid: string, msgType: string) => void,
): () => void {
  if (!address || typeof window === "undefined") return () => {};

  let endpoint: WsEndpoint | null = null;
  let disposed = false;

  (async () => {
    try {
      const ws = client().ws({
        autoReconnect: true,
        onMessage: (msg: WsMsgClient) => {
          if (disposed) return;
          if (msg.type === "Tx" && POSITIVE.has(msg.msgType)) {
            try { onTx(msg.txid, msg.msgType); } catch { /* caller's problem */ }
          }
        },
        // Swallow socket errors — the interval poll is the safety net.
        onError: () => {},
      });
      await ws.waitForOpen();
      if (disposed) { try { ws.close(); } catch { /* already gone */ } return; }
      ws.subscribeToAddress(address);
      endpoint = ws;
    } catch {
      // No websocket (blocked, offline, node down) — polling still covers us.
    }
  })();

  return () => {
    disposed = true;
    if (!endpoint) return;
    try { endpoint.unsubscribeFromAddress(address); } catch { /* ignore */ }
    try { endpoint.close(); } catch { /* ignore */ }
    endpoint = null;
  };
}
