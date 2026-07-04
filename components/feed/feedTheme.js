// =============================================================================
//  feedTheme.js  —  cypherpunk-neon styling for the paid feed (scoped .pow-feed)
//  Mirrors the /mint restyle: a self-contained neon theme that takes over the
//  viewport and does not touch the rest of the site's light/dark theme. Both the
//  feed index and a single thread render inside <div className="pow-feed"> and
//  drop <style>{FEED_CSS}</style> once near the top.
// =============================================================================

export const FEED_CSS = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&display=swap');

.pow-feed{
  --bg:#070b0a; --panel:#0d1513; --panel2:#0a110f; --line:#173a33; --text:#d6fff0;
  --dim:#5f8a7e; --neon:#00ff9c; --cyan:#3df0ff; --no:#ff5c6c;
  width:100vw; margin-left:calc(50% - 50vw); min-height:100vh; box-sizing:border-box;
  background-color:var(--bg);
  background-image:
    radial-gradient(1200px 480px at 50% -8%, rgba(0,255,156,.12), transparent 62%),
    repeating-linear-gradient(0deg, rgba(0,255,156,.035) 0 1px, transparent 1px 3px);
  color:var(--text);
  font-family:'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}
.pow-feed *{box-sizing:border-box;}
.pow-feed a{color:inherit;text-decoration:none;}

/* ---- top strip ---- */
.pow-feed .topbar{
  display:flex;align-items:center;justify-content:space-between;gap:16px;
  max-width:640px;margin:0 auto;padding:22px 20px 0;
}
.pow-feed .wordmark{font-size:15px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--neon);
  text-shadow:0 0 8px rgba(0,255,156,.5);}
.pow-feed .toplink{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--cyan);border:1px solid var(--line);
  border-radius:8px;padding:8px 14px;transition:border-color .15s,box-shadow .15s;}
.pow-feed .toplink:hover{border-color:var(--cyan);box-shadow:0 0 16px rgba(61,240,255,.22);}

/* ---- header ---- */
.pow-feed .head{max-width:640px;margin:0 auto;padding:28px 20px 18px;text-align:center;}
.pow-feed .eyebrow{font-size:12px;letter-spacing:.34em;text-transform:uppercase;color:var(--cyan);margin:0 0 12px;
  text-shadow:0 0 10px rgba(61,240,255,.35);}
.pow-feed .title{font-size:40px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--neon);margin:0 0 10px;
  text-shadow:0 0 8px rgba(0,255,156,.55),0 0 26px rgba(0,255,156,.28);}
.pow-feed .sub{color:#a6d8c9;font-size:14px;line-height:1.55;margin:0;}

/* ---- shared column ---- */
.pow-feed .wrap{max-width:640px;margin:0 auto;padding:0 20px 120px;}

/* ---- panels ---- */
.pow-feed .panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;
  box-shadow:0 0 26px rgba(0,255,156,.06);}

/* ---- compose ---- */
.pow-feed .compose{padding:16px;}
.pow-feed .compose.compact{padding:12px;}
.pow-feed .compose textarea{width:100%;resize:vertical;background:transparent;border:none;outline:none;color:var(--text);
  font:inherit;font-size:15px;line-height:1.55;}
.pow-feed .compose textarea::placeholder{color:#37655a;}
.pow-feed .composebar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;
  border-top:1px solid var(--line);padding-top:12px;}
.pow-feed .count{font-size:12px;color:var(--dim);font-variant-numeric:tabular-nums;}
.pow-feed .count.over{color:var(--no);}
.pow-feed .count .cost{margin-left:10px;color:var(--neon);}
.pow-feed .barbtns{display:flex;align-items:center;gap:10px;}

/* ---- buttons ---- */
.pow-feed .btn{background:transparent;color:var(--neon);border:1px solid var(--neon);border-radius:9px;
  padding:9px 18px;font:inherit;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
  cursor:pointer;box-shadow:0 0 16px rgba(0,255,156,.14),inset 0 0 12px rgba(0,255,156,.05);
  transition:background .15s,color .15s,box-shadow .15s,transform .05s;white-space:nowrap;}
