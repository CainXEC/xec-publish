"use client";
// =============================================================================
//  MintHandle.tsx  —  the handle mint flow (client component)
//  Cypherpunk-neon (scoped to .pow-mint). Rendered inside MarketplaceShell,
//  which owns the page backdrop, the shared topbar, and the gallery beside/
//  below this flow — this component is JUST the mint column.
//  Blind reveal: a covered "mystery" card shows until the mint clears, then the
//  real card is revealed (seeded from the mint tx id).
//
//  Talks to: GET /api/handles/check, POST /api/mint/intent, GET /api/mint/status
//  Deps: qrcode.react. Font (JetBrains Mono) is loaded scoped in the style block.
// =============================================================================

import { useState, useEffect, useRef, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import { renderMysteryCard } from "@/lib/renderHandleCard";
import { watchPaymentAddress, prewarmPaymentWatch } from "@/lib/ecash/watchPaymentAddress";
import { payWithCashtab, beginCashtabPayment, completeCashtabPayment, abortCashtabPayment } from "@/lib/ecash/cashtabPay";
import MintCounter from "@/components/MintCounter";

type Availability = { available?: boolean; status: string; priceXec?: number; tier?: string; auctionOnly?: boolean; reason?: string };
type Intent = { mintId: string; handle: string; amountXec: string; address: string; bip21Url: string; expiresAt: string };

const STATUS_COPY: Record<string, string> = {
  invalid: "Letters, numbers and single underscores only — 1 to 15 characters.",
  taken: "Already claimed.",
  reserved: "Reserved.",
  pending: "Someone is minting this right now.",
  auction: "Premium name — released by auction, not direct mint.",
  sold_out: "Sold out — all 10,000 handles have been minted.",
};

export default function MintHandle({
  signedIn = false,
  // Autofocus the name field on mount — the default, so the mint flow is ready to
  // type. Suppressed when the marketplace is opened on a holder deep-link, where
  // focusing (and its scroll-into-view + mobile keyboard) would fight the
  // auto-scroll that lands the viewport on that holder's handles below.
  autoFocus = true,
}: {
  signedIn?: boolean;
  autoFocus?: boolean;
}) {
  const [handle, setHandle] = useState("");
  const [avail, setAvail] = useState<Availability | null>(null);
  const [checking, setChecking] = useState(false);
  const [phase, setPhase] = useState<"choose" | "pay" | "done">("choose");
  // Client-side focus of the name field on mount when autoFocus is on (see the
  // input's ref comment for why it isn't the autoFocus attribute).
  const nameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) nameInputRef.current?.focus();
    // Run once on mount — mirrors the autoFocus attribute's "focus when inserted".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [statusMsg, setStatusMsg] = useState("Waiting for payment");
  // True once the payment lands on-chain (finalizing or minting). Flips the pay
  // screen from the QR/send prompt to a clear "payment received" indicator, so
  // the user knows the site saw their payment during the ~2-3s finality wait.
  const [paymentSeen, setPaymentSeen] = useState(false);
  // Second stage of the post-payment tracker: true once the payment is final and
  // the on-chain NFT mint is actually running, so the tracker advances from
  // "finalizing" to "minting". Driven by the 'processing' status (a concurrent
  // poll that can't grab the serialized mint lock returns it) and, as a fallback,
  // by a poll that stays in flight for a while (the request doing the mint is the
  // slow one) — whichever we notice first.
  const [mintingActive, setMintingActive] = useState(false);
  // The backend collapses "detected" and "finalizing" into one status, but the
  // tracker reads more clearly as three beats. Briefly hold on "Payment detected"
  // the moment payment lands, then advance the headline to "Payment finalizing".
  const [detectedBeat, setDetectedBeat] = useState(false);
  const [result, setResult] = useState<{ childTokenId?: string; imageUrl?: string } | null>(null);
  const [txidInput, setTxidInput] = useState("");
  const [notice, setNotice] = useState("");
  // Terminal failure (payment landed but the mint couldn't complete — usually the
  // name was taken first — and the XEC was auto-refunded). Drives a prominent
  // failure panel instead of a red note under the pay screen.
  const [failure, setFailure] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  // Latch: once the payment is seen on-chain we commit to the "minting" screen
  // and never bounce back to the QR/waiting view, even if a later poll transiently
  // reports awaiting_payment (Chronik race). Only a terminal error clears it.
  const paidSeenRef = useRef(false);
  // Web Audio context for the reveal chime. Created + resumed inside the Mint
  // click (a user gesture) so browser autoplay policy lets us play the sound
  // seconds later when the card reveals, long after the click.
  const audioCtxRef = useRef<AudioContext | null>(null);

  const display = handle.trim();
  const mysterySvg = renderMysteryCard(display);

  // Open the Cashtab WEB wallet in a tab, pre-filled (avoids the OS ecash: handler).
  // MUST use the ?bip21= form (only the full BIP21 URI carries op_return_raw), and
  // the value is passed RAW — no encodeURIComponent — exactly like the paywall
  // call sites. Cashtab's hash router expects the literal
  // "ecash:ADDR?amount=X&op_return_raw=Y"; escaping it breaks address + amount.
  const cashtabUrl = intent
    ? `https://cashtab.com/#/send?bip21=${intent.bip21Url}`
    : "#";

  const copyAddr = async () => {
    if (!intent) return;
    try { await navigator.clipboard.writeText(intent.address); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  // ---- live availability (debounced) ----
  useEffect(() => {
    if (phase !== "choose") return;
    if (!display) { setAvail(null); return; }
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/handles/check?handle=${encodeURIComponent(display)}`);
        setAvail(await r.json());
      } catch { setAvail(null); }
      finally { setChecking(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [display, phase]);

  // ---- start a mint (lock + payment request) ----
  const startMint = useCallback(async () => {
    setNotice("");
    setFailure(null);
    setPaymentSeen(false);
    setMintingActive(false);
    paidSeenRef.current = false;
    prewarmPaymentWatch(); // warm the shared socket during intent + Cashtab approval
    // Prime the audio context on this gesture so the reveal chime can fire later.
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        if (!audioCtxRef.current) audioCtxRef.current = new AC();
        void audioCtxRef.current.resume();
      }
    } catch { /* no audio — reveal is still silent-safe */ }
    // Decide extension-vs-tab AT the click gesture (never both). With the
    // Cashtab extension this opens nothing; without it, it pre-opens about:blank
    // so the deep link survives popup blockers once the intent (and its bip21)
    // lands.
    const gesture = beginCashtabPayment();
    try {
      const r = await fetch("/api/mint/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: display }),
      });
      const j = await r.json();
      if (!j.ok) {
        abortCashtabPayment(gesture);
        setNotice(STATUS_COPY[j.status] ?? j.reason ?? j.error ?? "Couldn't start the mint. Try again.");
        return;
      }
      // Money-flow guard: the amount we're about to hand Cashtab MUST equal the
      // price the page showed. The two come from separate round-trips (check
      // vs intent); they should never disagree, but if they ever do — a stale
      // cached bundle, a future regression, anything — refuse rather than
      // silently overcharge (a user reported a 10K quote that hit Cashtab as
      // 1M). The server price stays authoritative; this only blocks a mismatch.
      const shownXec = avail?.available ? Number(avail.priceXec) : null;
      const payXec = Number(j.amountXec);
      if (
        shownXec != null && Number.isFinite(shownXec) && Number.isFinite(payXec) &&
        payXec !== shownXec
      ) {
        abortCashtabPayment(gesture);
        setNotice(
          `Price mismatch: the page showed ${shownXec.toLocaleString()} XEC but the mint would charge ${payXec.toLocaleString()} XEC. Refresh the page and try again.`,
        );
        return;
      }
      setIntent(j);
      setPhase("pay");
      const url = `https://cashtab.com/#/send?bip21=${j.bip21Url}`;
      // Extension popup or the pre-opened tab — exactly one. On a rejected popup
      // we stay on the pay screen; the QR and "Open in Cashtab" below let them
      // retry against the already-locked handle.
      void completeCashtabPayment(gesture, { bip21: j.bip21Url, cashtabUrl: url }).then((res) => {
        if (!res.ok && res.reason === "denied") {
          setNotice("Mint payment cancelled — use “Open in Cashtab” or the QR code to try again.");
        }
      });
    } catch {
      abortCashtabPayment(gesture);
      setNotice("Network hiccup — try again.");
    }
  }, [display, avail]);

  // Re-open Cashtab from the pay screen (intent already in hand): extension if
  // present, else a web tab — exactly one, never both.
  const openCashtab = () => {
    if (!intent) return;
    void payWithCashtab({ bip21: intent.bip21Url, cashtabUrl });
  };

  // ---- poll status while paying ----
  useEffect(() => {
    if (phase !== "pay" || !intent) return;
    let stopped = false;
    const apply = (j: any) => {
      if (j.status === "minted") { setResult(j); setPhase("done"); }
      // Terminal failure after payment: keep the minting tracker on screen and
      // flip it to a clear failure state (the reason + refund), rather than
      // demoting to "waiting for payment" with a red note hidden below.
      else if (j.status === "refunded") {
        const soldOut = /sold out/i.test(String(j.error ?? ""));
        setPaymentSeen(true); setMintingActive(true); setNotice("");
        setFailure(soldOut
          ? "The collection sold out before your payment landed. A refund has been issued — try again later."
          : "The handle wasn't available when your payment landed. A refund has been issued. Pick another name.");
      }
      else if (j.status === "failed") { setPaymentSeen(true); setMintingActive(true); setNotice(""); setFailure("The mint didn't complete. If your payment went through, a refund is on its way. Pick another name."); }
      else if (j.status === "expired") { paidSeenRef.current = false; setPaymentSeen(false); setMintingActive(false); setNotice("This quote expired before payment. Start again to mint the name."); setPhase("choose"); setIntent(null); }
      // Payment is on-chain now — commit to the minting screen and stay there, and
      // advance the tracker: 'finalizing' = payment detected, awaiting Avalanche
      // finality; 'processing' = final + the NFT genesis is actually being minted.
      else if (j.status === "processing") { paidSeenRef.current = true; setPaymentSeen(true); setMintingActive(true); }
      else if (j.status === "finalizing") { paidSeenRef.current = true; setPaymentSeen(true); }
      // Still awaiting the payment — but never demote out of the minting screen
      // once we've latched it (a transient awaiting_payment is just a Chronik race).
      else if (!paidSeenRef.current) { setPaymentSeen(false); setStatusMsg("Waiting for payment"); }
    };
    const poll = async (txid?: string) => {
      // Once the payment is seen, the request that actually mints the NFT is the
      // slow one (finality re-checks return in well under a second). If a poll
      // stays in flight past this threshold, treat it as the mint running and
      // advance the tracker to "minting" even before we observe a 'processing'.
      let longTimer: ReturnType<typeof setTimeout> | undefined;
      if (paidSeenRef.current) {
        longTimer = setTimeout(() => { if (!stopped) setMintingActive(true); }, 1200);
      }
      try {
        const url = `/api/mint/status?mintId=${intent.mintId}` + (txid ? `&txid=${encodeURIComponent(txid)}` : "");
        const r = await fetch(url);
        if (!stopped) apply(await r.json());
      } catch { /* keep polling */ }
      finally { if (longTimer) clearTimeout(longTimer); }
    };
    poll();
    // Poll a touch faster than the old 2s so the UI reacts sooner once the
    // payment finalizes and once the on-chain mint lands. This only shortens the
    // dead time between polls — it does NOT weaken the finality gate, which still
    // holds the mint until Chronik reports the funding tx Avalanche-final.
    const id = setInterval(() => !stopped && poll(), 1200);
    // Live nudge: a Chronik websocket watching the deposit address fires an
    // immediate poll (with the txid) the instant the payment hits the mempool,
    // instead of waiting up to 1.2s for the next tick. Pure detection speedup —
    // the finality gate on the server is unchanged.
    // Third arg = wake (tab foregrounded / ws reconnect): poll immediately in
    // case the payment broadcast while the tab was suspended in Cashtab.
    const stopWatch = watchPaymentAddress(intent.address, (txid) => { if (!stopped) poll(txid); }, () => { if (!stopped) poll(); });
    return () => { stopped = true; clearInterval(id); stopWatch(); };
  }, [phase, intent]);

  // ---- countdown to expiry ----
  useEffect(() => {
    if (phase !== "pay" || !intent) { setSecondsLeft(null); return; }
    const tick = () => setSecondsLeft(Math.max(0, Math.round((new Date(intent.expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase, intent]);

  // A short, bright arpeggio + sparkle synthesized on the fly — the celebratory
  // "ta-da" when the mystery card flips to the real one. Fully self-contained
  // (no audio file to ship); a rising C-major run with a high shimmer on top.
  const playRevealChime = useCallback(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const t = now + i * 0.085;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + 0.55);
    });
    // high sparkle on the final beat
    const sparkT = now + notes.length * 0.085;
    const spark = ctx.createOscillator();
    const sg = ctx.createGain();
    spark.type = "sine";
    spark.frequency.value = 2093; // C7
    sg.gain.setValueAtTime(0.0001, sparkT);
    sg.gain.exponentialRampToValueAtTime(0.09, sparkT + 0.03);
    sg.gain.exponentialRampToValueAtTime(0.0001, sparkT + 0.45);
    spark.connect(sg).connect(master);
    spark.start(sparkT);
    spark.stop(sparkT + 0.5);
  }, []);

  // Play the chime once, the moment the card reveals (phase flips to "done").
  useEffect(() => {
    if (phase === "done") playRevealChime();
  }, [phase, playRevealChime]);

  // Hold on "Payment detected" for a beat when payment first lands, then let the
  // headline advance to "Payment finalizing". Skipped if we jump straight to
  // minting (backend already 'processing').
  useEffect(() => {
    if (paymentSeen && !mintingActive) {
      setDetectedBeat(true);
      const t = setTimeout(() => setDetectedBeat(false), 1100);
      return () => clearTimeout(t);
    }
    setDetectedBeat(false);
  }, [paymentSeen, mintingActive]);

  // Three-beat tracker stage: detected -> finalizing -> minting.
  const mintStage = mintingActive ? "minting" : detectedBeat ? "detected" : "finalizing";
  const stageHeading =
    mintStage === "minting" ? "Minting NFT" : mintStage === "detected" ? "Payment detected" : "Payment finalizing";

  const canMint = avail?.available && !avail.auctionOnly;
  const mm = secondsLeft != null ? String(Math.floor(secondsLeft / 60)).padStart(1, "0") : "";
  const ss = secondsLeft != null ? String(secondsLeft % 60).padStart(2, "0") : "";

  return (
    <div className="pow-mint">
      <style>{CSS}</style>

      <h1 className="title">Mint</h1>

      <MintCounter />

      {/* mystery card — the reveal stays hidden until after payment. The
          "stage-idle" marker (no name typed yet) lets the desktop rail hide
          the big card until the visitor starts minting. */}
      {phase !== "done" && (
        <div className={`stage${phase === "choose" && !display ? " stage-idle" : ""}`}>
          <div className="card mystery" dangerouslySetInnerHTML={{ __html: mysterySvg }} />
        </div>
      )}

      {phase === "choose" && (
        <>
          <div className="field">
            <span className="at">@</span>
            <input
              // Focused imperatively (below) rather than via the autoFocus
              // ATTRIBUTE: autoFocus is server-rendered, so an autoFocus value that
              // differs server↔client (it's suppressed only on a client-read holder
              // deep-link) would hydration-mismatch. A ref + effect keeps the SSR
              // DOM identical either way.
              ref={nameInputRef}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canMint && startMint()}
              placeholder="yourname"
              aria-label="Handle"
              spellCheck={false}
              maxLength={15}
            />
          </div>

          <div className="statusline" role="status">
            {!display ? <span className="muted">Pick a name to begin.</span>
              : checking ? <span className="muted">Checking…</span>
              : avail?.available ? <span className="ok">Available — {avail.priceXec?.toLocaleString()} XEC · {avail.tier}</span>
              : avail ? <span className="no">{STATUS_COPY[avail.status] ?? avail.reason ?? "Unavailable."}</span>
              : null}
          </div>

          <button className="cta" disabled={!canMint} onClick={startMint}>
            {canMint ? `Mint @${display}` : "Mint"}
          </button>
          {notice && <p className="notice">{notice}</p>}
        </>
      )}

      {phase === "pay" && intent && (
        <div className="pay">
          {failure ? (
            <div className="settling" role="status" aria-live="assertive">
              <p className="settlehead fail">Minting failed</p>
              <ol className="mintsteps">
                <li className="done">
                  <span className="mintstep-mark" aria-hidden>{"✓"}</span>
                  <span>Payment detected</span>
                </li>
                <li className="done">
                  <span className="mintstep-mark" aria-hidden>{"✓"}</span>
                  <span>Payment finalizing</span>
                </li>
                <li className="failed">
                  <span className="mintstep-mark" aria-hidden>{"✗"}</span>
                  <span>Minting NFT</span>
                </li>
              </ol>
              <p className="settlesub">{failure}</p>
              <button
                className="cta"
                onClick={() => {
                  setPhase("choose"); setHandle(""); setAvail(null); setIntent(null);
                  setResult(null); setNotice(""); setFailure(null);
                  setPaymentSeen(false); setMintingActive(false); paidSeenRef.current = false;
                }}
              >
                Pick another name
              </button>
            </div>
          ) : paymentSeen ? (
            <div className="settling" role="status" aria-live="polite">
              <p className="settlehead">{stageHeading}</p>
              <ol className="mintsteps">
                <li className={mintStage === "detected" ? "active" : "done"}>
                  <span className="mintstep-mark" aria-hidden>{mintStage === "detected" ? "" : "\u2713"}</span>
                  <span>Payment detected</span>
                </li>
                <li className={mintStage === "minting" ? "done" : mintStage === "finalizing" ? "active" : "pending"}>
                  <span className="mintstep-mark" aria-hidden>{mintStage === "minting" ? "\u2713" : ""}</span>
                  <span>Payment finalizing</span>
                </li>
                <li className={mintStage === "minting" ? "active" : "pending"}>
                  <span className="mintstep-mark" aria-hidden />
                  <span>Minting NFT</span>
                </li>
              </ol>
              <p className="settlesub"><strong>@{intent.handle}</strong> is being minted. Keep this tab open — your card reveals automatically in a few seconds.</p>
            </div>
          ) : (
            <>
              <p className="payhead">Send <strong>{intent.amountXec} XEC</strong> to mint <strong>@{intent.handle}</strong></p>
              <div className="qr"><QRCodeSVG value={intent.bip21Url} size={188} bgColor="#dffff2" fgColor="#05130d" /></div>
              <button type="button" className="cta" onClick={openCashtab}>Open in Cashtab</button>
              <p className="addr" title={intent.address}>{intent.address}</p>
              <button className="copybtn" onClick={copyAddr}>{copied ? "copied \u2713" : "copy address"}</button>
              <p className="poll">{statusMsg}{secondsLeft != null && secondsLeft > 0 && <span className="timer"> · pay within {mm}:{ss}</span>}</p>
              <p className="mintnote">First paid mint wins — if someone mints this name before your payment finalizes, your XEC is refunded automatically.</p>

              <details className="manual">
                <summary>Already paid? Enter the transaction ID</summary>
                <div className="manualrow">
                  <input value={txidInput} onChange={(e) => setTxidInput(e.target.value)} placeholder="txid" aria-label="Transaction ID" spellCheck={false} />
                  <button onClick={async () => {
                    if (!intent || !txidInput.trim()) return;
                    const r = await fetch(`/api/mint/status?mintId=${intent.mintId}&txid=${encodeURIComponent(txidInput.trim())}`);
                    const j = await r.json();
                    if (j.status === "minted") { setResult(j); setPhase("done"); }
                    else if (j.status === "finalizing") { setPaymentSeen(true); setStatusMsg("Finalizing payment…"); }
                    else if (j.status === "awaiting_payment") setNotice("That transaction doesn't match yet — check the txid and amount.");
                    else setNotice(j.error ?? "Couldn't verify that transaction.");
                  }}>Verify</button>
                </div>
              </details>
            </>
          )}
          {notice && <p className="notice">{notice}</p>}
        </div>
      )}

      {phase === "done" && result && (
        <div className="done">
          {(result.imageUrl || result.childTokenId)
            ? <img className="card won" src={result.imageUrl ?? `/api/handle-card/${result.childTokenId}`} alt={`@${display} handle card`} />
            : null}
          <h2 className="wonhead">@{display} is yours</h2>
          <p className="wonsub">The NFT is in the wallet you paid from.</p>
          <div className="links">
            <a href={`https://explorer.e.cash/tx/${result.childTokenId}`} target="_blank" rel="noreferrer">View on explorer</a>
            {/* A signed-out minter is sent to the dashboard instead: it routes
                through the challenge login, which binds the fresh handle to
                their account — the profile link would dead-end them logged out. */}
            {signedIn
              ? <a href={`/@${display}`}>Go to your profile</a>
              : <a href="/dashboard">Go to your dashboard</a>}
          </div>
          <button className="ghost" onClick={() => { setPhase("choose"); setHandle(""); setAvail(null); setIntent(null); setResult(null); setNotice(""); setPaymentSeen(false); }}>
            Mint another
          </button>
        </div>
      )}
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&display=swap');

.pow-mint{
  --bg:#070b0a; --panel:#0d1513; --line:#173a33; --text:#d6fff0; --dim:#5f8a7e;
  --neon:#00ff9c; --cyan:#3df0ff; --no:#ff5c6c;
  box-sizing:border-box;
  color:var(--text);
  font-family:'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  display:flex; flex-direction:column; align-items:center; text-align:center;
  padding:0;
}
/* Match the feed: children self-cap at the feed's 640px column width (in the
   desktop rail the container is narrower, so this is simply inert there). */
.pow-mint > *{max-width:640px;width:100%;}
/* Same size as the gallery's heading — the two panes read as equals. */
.pow-mint .title{font-size:40px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--neon);margin:0 0 16px;
  text-shadow:0 0 8px rgba(0,255,156,.55),0 0 26px rgba(0,255,156,.28);}
/* live "X / 10,000 minted" progress */
.pow-mint .mintcount{margin:0 auto 30px;max-width:320px;width:100%;}
.pow-mint .mintcount-row{font-size:13px;letter-spacing:.03em;color:var(--dim);font-variant-numeric:tabular-nums;}
.pow-mint .mintcount-num{color:var(--neon);font-weight:800;font-size:16px;text-shadow:0 0 8px rgba(0,255,156,.4);}
.pow-mint .mintcount-bar{margin-top:8px;height:5px;border-radius:3px;background:rgba(0,255,156,.1);border:1px solid var(--line);overflow:hidden;}
.pow-mint .mintcount-fill{height:100%;background:var(--neon);box-shadow:0 0 10px rgba(0,255,156,.5);transition:width .6s ease;}

.pow-mint .stage{display:flex;justify-content:center;margin:0 0 28px;}
.pow-mint .card{width:260px;height:260px;border-radius:14px;overflow:hidden;
  box-shadow:0 0 0 1px var(--line),0 0 34px rgba(0,255,156,.20),0 20px 60px rgba(0,0,0,.6);}
.pow-mint .card svg{display:block;width:100%;height:100%;}

.pow-mint .field{display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line);border-radius:10px;
  padding:14px 16px;margin:0 0 12px;transition:border-color .15s,box-shadow .15s;}
.pow-mint .field:focus-within{border-color:var(--neon);box-shadow:0 0 0 1px var(--neon),0 0 20px rgba(0,255,156,.25);}
.pow-mint .field .at{font-size:24px;color:var(--neon);}
.pow-mint .field input{flex:1;background:none;border:none;outline:none;color:var(--text);font:inherit;font-size:24px;}
.pow-mint .field input::placeholder{color:#37655a;}
.pow-mint .statusline{min-height:22px;margin:0 0 18px;font-size:14px;}
.pow-mint .ok{color:var(--neon);text-shadow:0 0 8px rgba(0,255,156,.4);} .pow-mint .no{color:var(--no);} .pow-mint .muted{color:var(--dim);}

.pow-mint .cta{display:inline-block;width:100%;box-sizing:border-box;background:transparent;color:var(--neon);
  border:1px solid var(--neon);border-radius:10px;padding:15px;font:inherit;font-size:15px;font-weight:700;
  letter-spacing:.06em;text-transform:uppercase;cursor:pointer;text-decoration:none;
  box-shadow:0 0 18px rgba(0,255,156,.16),inset 0 0 14px rgba(0,255,156,.05);
  transition:background .15s,color .15s,box-shadow .15s,transform .05s;}
.pow-mint .cta:hover{background:var(--neon);color:#04120c;box-shadow:0 0 30px rgba(0,255,156,.5);}
.pow-mint .cta:active{transform:translateY(1px);}
.pow-mint .cta:disabled{background:transparent;border-color:var(--line);color:var(--dim);box-shadow:none;cursor:not-allowed;}
.pow-mint .notice{color:var(--no);font-size:14px;margin:14px 0 0;}

.pow-mint .pay .payhead{font-size:15px;margin:0 0 18px;color:var(--text);}
.pow-mint .pay strong{color:var(--neon);}
.pow-mint .qr{display:inline-block;padding:12px;background:#dffff2;border-radius:12px;margin:0 0 16px;
  box-shadow:0 0 0 1px var(--neon),0 0 24px rgba(0,255,156,.28);}
.pow-mint .addr{font-size:12px;color:var(--dim);word-break:break-all;margin:12px 0 6px;}
.pow-mint .copybtn{background:transparent;border:1px solid var(--line);color:var(--cyan);border-radius:8px;
  padding:6px 14px;font:inherit;font-size:12px;cursor:pointer;margin:0 0 10px;transition:border-color .15s;}
.pow-mint .copybtn:hover{border-color:var(--cyan);}
.pow-mint .mintnote{font-size:12px;color:var(--dim);line-height:1.5;margin:10px 0 0;}
.pow-mint .poll{font-size:14px;color:var(--text);margin:10px 0 0;}
.pow-mint .poll::after{content:"\\2588";margin-left:3px;color:var(--neon);animation:pow-blink 1s steps(1) infinite;}
.pow-mint .timer{color:var(--cyan);}
@keyframes pow-blink{50%{opacity:0;}}

/* payment-seen -> finalizing indicator (replaces the QR/send prompt) */
.pow-mint .settling{display:flex;flex-direction:column;align-items:center;gap:16px;padding:22px 0 6px;}
.pow-mint .spinner{width:46px;height:46px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--neon);
  animation:pow-spin .8s linear infinite;box-shadow:0 0 20px rgba(0,255,156,.28);}
@keyframes pow-spin{to{transform:rotate(360deg);}}
.pow-mint .settlehead{font-size:18px;font-weight:700;color:var(--neon);letter-spacing:.03em;margin:0;
  text-shadow:0 0 12px rgba(0,255,156,.45);}
.pow-mint .settlehead.fail{color:var(--no);text-shadow:0 0 12px rgba(255,92,108,.45);}
.pow-mint .settlesub{font-size:13px;color:var(--dim);line-height:1.55;margin:0;max-width:380px;}

/* three-step post-payment tracker: detected -> finalizing -> minting. Each row's
   marker is a dim ring (pending), a neon spinner (active) or a filled ✓ (done). */
.pow-mint .mintsteps{list-style:none;padding:0;margin:2px 0 0;display:flex;flex-direction:column;gap:13px;text-align:left;}
.pow-mint .mintsteps li{display:flex;flex-direction:row;align-items:center;gap:11px;font-size:14.5px;color:var(--dim);transition:color .2s;}
.pow-mint .mintstep-mark{width:19px;height:19px;flex:0 0 auto;border-radius:50%;border:2px solid var(--line);box-sizing:border-box;
  display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#04120c;
  transition:border-color .2s,background .2s;}
.pow-mint .mintsteps li.pending .mintstep-mark{opacity:.5;}
.pow-mint .mintsteps li.active{color:var(--text);}
.pow-mint .mintsteps li.active .mintstep-mark{border-color:var(--neon);border-top-color:transparent;background:transparent;
  animation:pow-spin .8s linear infinite;box-shadow:0 0 12px rgba(0,255,156,.3);}
.pow-mint .mintsteps li.done{color:var(--neon);}
.pow-mint .mintsteps li.done .mintstep-mark{border-color:var(--neon);background:var(--neon);box-shadow:0 0 12px rgba(0,255,156,.4);}
.pow-mint .mintsteps li.failed{color:var(--no);}
.pow-mint .mintsteps li.failed .mintstep-mark{border-color:var(--no);background:var(--no);color:#120406;box-shadow:0 0 12px rgba(255,92,108,.4);}

.pow-mint .manual{margin:24px 0 0;text-align:left;}
.pow-mint .manual summary{color:var(--dim);font-size:13px;cursor:pointer;text-align:center;}
.pow-mint .manualrow{display:flex;gap:8px;margin:12px 0 0;}
.pow-mint .manualrow input{flex:1;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:11px 13px;color:var(--text);font:inherit;font-size:13px;outline:none;}
.pow-mint .manualrow input:focus{border-color:var(--cyan);}
.pow-mint .manualrow button{background:transparent;border:1px solid var(--cyan);color:var(--cyan);border-radius:8px;padding:0 18px;font:inherit;cursor:pointer;}

.pow-mint .done{display:flex;flex-direction:column;align-items:center;}
.pow-mint .card.won{width:300px;height:300px;border-radius:14px;overflow:hidden;
  box-shadow:0 0 0 1px var(--line),0 0 40px rgba(0,255,156,.28),0 20px 60px rgba(0,0,0,.6);}
.pow-mint img.card{display:block;object-fit:cover;background:var(--panel);}
.pow-mint .wonhead{font-size:26px;color:var(--neon);text-transform:uppercase;letter-spacing:.04em;margin:24px 0 6px;
  text-shadow:0 0 10px rgba(0,255,156,.5);}
.pow-mint .wonsub{color:var(--dim);margin:0 0 22px;}
.pow-mint .links{display:flex;gap:18px;justify-content:center;margin:0 0 26px;flex-wrap:wrap;}
.pow-mint .links a{color:var(--cyan);font-size:14px;text-decoration:none;border-bottom:1px solid transparent;transition:border-color .15s;}
.pow-mint .links a:hover{border-color:var(--cyan);}
.pow-mint .ghost{background:transparent;border:1px solid var(--line);color:var(--text);border-radius:10px;padding:13px 26px;font:inherit;cursor:pointer;transition:border-color .15s,color .15s;}
.pow-mint .ghost:hover{border-color:var(--neon);color:var(--neon);}

@media (prefers-reduced-motion:reduce){.pow-mint *{transition:none!important;animation:none!important;}}
@media (max-width:520px){.pow-mint .title{font-size:30px;}}
@media (max-width:480px){.pow-mint .card{width:230px;height:230px;}.pow-mint .card.won{width:260px;height:260px;}}

/* Daylight neon: keep the electric palette on a bright ground. The page
   backdrop itself belongs to MarketplaceShell; only the vars flip here. */
/* PAPER (light mode) — see feedTheme.js for the shared token set. */
html:not(.dark) .pow-mint{
  --bg:#f6f4ed; --panel:#fdfcf8; --panel2:#f1eee4; --line:#e3dfd2; --text:#1a1c17;
  --dim:#5e6155; --neon:#12703c; --cyan:#0e6b74; --no:#a3312f; --live:#00c853;
  --paper-shadow:0 1px 2px rgba(26,28,23,.05); --accent-hover:#0d5a2f; --accent-tint:#e7f0e7;
}
html:not(.dark) .pow-mint *{text-shadow:none;}
`;
