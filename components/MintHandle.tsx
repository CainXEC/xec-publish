"use client";
// =============================================================================
//  MintHandle.tsx  —  public handle-minting page (client component)
//  Cypherpunk-neon restyle (scoped to .pow-mint; does not touch the site theme).
//  Blind reveal: a covered "mystery" card shows until the mint clears, then the
//  real card is revealed (seeded from the mint tx id).
//
//  Talks to: GET /api/handles/check, POST /api/mint/intent, GET /api/mint/status
//  Deps: qrcode.react. Font (JetBrains Mono) is loaded scoped in the style block.
// =============================================================================

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { renderHandleCard, renderMysteryCard } from "@/lib/renderHandleCard";
import ThemeToggle from "@/components/ThemeToggle";
import MarketplaceClient from "@/components/MarketplaceClient";

type Availability = { available?: boolean; status: string; priceXec?: number; tier?: string; auctionOnly?: boolean; reason?: string };
type Intent = { mintId: string; handle: string; amountXec: string; address: string; bip21Url: string; expiresAt: string };

const STATUS_COPY: Record<string, string> = {
  invalid: "Letters, numbers and single underscores only — 1 to 15 characters.",
  taken: "Already claimed.",
  reserved: "Reserved.",
  pending: "Someone is minting this right now.",
  auction: "Premium name — released by auction, not direct mint.",
};

