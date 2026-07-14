"use client";
// =============================================================================
//  ClaimHandle.tsx  —  grandfather claim page (client component)
//  Cypherpunk-neon restyle, sibling to MintHandle.tsx. Existing authors prove
//  they hold their handle by (1) entering the one-time code we sent them and
//  (2) sending a tiny unique dust tx FROM the wallet they want the NFT in.
//  The sender address = delivery address, so the wallet choice matters.
//
//  Talks to: POST /api/claim/start, GET /api/claim/status
//  Deps: qrcode.react.
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { renderMysteryCard } from "@/lib/renderHandleCard";
import { watchPaymentAddress, prewarmPaymentWatch } from "@/lib/ecash/watchPaymentAddress";
import { payWithCashtab } from "@/lib/ecash/cashtabPay";

type Started = {
  ok: true;
  handle: string;
  proofAddress: string;
  proofSats: number;
  amountXec: string;
  bip21: string;
  expiresAt: string;
};

const START_ERROR_COPY: Record<string, string> = {
  window_closed: "The claim window has closed.",
  not_claimable: "That handle isn’t reserved for claiming — check the spelling.",
  bad_code: "That claim code doesn’t match this handle.",
  already_claimed: "This handle has already been claimed.",
  taken: "This handle has already been minted.",
};

