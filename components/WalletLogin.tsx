"use client";
// =============================================================================
//  WalletLogin.tsx  —  unified wallet login (readers + authors)
//  Neon style, sibling to MintHandle / ClaimHandle. No email, no password —
//  prove you hold your wallet by sending a fixed 5.5 XEC dust tx carrying a
//  one-time nonce (OP_RETURN). The sender address becomes your identity.
//
//  Talks to: POST /api/auth/start, GET /api/auth/status
// =============================================================================

import { useState, useEffect, useCallback, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";

type Started = {
  ok: true;
  proofAddress: string;
  amountXec: string;
  opReturnRaw: string;
  bip21Url: string;
  expiresAt: string;
};

export default function WalletLogin({ redirectTo = "/" }: { redirectTo?: string }) {
  const [phase, setPhase] = useState<"starting" | "proving" | "done" | "retry">("starting");
  const [started, setStarted] = useState<Started | null>(null);
  const [notice, setNotice] = useState("");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const startedOnceRef = useRef(false);
  const cashtabOpenedRef = useRef(false);

  // Cashtab web deep link — RAW bip21 (no encodeURIComponent), carries the nonce.
  const cashtabUrl = started ? `https://cashtab.com/#/send?bip21=${started.bip21Url}` : "#";

  const openCashtab = useCallback(() => {
    if (!started || typeof window === "undefined") return;
    cashtabOpenedRef.current = true;
    window.open(cashtabUrl, "_blank", "noopener,noreferrer");
  }, [started, cashtabUrl]);

  const copyAddr = async () => {
    if (!started) return;
    try { await navigator.clipboard.writeText(started.proofAddress); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  const startLogin = useCallback(async () => {
    setNotice("");
    setPhase("starting");
    cashtabOpenedRef.current = false;
    try {
      const r = await fetch("/api/auth/start", { method: "POST" });
      const j = await r.json();
      if (!j.ok) { setNotice(j.error ?? "Couldn’t start login. Try again."); setPhase("retry"); return; }
      setStarted(j);
      setPhase("proving");
    } catch { setNotice("Network hiccup — try again."); setPhase("retry"); }
  }, []);

  // Kick the login off the moment the page loads — no intermediate screen. We
  // request the nonce, then (below) hand the payment straight to Cashtab.
  useEffect(() => {
    if (startedOnceRef.current) return;
    startedOnceRef.current = true;
    void startLogin();
  }, [startLogin]);

  // As soon as the nonce is ready, pop Cashtab open with the login payment
  // pre-filled. If the browser blocks the auto-open, the "Open Cashtab" button
  // on the waiting screen is the manual fallback.
  useEffect(() => {
    if (phase === "proving" && started && !cashtabOpenedRef.current) {
      openCashtab();
    }
  }, [phase, started, openCashtab]);

  // poll for the login payment
  useEffect(() => {
    if (phase !== "proving" || !started) return;
    let stopped = false;
    const apply = (j: any) => {
      if (j.ok && j.accountId) {
        setPhase("done");
        // hard navigation so every component re-reads auth via /api/me
        setTimeout(() => { if (typeof window !== "undefined") window.location.assign(redirectTo); }, 600);
      } else if (j.status === "error") {
        setNotice(j.error ?? "Something went wrong verifying your login.");
      }
    };
    const poll = async () => {
      try {
        const r = await fetch("/api/auth/status", { cache: "no-store" });
        if (!stopped) apply(await r.json());
      } catch { /* keep polling */ }
    };
    poll();
    const id = setInterval(() => !stopped && poll(), 2500);
    return () => { stopped = true; clearInterval(id); };
  }, [phase, started, redirectTo]);

  // countdown to nonce expiry
  useEffect(() => {
    if (phase !== "proving" || !started) { setSecondsLeft(null); return; }
    const tick = () => setSecondsLeft(Math.max(0, Math.round((new Date(started.expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase, started]);

  // if the window expires without payment, let them restart
  useEffect(() => {
    if (phase === "proving" && secondsLeft === 0) {
      setNotice("This login request expired. Start again.");
      setPhase("retry");
      setStarted(null);
    }
  }, [secondsLeft, phase]);

  const mm = secondsLeft != null ? String(Math.floor(secondsLeft / 60)).padStart(1, "0") : "";
  const ss = secondsLeft != null ? String(secondsLeft % 60).padStart(2, "0") : "";

  return (
    <div className="pow-mint">
      <style>{CSS}</style>

      <p className="eyebrow">proofofwriting // login</p>
      <h1 className="title">Log in</h1>
      <p className="sub">No email, no password. Prove your wallet is yours — send a tiny login payment from Cashtab, and you’re in.</p>

      {phase === "starting" && (
        <p className="poll">Opening Cashtab…</p>
      )}

      {phase === "retry" && (
        <>
          <button className="cta" onClick={() => void startLogin()}>Try again</button>
          {notice && <p className="notice">{notice}</p>}
        </>
      )}

      {phase === "proving" && started && (
        <div className="pay">
          <p className="poll">Waiting for your {started.amountXec} XEC login payment{secondsLeft != null && secondsLeft > 0 && <span className="timer"> · expires in {mm}:{ss}</span>}</p>
          <a className="cta" href={cashtabUrl} target="_blank" rel="noreferrer" onClick={() => { cashtabOpenedRef.current = true; }}>Open Cashtab</a>
          <p className="fallback">Cashtab didn’t open? Scan the code or use the address below.</p>
          <div className="qr"><QRCodeSVG value={started.bip21Url} size={188} bgColor="#dffff2" fgColor="#05130d" /></div>
          <p className="addr" title={started.proofAddress}>{started.proofAddress}</p>
          <button className="copybtn" onClick={copyAddr}>{copied ? "copied \u2713" : "copy address"}</button>
          {notice && <p className="notice">{notice}</p>}
        </div>
      )}

      {phase === "done" && (
        <div className="done">
          <h2 className="wonhead">You’re in</h2>
          <p className="wonsub">Taking you there…</p>
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
.pow-mint .title{font-size:42px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--neon);margin:0 0 12px;
  text-shadow:0 0 8px rgba(0,255,156,.55),0 0 26px rgba(0,255,156,.28);}
.pow-mint .sub{color:#a6d8c9;font-size:14.5px;line-height:1.55;margin:0 0 30px;}

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
.pow-mint .qr{display:inline-block;padding:12px;background:#dffff2;border-radius:12px;margin:0 0 16px;
  box-shadow:0 0 0 1px var(--neon),0 0 24px rgba(0,255,156,.28);}
.pow-mint .fallback{font-size:12.5px;color:var(--dim);margin:18px 0 12px;}
.pow-mint .addr{font-size:12px;color:var(--dim);word-break:break-all;margin:12px 0 6px;}
.pow-mint .copybtn{background:transparent;border:1px solid var(--line);color:var(--cyan);border-radius:8px;
  padding:6px 14px;font:inherit;font-size:12px;cursor:pointer;margin:0 0 10px;transition:border-color .15s;}
.pow-mint .copybtn:hover{border-color:var(--cyan);}
.pow-mint .poll{font-size:14px;color:var(--text);margin:10px 0 0;}
.pow-mint .pay .poll{margin:0 0 16px;}
.pow-mint .poll::after{content:"\\2588";margin-left:3px;color:var(--neon);animation:pow-blink 1s steps(1) infinite;}
.pow-mint .timer{color:var(--cyan);}
@keyframes pow-blink{50%{opacity:0;}}

.pow-mint .done{display:flex;flex-direction:column;align-items:center;}
.pow-mint .wonhead{font-size:26px;color:var(--neon);text-transform:uppercase;letter-spacing:.04em;margin:24px 0 6px;
  text-shadow:0 0 10px rgba(0,255,156,.5);}
.pow-mint .wonsub{color:var(--dim);margin:0 0 22px;}

@media (prefers-reduced-motion:reduce){.pow-mint *{transition:none!important;animation:none!important;}}
@media (max-width:480px){.pow-mint .title{font-size:32px;}}
`;