export default function MintHandle() {
  const [handle, setHandle] = useState("");
  const [avail, setAvail] = useState<Availability | null>(null);
  const [checking, setChecking] = useState(false);
  const [phase, setPhase] = useState<"choose" | "pay" | "done">("choose");
  const [intent, setIntent] = useState<Intent | null>(null);
  const [statusMsg, setStatusMsg] = useState("Waiting for payment");
  // True once the payment lands on-chain (finalizing or minting). Flips the pay
  // screen from the QR/send prompt to a clear "payment received" indicator, so
  // the user knows the site saw their payment during the ~2-3s finality wait.
  const [paymentSeen, setPaymentSeen] = useState(false);
  const [result, setResult] = useState<{ childTokenId?: string; imageUrl?: string } | null>(null);
  const [txidInput, setTxidInput] = useState("");
  const [notice, setNotice] = useState("");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  // Latch: once the payment is seen on-chain we commit to the "minting" screen
  // and never bounce back to the QR/waiting view, even if a later poll transiently
  // reports awaiting_payment (Chronik race). Only a terminal error clears it.
  const paidSeenRef = useRef(false);

  const display = handle.trim();
  const mysterySvg = renderMysteryCard(display);
  const revealSvg = result?.childTokenId ? renderHandleCard(display, { seed: result.childTokenId }) : null;

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
    setPaymentSeen(false);
    paidSeenRef.current = false;
    // Open the Cashtab tab synchronously inside the click gesture so popup
    // blockers don't eat it, then redirect it once the intent (and its bip21)
    // lands. Opening with a handle (no noopener) is what lets us set its URL
    // later; we null the opener before navigating to a trusted external site.
    const cashtabWindow =
      typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
    try {
      const r = await fetch("/api/mint/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: display }),
      });
      const j = await r.json();
      if (!j.ok) {
        cashtabWindow?.close();
        setNotice(STATUS_COPY[j.status] ?? j.reason ?? j.error ?? "Couldn't start the mint. Try again.");
        return;
      }
      setIntent(j);
      setPhase("pay");
      const url = `https://cashtab.com/#/send?bip21=${j.bip21Url}`;
      if (cashtabWindow) {
        cashtabWindow.opener = null;
        cashtabWindow.location.href = url;
      }
    } catch {
      cashtabWindow?.close();
      setNotice("Network hiccup — try again.");
    }
  }, [display]);

  // ---- poll status while paying ----
  useEffect(() => {
    if (phase !== "pay" || !intent) return;
    let stopped = false;
    const apply = (j: any) => {
      if (j.status === "minted") { setResult(j); setPhase("done"); }
      else if (j.status === "refunded") { paidSeenRef.current = false; setPaymentSeen(false); setNotice("Refunded — the name wasn't available when payment landed. Your XEC is on its way back. Pick another name."); }
      else if (j.status === "failed") { paidSeenRef.current = false; setPaymentSeen(false); setNotice("The mint failed. If you paid, a refund is on its way."); }
      else if (j.status === "expired") { paidSeenRef.current = false; setPaymentSeen(false); setNotice("The 15-minute hold expired. Start again to re-lock the name."); setPhase("choose"); setIntent(null); }
      // Payment is on-chain now — commit to the minting screen and stay there. We
      // treat "finalizing" the same as "minting": the moment we see the payment
      // the user gets the confident "minting your handle" view, so the finality
      // wait + on-chain broadcast read as the mint finishing, not a hang.
      else if (j.status === "processing" || j.status === "finalizing") { paidSeenRef.current = true; setPaymentSeen(true); setStatusMsg("Minting your handle"); }
      // Still awaiting the payment — but never demote out of the minting screen
      // once we've latched it (a transient awaiting_payment is just a Chronik race).
      else if (!paidSeenRef.current) { setPaymentSeen(false); setStatusMsg("Waiting for payment"); }
    };
    const poll = async (txid?: string) => {
      try {
        const url = `/api/mint/status?mintId=${intent.mintId}` + (txid ? `&txid=${encodeURIComponent(txid)}` : "");
        const r = await fetch(url);
        if (!stopped) apply(await r.json());
      } catch { /* keep polling */ }
    };
    poll();
    // Poll a touch faster than the old 2s so the UI reacts sooner once the
    // payment finalizes and once the on-chain mint lands. This only shortens the
    // dead time between polls — it does NOT weaken the finality gate, which still
    // holds the mint until Chronik reports the funding tx Avalanche-final.
    const id = setInterval(() => !stopped && poll(), 1200);
    return () => { stopped = true; clearInterval(id); };
  }, [phase, intent]);

  // ---- countdown to expiry ----
  useEffect(() => {
    if (phase !== "pay" || !intent) { setSecondsLeft(null); return; }
    const tick = () => setSecondsLeft(Math.max(0, Math.round((new Date(intent.expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase, intent]);

  const canMint = avail?.available && !avail.auctionOnly;
  const mm = secondsLeft != null ? String(Math.floor(secondsLeft / 60)).padStart(1, "0") : "";
  const ss = secondsLeft != null ? String(secondsLeft % 60).padStart(2, "0") : "";

  return (
    <div className="pow-mint">
      <style>{CSS}</style>

      <div className="topbar">
        <Link href="/" className="wordmark">proofofwriting</Link>
        <div className="toplinks">
          <Link href="/" className="toplink">feed</Link>
          <ThemeToggle variant="feed" />
        </div>
      </div>

      <h1 className="title">Mint a handle</h1>
      <p className="sub">A one-of-one name on Proof of Writing.</p>

      {/* mystery card — the reveal stays hidden until after payment */}
      {phase !== "done" && (
        <div className="stage">
          <div className="card mystery" dangerouslySetInnerHTML={{ __html: mysterySvg }} />
        </div>
      )}

      {phase === "choose" && (
        <>
          <div className="field">
            <span className="at">@</span>
            <input
              autoFocus
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
          {paymentSeen ? (
            <div className="settling" role="status" aria-live="polite">
              <div className="spinner" aria-hidden="true" />
              <p className="settlehead">{statusMsg}</p>
              <p className="settlesub">Payment received ✓ — <strong>@{intent.handle}</strong> is being written on-chain. Keep this tab open; your card reveals automatically in a few seconds.</p>
            </div>
          ) : (
            <>
              <p className="payhead">Send <strong>{intent.amountXec} XEC</strong> to mint <strong>@{intent.handle}</strong></p>
              <div className="qr"><QRCodeSVG value={intent.bip21Url} size={188} bgColor="#dffff2" fgColor="#05130d" /></div>
              <a className="cta" href={cashtabUrl} target="_blank" rel="noreferrer">Open in Cashtab</a>
              <p className="addr" title={intent.address}>{intent.address}</p>
              <button className="copybtn" onClick={copyAddr}>{copied ? "copied \u2713" : "copy address"}</button>
              <p className="poll">{statusMsg}{secondsLeft != null && secondsLeft > 0 && <span className="timer"> · hold expires in {mm}:{ss}</span>}</p>

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
          {result.imageUrl
            ? <img className="card won" src={result.imageUrl} alt={`@${display} handle card`} />
            : revealSvg
              ? <div className="card won" dangerouslySetInnerHTML={{ __html: revealSvg }} />
              : null}
          <h2 className="wonhead">@{display} is yours</h2>
          <p className="wonsub">The NFT is in the wallet you paid from.</p>
          <div className="links">
            <a href={`https://explorer.e.cash/tx/${result.childTokenId}`} target="_blank" rel="noreferrer">View on explorer</a>
            <a href={`/@${display}`}>Go to your profile</a>
          </div>
          <button className="ghost" onClick={() => { setPhase("choose"); setHandle(""); setAvail(null); setIntent(null); setResult(null); setNotice(""); setPaymentSeen(false); }}>
            Mint another
          </button>
        </div>
      )}

      <MarketplaceClient embedded />
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
  padding:26px 20px 110px;
}
/* Match the feed: one 640px column for the whole page — topbar, mint flow, and
   the marketplace grid all share the feed's width so nothing spills wider. */
.pow-mint > *{max-width:640px;width:100%;}
/* The embedded marketplace sits below the mint flow behind a hairline separator,
   at the same 640px width as everything else. */
.pow-mint > .pow-market.embed{max-width:640px;margin-top:32px;padding-top:28px;border-top:1px solid var(--line);}
/* Header bar mirrors the feed's .topbar (brand left, links + toggle right). */
.pow-mint .topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;
  width:100%;max-width:640px;margin:0 auto 36px;}
.pow-mint .wordmark{font-size:15px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--neon);
  text-decoration:none;text-shadow:0 0 8px rgba(0,255,156,.5);transition:text-shadow .15s;}
.pow-mint .wordmark:hover{text-shadow:0 0 14px rgba(0,255,156,.7);}
.pow-mint .toplinks{display:flex;align-items:center;gap:10px;}
.pow-mint .toplink{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--cyan);border:1px solid var(--line);
  border-radius:8px;padding:8px 14px;text-decoration:none;transition:border-color .15s,box-shadow .15s;}
.pow-mint .toplink:hover{border-color:var(--cyan);box-shadow:0 0 16px rgba(61,240,255,.22);}
.pow-mint .toplink-toggle{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;
  padding:0;color:var(--neon);cursor:pointer;background:transparent;}
.pow-mint .toplink-toggle:hover{border-color:var(--neon);box-shadow:0 0 16px rgba(0,255,156,.3);}
.pow-mint .toplink-toggle svg{width:15px;height:15px;}
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
.pow-mint .ghost{background:transparent;border:1px solid var(--line);color:var(--text);border-radius:10px;padding:13px 26px;font:inherit;cursor:pointer;transition:border-color .15s,color .15s;}
.pow-mint .ghost:hover{border-color:var(--neon);color:var(--neon);}

@media (prefers-reduced-motion:reduce){.pow-mint *{transition:none!important;animation:none!important;}}
@media (max-width:480px){.pow-mint .title{font-size:32px;}.pow-mint .card{width:230px;height:230px;}.pow-mint .card.won{width:260px;height:260px;}}

/* Daylight neon: keep the electric palette on a bright ground — the terminal
   glowing under fluorescent light. Grounds flip light, neon deepens just enough
   to stay legible on white; the rgba glow halos stay bright so text still lights. */
html:not(.dark) .pow-mint{
  --bg:#e9faf2; --panel:#ffffff; --panel2:#f0f9f4; --line:#bfe6d5; --text:#07271d;
  --dim:#5c8578; --neon:#00b06e; --cyan:#0898b4; --no:#e23b4d;
  background-color:var(--bg);
  background-image:
    radial-gradient(1200px 480px at 50% -8%, rgba(0,255,156,.28), transparent 62%),
    repeating-linear-gradient(0deg, rgba(0,180,110,.055) 0 1px, transparent 1px 3px);
}
html:not(.dark) .pow-mint .sub{color:#3f6b5d;}
`;