.pow-feed .btn:hover:not(:disabled){background:var(--neon);color:#04120c;box-shadow:0 0 26px rgba(0,255,156,.5);}
.pow-feed .btn:active:not(:disabled){transform:translateY(1px);}
.pow-feed .btn:disabled{border-color:var(--line);color:var(--dim);box-shadow:none;cursor:not-allowed;}
.pow-feed .btn.block{display:block;width:100%;text-align:center;}
.pow-feed .ghost{background:transparent;border:1px solid var(--line);color:var(--dim);border-radius:9px;
  padding:9px 16px;font:inherit;font-size:12px;cursor:pointer;transition:border-color .15s,color .15s;}
.pow-feed .ghost:hover{border-color:var(--neon);color:var(--neon);}
.pow-feed .linkbtn{background:none;border:none;color:var(--dim);font:inherit;font-size:12px;cursor:pointer;padding:0;
  transition:color .15s;}
.pow-feed .linkbtn:hover{color:var(--cyan);}

/* ---- pay ---- */
.pow-feed .pay{padding:20px;text-align:center;}
.pow-feed .payhead{font-size:14px;margin:0 0 16px;color:var(--text);}
.pow-feed .payhead strong{color:var(--neon);}
.pow-feed .qr{display:inline-block;padding:12px;background:#dffff2;border-radius:12px;margin:0 0 16px;
  box-shadow:0 0 0 1px var(--neon),0 0 24px rgba(0,255,156,.28);}
.pow-feed .poll{font-size:13px;color:var(--text);margin:12px 0 0;}
.pow-feed .poll::after{content:"\\2588";margin-left:3px;color:var(--neon);animation:pow-blink 1s steps(1) infinite;}
@keyframes pow-blink{50%{opacity:0;}}
.pow-feed .manual{margin:20px 0 0;text-align:left;}
.pow-feed .manual summary{color:var(--dim);font-size:12px;cursor:pointer;text-align:center;list-style:none;}
.pow-feed .manual summary::-webkit-details-marker{display:none;}
.pow-feed .manualrow{display:flex;gap:8px;margin:12px 0 0;}
.pow-feed .manualrow input{flex:1;min-width:0;background:var(--panel2);border:1px solid var(--line);border-radius:8px;
  padding:10px 12px;color:var(--text);font:inherit;font-size:12px;outline:none;}
.pow-feed .manualrow input:focus{border-color:var(--cyan);}
.pow-feed .notice{color:var(--no);font-size:13px;margin:14px 0 0;}

/* ---- feed list ---- */
.pow-feed .posts{margin-top:16px;overflow:hidden;}
.pow-feed .post{padding:16px;border-bottom:1px solid var(--line);}
.pow-feed .post:last-child{border-bottom:none;}
.pow-feed .postmeta{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;}
.pow-feed .byline{font-weight:700;color:var(--neon);text-shadow:0 0 8px rgba(0,255,156,.35);transition:text-shadow .15s;}
.pow-feed .byline:hover{text-shadow:0 0 14px rgba(0,255,156,.6);}
.pow-feed .addr{font-size:13px;color:var(--cyan);}
.pow-feed .dot{color:var(--line);}
.pow-feed .time{font-size:12px;color:var(--dim);}
.pow-feed .time:hover{color:var(--cyan);}
.pow-feed .body{margin:8px 0 0;white-space:pre-wrap;word-break:break-word;font-size:15px;line-height:1.6;color:var(--text);}
.pow-feed .actions{display:flex;align-items:center;gap:16px;margin-top:12px;}
.pow-feed .replybtn{background:none;border:none;color:var(--dim);font:inherit;font-size:13px;cursor:pointer;padding:2px 0;
  transition:color .15s;}
.pow-feed .replybtn:hover{color:var(--cyan);}
.pow-feed .inlinereply{margin-top:12px;}

/* ---- states ---- */
.pow-feed .error{border:1px solid var(--no);border-radius:10px;background:rgba(255,92,108,.08);color:var(--no);
  padding:12px 16px;font-size:13px;margin:16px 0 0;}
.pow-feed .empty{border:1px dashed var(--line);border-radius:14px;padding:44px 24px;text-align:center;color:var(--dim);
  font-size:14px;margin-top:16px;}
.pow-feed .loadmore{text-align:center;margin-top:20px;}

/* ---- thread ---- */
.pow-feed .back{display:inline-block;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);
  margin:0 0 16px;transition:text-shadow .15s;}
.pow-feed .back:hover{text-shadow:0 0 12px rgba(61,240,255,.5);}
.pow-feed .rootpost{padding:20px;}
.pow-feed .rootbody{margin:10px 0 0;white-space:pre-wrap;word-break:break-word;font-size:17px;line-height:1.6;color:var(--text);}
.pow-feed .rootmeta{margin:14px 0 0;font-size:12px;color:var(--dim);}
.pow-feed .onchain{color:var(--cyan);}
.pow-feed .onchain:hover{text-shadow:0 0 10px rgba(61,240,255,.5);}
.pow-feed .replieshead{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin:24px 0 10px;}

@media (prefers-reduced-motion:reduce){.pow-feed *{transition:none!important;animation:none!important;}}
@media (max-width:480px){.pow-feed .title{font-size:30px;}.pow-feed .head{padding-top:20px;}}
`