export default function ClaimHandle({ signedIn = false }: { signedIn?: boolean }) {
  const [handle, setHandle] = useState("");
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<"enter" | "prove" | "done">("enter");
  const [started, setStarted] = useState<Started | null>(null);
  const [statusMsg, setStatusMsg] = useState("Waiting for your proof payment");
  // True once the proof tx lands on-chain but isn't Avalanche-final yet. Swaps the
  // QR/send prompt for a clear "payment seen — finalizing" spinner during the
  // ~2-3s finality wait, mirroring the mint page so the user knows we saw it.
  const [paymentSeen, setPaymentSeen] = useState(false);
  const [result, setResult] = useState<{ childTokenId?: string; imageUrl?: string } | null>(null);
  const [txidInput, setTxidInput] = useState("");
  const [notice, setNotice] = useState("");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);

  const display = handle.trim();
  const mysterySvg = renderMysteryCard(display || "claim");

  // Cashtab web deep link — RAW bip21 (no encodeURIComponent), same as the mint page.
  const cashtabUrl = started ? `https://cashtab.com/#/send?bip21=${started.bip21}` : "#";

  // Cashtab extension if the claimant has it (in-page popup, no tab), else a
  // Cashtab web tab — exactly one, never both. QR/address below is the fallback.
  const openCashtab = () => {
    if (!started) return;
    void payWithCashtab({ bip21: started.bip21, cashtabUrl });
  };

  const copyAddr = async () => {
    if (!started) return;
    try { await navigator.clipboard.writeText(started.proofAddress); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  // ---- start the claim (verify code + lock, get proof request) ----
  const startClaim = useCallback(async () => {
    if (!display || !code.trim() || starting) return;
    setStarting(true);
    setNotice("");
    prewarmPaymentWatch(); // warm the shared socket during claim start + Cashtab approval
    try {
      const r = await fetch("/api/claim/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: display, code: code.trim() }),
      });
      const j = await r.json();
      if (!j.ok) { setNotice(START_ERROR_COPY[j.code] ?? j.error ?? "Couldn’t start the claim."); return; }
      setStarted(j);
      setPhase("prove");
    } catch { setNotice("Network hiccup — try again."); }
    finally { setStarting(false); }
  }, [display, code, starting]);

  // ---- poll status while proving ----
  useEffect(() => {
    if (phase !== "prove" || !started) return;
    let stopped = false;
    const apply = (j: any) => {
      if (j.status === "claimed") { setResult(j); setPhase("done"); }
      else if (j.status === "expired") { setPaymentSeen(false); setNotice("The 20-minute proof window expired. Start again to re-lock the name."); setPhase("enter"); setStarted(null); }
      else if (j.status === "error") setNotice(j.error ?? "Something went wrong verifying your proof.");
      else if (j.status === "finalizing") { setPaymentSeen(true); setStatusMsg("Proof seen — finalizing…"); }
      else if (j.status === "minting") { setPaymentSeen(true); setStatusMsg("Proof confirmed — minting your handle…"); }
      else { setPaymentSeen(false); setStatusMsg("Waiting for your proof payment"); }
    };
    const poll = async (txid?: string) => {
      try {
        const url = `/api/claim/status?handle=${encodeURIComponent(started.handle)}` + (txid ? `&txid=${encodeURIComponent(txid)}` : "");
        const r = await fetch(url);
        if (!stopped) apply(await r.json());
      } catch { /* keep polling */ }
    };
    poll();
    // Poll faster than finality settles (~2-3s) so we actually catch the brief
    // "seen but not final" window and show the finalizing state, not skip it.
    const id = setInterval(() => !stopped && poll(), 1200);
    // Live nudge: a Chronik websocket on the proof address fires an immediate
    // poll (with the txid) the moment the proof payment lands, instead of waiting
    // up to 1.5s for the next tick. The server still gates on Avalanche finality.
    // Third arg = wake (tab foregrounded / ws reconnect): poll immediately in
    // case the proof payment broadcast while the tab was suspended in Cashtab.
    const stopWatch = watchPaymentAddress(started.proofAddress, (txid) => { if (!stopped) poll(txid); }, () => { if (!stopped) poll(); });
    return () => { stopped = true; clearInterval(id); stopWatch(); };
  }, [phase, started]);

  // ---- countdown to expiry ----
  useEffect(() => {
    if (phase !== "prove" || !started) { setSecondsLeft(null); return; }
    const tick = () => setSecondsLeft(Math.max(0, Math.round((new Date(started.expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase, started]);

  const canStart = display.length > 0 && code.trim().length > 0 && !starting;
  const mm = secondsLeft != null ? String(Math.floor(secondsLeft / 60)).padStart(1, "0") : "";
  const ss = secondsLeft != null ? String(secondsLeft % 60).padStart(2, "0") : "";

  return (
    <div className="pow-mint">
      <style>{CSS}</style>

      <p className="eyebrow"><Link href="/" className="eyebrowlink">proofofwriting</Link> // claim</p>
      <h1 className="title">Claim your handle</h1>
      <p className="sub">For grandfathered authors. Enter your handle and the one-time code we sent you, then prove the wallet is yours — your handle NFT is delivered to that wallet.</p>

      {phase !== "done" && (
        <div className="stage">
          <div className="card mystery" dangerouslySetInnerHTML={{ __html: mysterySvg }} />
        </div>
      )}

      {phase === "enter" && (
        <>
          <div className="field">
            <span className="at">@</span>
            <input
              autoFocus
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="yourhandle"
              aria-label="Handle"
              spellCheck={false}
              maxLength={15}
            />
          </div>
          <div className="field">
            <span className="at code">#</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canStart && startClaim()}
              placeholder="CLAIM CODE"
              aria-label="Claim code"
              spellCheck={false}
              autoCapitalize="characters"
            />
          </div>

          <button className="cta" disabled={!canStart} onClick={startClaim}>
            {starting ? "Checking…" : "Start claim"}
          </button>
          {notice && <p className="notice">{notice}</p>}
        </>
      )}

      {phase === "prove" && started && (
        <div className="pay">
          {paymentSeen ? (
            <div className="settling" role="status" aria-live="polite">
              <div className="spinner" aria-hidden="true" />
              <p className="settlehead">{statusMsg}</p>
              <p className="settlesub">Payment received — waiting for the network to finalize and mint your NFT. Keep this tab open; your card reveals in a few seconds.</p>
            </div>
          ) : (
            <>
              <p className="payhead">Send <strong>{started.amountXec} XEC</strong> to prove you hold <strong>@{started.handle}</strong></p>
              <p className="warnline">Send from <strong>Cashtab</strong> — the wallet you send from is where your NFT lands. Don’t use Electrum ABC (it can’t hold NFTs safely).</p>
              <div className="qr"><QRCodeSVG value={started.bip21} size={188} bgColor="#dffff2" fgColor="#05130d" /></div>
              <button type="button" className="cta" onClick={openCashtab}>Open in Cashtab</button>
              <p className="addr" title={started.proofAddress}>{started.proofAddress}</p>
              <button className="copybtn" onClick={copyAddr}>{copied ? "copied \u2713" : "copy address"}</button>
              <p className="poll">{statusMsg}{secondsLeft != null && secondsLeft > 0 && <span className="timer"> · expires in {mm}:{ss}</span>}</p>

              <details className="manual">
                <summary>Already sent it? Enter the transaction ID</summary>
                <div className="manualrow">
                  <input value={txidInput} onChange={(e) => setTxidInput(e.target.value)} placeholder="txid" aria-label="Transaction ID" spellCheck={false} />
                  <button onClick={async () => {
                    if (!started || !txidInput.trim()) return;
                    const r = await fetch(`/api/claim/status?handle=${encodeURIComponent(started.handle)}&txid=${encodeURIComponent(txidInput.trim())}`);
                    const j = await r.json();
                    if (j.status === "claimed") { setResult(j); setPhase("done"); }
                    else if (j.status === "finalizing") { setPaymentSeen(true); setStatusMsg("Proof seen — finalizing…"); }
                    else if (j.status === "minting") { setPaymentSeen(true); setStatusMsg("Proof confirmed — minting your handle…"); }
                    else if (j.status === "awaiting_proof") setNotice("That transaction doesn’t match yet — check the txid and amount.");
                    else setNotice(j.error ?? "Couldn’t verify that transaction.");
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
            ? <img className="card won" src={result.imageUrl ?? `/api/handle-card/${result.childTokenId}`} alt={`@${started?.handle ?? display} handle card`} />
            : null}
          <h2 className="wonhead">@{started?.handle ?? display} is yours</h2>
          <p className="wonsub">The NFT is in the wallet you proved from.</p>
          <div className="links">
            <a href={`https://explorer.e.cash/tx/${result.childTokenId}`} target="_blank" rel="noreferrer">View on explorer</a>
            {/* Signed-out claimers go to the dashboard: it routes through the
                challenge login, which binds the fresh handle to their account. */}
            {signedIn
              ? <a href={`/@${started?.handle ?? display}`}>Go to your profile</a>
              : <a href="/dashboard">Go to your dashboard</a>}
          </div>
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
  width:100vw; margin-left:calc(50% - 50vw); min-height:100vh; box-sizing:border-box;
  background-color:var(--bg);
  background-image:
    radial-gradient(1200px 480px at 50% -8%, rgba(0,255,156,.12), transparent 62%),
    repeating-linear-gradient(0deg, rgba(0,255,156,.035) 0 1px, transparent 1px 3px);
  color:var(--text);
  font-family:'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  display:flex; flex-direction:column; align-items:center; text-align:center;
  padding:64px 20px 110px;
}
.pow-mint > *{max-width:560px;width:100%;}
.pow-mint .eyebrow{font-size:12px;letter-spacing:.34em;text-transform:uppercase;color:var(--cyan);margin:0 0 16px;
  text-shadow:0 0 10px rgba(61,240,255,.35);}
.pow-mint .eyebrowlink{color:inherit;text-decoration:none;transition:text-shadow .15s;}
.pow-mint .eyebrowlink:hover{text-shadow:0 0 14px rgba(61,240,255,.7);}
.pow-mint .title{font-size:42px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--neon);margin:0 0 12px;
  text-shadow:0 0 8px rgba(0,255,156,.55),0 0 26px rgba(0,255,156,.28);}
.pow-mint .sub{color:#a6d8c9;font-size:14.5px;line-height:1.55;margin:0 0 30px;}

.pow-mint .stage{display:flex;justify-content:center;margin:0 0 28px;}
.pow-mint .card{width:260px;height:260px;border-radius:14px;overflow:hidden;
  box-shadow:0 0 0 1px var(--line),0 0 34px rgba(0,255,156,.20),0 20px 60px rgba(0,0,0,.6);}
.pow-mint .card svg{display:block;width:100%;height:100%;}

.pow-mint .field{display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line);border-radius:10px;
  padding:14px 16px;margin:0 0 12px;transition:border-color .15s,box-shadow .15s;}
.pow-mint .field:focus-within{border-color:var(--neon);box-shadow:0 0 0 1px var(--neon),0 0 20px rgba(0,255,156,.25);}
.pow-mint .field .at{font-size:24px;color:var(--neon);}
.pow-mint .field .at.code{font-size:22px;color:var(--cyan);}
.pow-mint .field input{flex:1;background:none;border:none;outline:none;color:var(--text);font:inherit;font-size:24px;}
.pow-mint .field input::placeholder{color:#37655a;letter-spacing:.05em;}

.pow-mint .cta{display:inline-block;width:100%;box-sizing:border-box;background:transparent;color:var(--neon);
  border:1px solid var(--neon);border-radius:10px;padding:15px;font:inherit;font-size:15px;font-weight:700;
  letter-spacing:.06em;text-transform:uppercase;cursor:pointer;text-decoration:none;
  box-shadow:0 0 18px rgba(0,255,156,.16),inset 0 0 14px rgba(0,255,156,.05);
  transition:background .15s,color .15s,box-shadow .15s,transform .05s;}
.pow-mint .cta:hover{background:var(--neon);color:#04120c;box-shadow:0 0 30px rgba(0,255,156,.5);}
.pow-mint .cta:active{transform:translateY(1px);}
.pow-mint .cta:disabled{background:transparent;border-color:var(--line);color:var(--dim);box-shadow:none;cursor:not-allowed;}
.pow-mint .notice{color:var(--no);font-size:14px;margin:14px 0 0;}

.pow-mint .pay .payhead{font-size:15px;margin:0 0 10px;color:var(--text);}
.pow-mint .pay strong{color:var(--neon);}
.pow-mint .warnline{font-size:13px;line-height:1.5;color:#ffd18a;background:rgba(255,160,40,.08);
  border:1px solid rgba(255,160,40,.25);border-radius:8px;padding:10px 12px;margin:0 0 16px;}
.pow-mint .warnline strong{color:#ffb44d;}
.pow-mint .qr{display:inline-block;padding:12px;background:#dffff2;border-radius:12px;margin:0 0 16px;
  box-shadow:0 0 0 1px var(--neon),0 0 24px rgba(0,255,156,.28);}
.pow-mint .addr{font-size:12px;color:var(--dim);word-break:break-all;margin:12px 0 6px;}
.pow-mint .copybtn{background:transparent;border:1px solid var(--line);color:var(--cyan);border-radius:8px;
  padding:6px 14px;font:inherit;font-size:12px;cursor:pointer;margin:0 0 10px;transition:border-color .15s;}
.pow-mint .copybtn:hover{border-color:var(--cyan);}
.pow-mint .poll{font-size:14px;color:var(--text);margin:10px 0 0;}
.pow-mint .poll::after{content:"\\2588";margin-left:3px;color:var(--neon);animation:pow-blink 1s steps(1) infinite;}
.pow-mint .timer{color:var(--cyan);}
@keyframes pow-blink{50%{opacity:0;}}

/* proof-seen -> finalizing indicator (replaces the QR/send prompt) */
.pow-mint .settling{display:flex;flex-direction:column;align-items:center;gap:16px;padding:22px 0 6px;}
.pow-mint .spinner{width:46px;height:46px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--neon);
  animation:pow-spin .8s linear infinite;box-shadow:0 0 20px rgba(0,255,156,.28);}
@keyframes pow-spin{to{transform:rotate(360deg);}}
.pow-mint .settlehead{font-size:18px;font-weight:700;color:var(--neon);letter-spacing:.03em;margin:0;
  text-shadow:0 0 12px rgba(0,255,156,.45);}
.pow-mint .settlesub{font-size:13px;color:var(--dim);line-height:1.55;margin:0;max-width:380px;}

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

@media (prefers-reduced-motion:reduce){.pow-mint *{transition:none!important;animation:none!important;}}
@media (max-width:480px){.pow-mint .title{font-size:32px;}.pow-mint .card{width:230px;height:230px;}.pow-mint .card.won{width:260px;height:260px;}}

/* PAPER (light mode) — warm manuscript grounds, ink type, glow killed.
   Mirrors the feed/article paper token set (see feedTheme.js). The handle
   NFT art card (.card / img.card) keeps its own chip and is untouched. */
html:not(.dark) .pow-mint{
  --bg:#f6f4ed; --panel:#fdfcf8; --line:#e3dfd2; --text:#1a1c17; --dim:#5e6155;
  --neon:#12703c; --cyan:#0e6b74; --no:#a3312f; --live:#00c853;
  --paper-shadow:0 1px 2px rgba(26,28,23,.05);
  background-image:none;
}
html:not(.dark) .pow-mint *{text-shadow:none;}
html:not(.dark) .pow-mint .sub{color:#4a4d42;}
html:not(.dark) .pow-mint .cta{box-shadow:var(--paper-shadow);}
html:not(.dark) .pow-mint .cta:hover{background:var(--neon);color:#fdfcf8;box-shadow:var(--paper-shadow);}
html:not(.dark) .pow-mint .qr{background:#fff;box-shadow:0 0 0 1px var(--line),var(--paper-shadow);}
`;
