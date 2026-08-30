// =============================================================================
//  articleTheme.js — cypherpunk-neon styling for the article reader
//  (scoped .pow-article). Mirrors the feed / mint / marketplace restyle: a
//  self-contained neon theme that takes over the viewport. The long-form prose
//  body is deliberately kept high-contrast and readable; only the chrome
//  (topbar, byline, share, meta, paywall, comments) wears the full neon skin.
//  Driven by the ~9 vars at the top of .pow-article, so the daylight (light)
//  mode block at the bottom just flips the grounds bright and deepens the neon.
// =============================================================================

export const ARTICLE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&display=swap');

.pow-article{
  --bg:#070b0a; --panel:#0d1513; --panel2:#0a110f; --line:#173a33; --text:#d6fff0;
  --dim:#5f8a7e; --neon:#00ff9c; --cyan:#3df0ff; --no:#ff5c6c; --ink:#cfeee2;
  width:100vw; margin-left:calc(50% - 50vw); min-height:100vh; box-sizing:border-box;
  background-color:var(--bg);
  background-image:
    radial-gradient(1200px 480px at 50% -8%, rgba(0,255,156,.12), transparent 62%),
    repeating-linear-gradient(0deg, rgba(0,255,156,.035) 0 1px, transparent 1px 3px);
  color:var(--text);
  font-family:'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}
.pow-article *{box-sizing:border-box;}
.pow-article a{color:inherit;text-decoration:none;}

/* ---- top strip (the banner) ---- */
/* The header is the shared FeedTopbar, hosted in its own .pow-feed scope. Constrain
   that host to the article column and stop the feed theme from taking over the
   viewport (min-height/background) — the article page owns its own backdrop. */
.pow-article .topbar-host.pow-feed{width:100%;max-width:760px;margin:0 auto;
  min-height:0;background:none;position:sticky;top:0;z-index:50;}
.pow-article .topbar-host .topbar{max-width:760px;}

/* ---- column ---- */
.pow-article .wrap{max-width:760px;margin:0 auto;padding:34px 20px 120px;}
.pow-article .article{margin:0;}

/* ---- article header ---- */
.pow-article .arttitle{font-size:34px;line-height:1.2;font-weight:800;letter-spacing:.01em;color:var(--neon);
  text-shadow:0 0 22px rgba(0,255,156,.3);margin:0;word-break:break-word;}
.pow-article .artbyline{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:16px 0 0;font-size:13px;color:var(--dim);}
.pow-article .bylink{font-weight:700;color:var(--hc,var(--cyan));text-shadow:0 0 8px rgba(61,240,255,.3);transition:text-shadow .15s;}
.pow-article .bylink:hover{text-shadow:0 0 14px rgba(61,240,255,.6);}
/* [AI] disclosure chip beside an AI-operated author's byline (authors.is_ai).
   Terminal green on dark; --neon remaps to ink-green on paper (glow killed there). */
.pow-article .aibadge{flex:none;font-size:11px;font-weight:700;letter-spacing:.1em;color:var(--neon);
  text-shadow:0 0 8px rgba(0,255,156,.35);white-space:nowrap;cursor:default;}
.pow-article .followbtn{background:none;border:1px solid var(--neon);color:var(--neon);font:inherit;font-size:12px;
  font-weight:600;line-height:1;padding:5px 12px;border-radius:999px;cursor:pointer;
  transition:background .15s,color .15s,box-shadow .15s;}
.pow-article .followbtn:hover:not(:disabled){box-shadow:0 0 10px rgba(0,255,156,.4);}
/* Following: a bare accent check like the profile's ✓, not a filled pill. */
.pow-article .followbtn.on{background:none;border-color:transparent;color:var(--neon);font-size:16px;padding:5px 6px;box-shadow:none;}
.pow-article .followbtn.on:hover:not(:disabled){box-shadow:none;text-shadow:0 0 8px rgba(0,255,156,.55);}
.pow-article .followbtn:disabled{opacity:.6;cursor:default;}
.pow-article .artdate{margin:6px 0 0;font-size:13px;color:var(--dim);}
.pow-article .artdate time{font-variant-numeric:tabular-nums;}

/* ---- share row ---- */
.pow-article .share{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:16px 0 0;}
.pow-article .sharebtn{background:transparent;border:1px solid var(--line);color:var(--cyan);font:inherit;font-size:12px;
  padding:5px 14px;border-radius:999px;cursor:pointer;transition:border-color .15s,box-shadow .15s;}
.pow-article .sharebtn:hover{border-color:var(--cyan);box-shadow:0 0 14px rgba(61,240,255,.2);}
.pow-article .sharebtn-pow{display:inline-flex;align-items:center;justify-content:center;color:var(--neon);}
.pow-article .sharebtn-pow:hover{border-color:var(--neon);box-shadow:0 0 14px rgba(0,255,156,.25);}
.pow-article .sharebtn-pow svg{display:block;}
.pow-article .sharebtn-pmark{font-weight:800;text-transform:uppercase;}
.pow-article .copied{font-size:12px;font-weight:600;color:var(--neon);}

/* ---- meta stats ---- */
.pow-article .artmeta{display:flex;flex-wrap:wrap;align-items:center;gap:16px;margin:12px 0 0;font-size:13px;color:var(--dim);
  font-variant-numeric:tabular-nums;}
.pow-article .metaitem{display:inline-flex;align-items:center;gap:6px;background:none;border:none;color:inherit;font:inherit;
  padding:0;cursor:default;}
.pow-article button.metaitem{cursor:pointer;transition:color .15s;}
.pow-article button.metaitem:hover{color:var(--cyan);}

/* ---- checking-access line ---- */
.pow-article .checking{margin:40px 0 0;font-size:14px;color:var(--dim);}

/* ---- sections ---- */
.pow-article .section{margin:26px 0 0;border-top:1px solid var(--line);padding-top:26px;}
.pow-article .preview-head{margin:0;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);}
.pow-article .preview-head .preview-time{font-weight:400;text-transform:none;letter-spacing:0;color:var(--dim);}

/* ---- prose body: kept high-contrast + readable ---- */
.pow-article .prose{margin:18px 0 0;font-size:16.5px;line-height:1.75;color:var(--ink);
  font-family:ui-serif,Georgia,'Times New Roman',serif;word-break:break-word;
  /* Tailwind Typography's base .prose caps width at 65ch (~660px); without this
     override the body text stops short of the 760px column while the comment
     boxes fill it. Let the prose span the full column so both edges line up. */
  max-width:none;}
.pow-article .prose > :first-child{margin-top:0;}
.pow-article .prose p{margin:0 0 1.1em;}
/* YouTube embed inside an article body (matches the feed's .ytembed): a
   responsive 16:9 player the publish-time transform drops in for an own-line
   YouTube URL. */
.pow-article .prose .ytembed{position:relative;margin:1.4em 0;width:100%;aspect-ratio:16/9;
  border-radius:12px;overflow:hidden;border:1px solid var(--line);background:#000;}
.pow-article .prose .ytembed iframe{position:absolute;inset:0;width:100%;height:100%;border:0;}
/* Book-style justified body text: the running text fills the column to BOTH
   margins (a crisp right edge like the comment cards, not a ragged one).
   hyphens:auto keeps the inter-word spacing even — important on the narrow
   mobile column where justify alone would open big gaps. Headings, code and
   lists stay left-aligned. */
.pow-article .prose p{text-align:justify;hyphens:auto;}
.pow-article .prose h1,.pow-article .prose h2,.pow-article .prose h3,
.pow-article .prose h4{color:var(--text);line-height:1.3;margin:1.6em 0 .5em;font-weight:700;
  font-family:'JetBrains Mono',ui-monospace,monospace;}
.pow-article .prose h1{font-size:1.6em;}
.pow-article .prose h2{font-size:1.35em;}
.pow-article .prose h3{font-size:1.15em;}
/* Only anchors that survived the link policy with a live href are styled as
   links; an inert anchor (external/stale link whose href was stripped at render)
   inherits body text so it reads as plain text. */
.pow-article .prose a[href]{color:var(--cyan);text-decoration:underline;text-underline-offset:2px;
  text-decoration-color:rgba(61,240,255,.5);transition:text-shadow .15s;}
.pow-article .prose a[href]:hover{text-shadow:0 0 10px rgba(61,240,255,.45);}
.pow-article .prose strong{color:var(--text);}
.pow-article .prose blockquote{margin:1.2em 0;padding:.2em 0 .2em 1.1em;border-left:3px solid var(--neon);
  color:#a6d8c9;font-style:italic;}
.pow-article .prose code{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:.9em;background:var(--panel2);
  border:1px solid var(--line);border-radius:5px;padding:.1em .4em;color:var(--cyan);}
.pow-article .prose pre{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:16px;overflow:auto;}
.pow-article .prose pre code{background:none;border:none;padding:0;color:var(--ink);}
.pow-article .prose img{max-width:100%;height:auto;border-radius:12px;border:1px solid var(--line);}
.pow-article .prose hr{border:none;border-top:1px solid var(--line);margin:2em 0;}
.pow-article .prose ul,.pow-article .prose ol{padding-left:1.4em;margin:0 0 1.1em;}
.pow-article .prose li{margin:.3em 0;}

/* ---- paywall / unlock ---- */
.pow-article .paywrap{padding:24px 0 6px;text-align:center;}
.pow-article .unlockbtn{display:inline-flex;width:100%;align-items:center;justify-content:center;background:transparent;
  color:var(--neon);border:1px solid var(--neon);border-radius:10px;padding:14px 18px;font:inherit;font-size:14px;
  font-weight:700;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;
  box-shadow:0 0 18px rgba(0,255,156,.16),inset 0 0 14px rgba(0,255,156,.05);
  transition:background .15s,color .15s,box-shadow .15s,transform .05s;}
.pow-article .unlockbtn:hover:not(:disabled){background:var(--neon);color:#04120c;box-shadow:0 0 28px rgba(0,255,156,.5);}
.pow-article .unlockbtn:active:not(:disabled){transform:translateY(1px);}
.pow-article .unlockbtn:disabled{border-color:var(--line);color:var(--dim);box-shadow:none;cursor:not-allowed;}
.pow-article .unlocknote{margin:8px 0 0;font-size:12px;color:var(--dim);}
.pow-article .pollcard{margin:16px 0 0;text-align:left;border:1px solid var(--line);background:var(--panel2);border-radius:12px;
  padding:14px 16px;}
.pow-article .pollrow{display:flex;align-items:center;gap:12px;}
.pow-article .spinner{width:16px;height:16px;flex:none;border-radius:50%;border:2px solid var(--line);
  border-top-color:var(--neon);animation:pow-art-spin .8s linear infinite;}
@keyframes pow-art-spin{to{transform:rotate(360deg);}}
.pow-article .pollmsg{margin:0;font-size:13px;font-weight:600;color:var(--text);}
.pow-article .pollsub{margin:6px 0 0;font-size:12px;color:var(--dim);}
.pow-article .paymissing{margin:16px 0 0;font-size:14px;color:var(--dim);}
/* Paywall card — mirrors the in-pane reader's PaneUnlock (.hr-* in feedTheme)
   so the article page and the feed pane read identically: a bordered card, a
   "The rest is for readers." lockline, an inline Unlock button, and the 94/6
   note. Ported into this scope (the .hr-* CSS is .pow-feed-scoped there). */
.pow-article .hr-paywall{border:1px solid var(--line);border-radius:12px;padding:20px 16px;margin:26px 0 6px;text-align:center;}
.pow-article .hr-lockline{font-size:12.5px;color:var(--dim);margin:0 0 12px;}
.pow-article .hr-unlock{display:inline-block;border:1px solid var(--neon);color:var(--neon);border-radius:9px;
  padding:11px 24px;font-size:13px;font-weight:700;letter-spacing:.05em;background:transparent;font-family:inherit;
  cursor:pointer;transition:background .15s,color .15s,box-shadow .15s;}
.pow-article .hr-unlock:hover:not(:disabled){background:var(--neon);color:#04120c;box-shadow:0 0 22px rgba(0,255,156,.4);}
.pow-article .hr-unlock:disabled{opacity:.6;cursor:default;}
.pow-article .hr-note{font-size:10.5px;color:var(--dim);margin:11px 0 0;line-height:1.5;}
.pow-article .hr-watching{font-size:13px;color:var(--cyan);margin:2px 0 0;}
/* Paper mode: filled ink-green button + paper text, same as .unlockbtn above. */
html:not(.dark) .pow-article .hr-unlock{background:var(--neon);color:#fdfcf8;border-color:var(--neon);box-shadow:var(--paper-shadow);}
html:not(.dark) .pow-article .hr-unlock:hover:not(:disabled){background:var(--accent-hover);color:#fdfcf8;box-shadow:var(--paper-shadow);}
html:not(.dark) .pow-article .hr-unlock:disabled{background:transparent;color:var(--dim);border-color:var(--line);box-shadow:none;}

/* ---- comments ---- */
.pow-article .comments{margin:40px 0 0;border-top:1px solid var(--line);padding-top:32px;}
.pow-article .comments-title{margin:0;font-size:16px;font-weight:800;letter-spacing:.02em;color:var(--neon);
  text-shadow:0 0 10px rgba(0,255,156,.3);}
.pow-article .comments-count{margin:6px 0 0;font-size:13px;color:var(--dim);}
.pow-article .commentform{margin:20px 0 0;}
.pow-article .commentlabel{display:block;font-size:13px;font-weight:600;color:var(--text);}
.pow-article .commentarea{margin:10px 0 0;width:100%;resize:vertical;background:var(--panel2);border:1px solid var(--line);
  border-radius:10px;padding:12px 14px;color:var(--text);font:inherit;font-size:14px;line-height:1.55;outline:none;
  transition:border-color .15s;}
.pow-article .commentarea:focus{border-color:var(--cyan);}
.pow-article .commentarea::placeholder{color:#37655a;}
.pow-article .charcount{margin:6px 0 0;text-align:right;font-size:12px;color:var(--dim);font-variant-numeric:tabular-nums;}
.pow-article .postcomment-btn{margin:12px 0 0;background:transparent;color:var(--neon);border:1px solid var(--neon);
  border-radius:9px;padding:10px 18px;font:inherit;font-size:13px;font-weight:700;letter-spacing:.05em;cursor:pointer;
  box-shadow:0 0 16px rgba(0,255,156,.14),inset 0 0 12px rgba(0,255,156,.05);
  transition:background .15s,color .15s,box-shadow .15s;}
.pow-article .postcomment-btn:hover:not(:disabled){background:var(--neon);color:#04120c;box-shadow:0 0 26px rgba(0,255,156,.5);}
.pow-article .postcomment-btn:disabled{border-color:var(--line);color:var(--dim);box-shadow:none;cursor:not-allowed;}
.pow-article .commenterr{margin:12px 0 0;font-size:13px;color:var(--no);}
.pow-article .commentmuted{margin:16px 0 0;font-size:13px;color:var(--dim);}
.pow-article .commentlist{list-style:none;margin:24px 0 0;padding:0;display:flex;flex-direction:column;gap:12px;}
.pow-article .commentitem{border:1px solid var(--line);background:var(--panel2);border-radius:12px;padding:14px 16px;}
.pow-article .commenthead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}
.pow-article .commentaddr{cursor:pointer;word-break:break-all;font-size:13px;font-weight:600;color:var(--hc,var(--cyan));
  text-decoration:none;transition:text-shadow .15s;}
.pow-article .commentaddr--plain{cursor:default;}
.pow-article a.commentaddr:hover{text-shadow:0 0 10px rgba(61,240,255,.4);}
.pow-article .commentdate{margin:2px 0 0;font-size:11px;color:var(--dim);}
.pow-article .commentbody{margin:12px 0 0;white-space:pre-wrap;word-break:break-word;font-size:14px;line-height:1.6;color:var(--ink);}
/* Same-site URLs in a comment linkify (see CommentBody); style them like the
   article prose links — cyan, underlined — rather than the inherited plain text. */
.pow-article .commentbody a[href]{color:var(--cyan);text-decoration:underline;text-underline-offset:2px;}
.pow-article .commentbody a[href]:hover{text-shadow:0 0 10px rgba(61,240,255,.45);}
.pow-article .delbtn{background:transparent;border:1px solid #6e2831;color:var(--no);font:inherit;font-size:12px;
  padding:5px 12px;border-radius:8px;cursor:pointer;flex:none;transition:border-color .15s,color .15s,box-shadow .15s;}
.pow-article .delbtn:hover:not(:disabled){border-color:var(--no);color:#ff8892;box-shadow:0 0 12px rgba(255,92,108,.2);}
.pow-article .delbtn:disabled{opacity:.5;cursor:default;}

/* ---- paid comment composer: bar (charcount + buttons), reply, pay states ---- */
.pow-article .commentbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:8px;}
.pow-article .commentbar-left{display:flex;align-items:center;gap:8px;}
.pow-article .commentbar-left .charcount{margin:0;}
.pow-article .commentbar-btns{display:flex;align-items:center;gap:10px;}
.pow-article .charcount.over{color:var(--no);}
/* Pay control — byte-for-byte the same as the feed composer's .paybtn
   (ComposeBox.js / feedTheme.js), so commenting on an article and replying in
   the feed feel like the same control: icon-only until you type, then widens
   to reveal the amount. Corners match the site's other buttons (9px, the
   shared .btn radius). */
.pow-article .paybtn{position:relative;display:flex;align-items:center;height:38px;width:40px;min-width:40px;
  background:transparent;border:1.5px solid var(--line);border-radius:9px;cursor:pointer;overflow:hidden;
  padding:0;flex:none;transition:min-width .32s cubic-bezier(.4,0,.2,1),border-color .25s,box-shadow .25s;}
.pow-article .paybtn.active{width:auto;min-width:118px;}
.pow-article .paybtn:disabled{cursor:not-allowed;opacity:.6;}
.pow-article .paybtn-icon{position:absolute;top:50%;left:12px;transform:translate(0,-50%);line-height:1;
  transition:left .32s cubic-bezier(.4,0,.2,1);}
.pow-article .paybtn.active .paybtn-icon{left:11px;}
.pow-article .paybtn-amt{position:absolute;top:50%;right:12px;transform:translate(6px,-50%);font-size:12.5px;
  font-weight:700;letter-spacing:.02em;white-space:nowrap;opacity:0;color:var(--neon);
  transition:opacity .22s .08s,transform .22s .08s;}
.pow-article .paybtn.active .paybtn-amt{opacity:1;transform:translate(0,-50%);}
.pow-article .paybtn.active:not(:disabled){border-color:var(--neon);box-shadow:0 0 14px rgba(0,255,156,.4);}
.pow-article .paybtn.active:hover:not(:disabled){box-shadow:0 0 22px rgba(0,255,156,.55);}
.pow-article .commentghost{background:transparent;border:1px solid var(--line);color:var(--dim);border-radius:9px;
  padding:9px 16px;font:inherit;font-size:12px;cursor:pointer;transition:border-color .15s,color .15s;}
.pow-article .commentghost:hover{border-color:var(--cyan);color:var(--cyan);}
.pow-article .commentlink{background:none;border:none;color:var(--dim);font:inherit;font-size:12px;cursor:pointer;padding:0;
  transition:color .15s;}
.pow-article .commentlink:hover{color:var(--cyan);}
/* an inline reply composer, nested under the comment it answers (no indentation
   — the "Replying to @X" line carries the context, feed-style) */
.pow-article .commentform-reply{margin:12px 0 4px;}
.pow-article .commentactions{margin-top:10px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;}
.pow-article .commentreplybtn{background:none;border:none;color:var(--dim);font:inherit;font-size:13px;cursor:pointer;
  padding:2px 0;transition:color .15s;}
.pow-article .commentreplybtn:hover{color:var(--cyan);}
/* Comment like — the same paid, tippable reaction as a feed-post like (94/6 to
   the commenter). Heart + count in the actions row; a tip popover on tap. */
.pow-article .clike{position:relative;display:inline-flex;align-items:center;}
.pow-article .clikebtn{background:none;border:none;color:var(--dim);font:inherit;font-size:13px;cursor:pointer;
  padding:2px 0;display:inline-flex;align-items:center;gap:3px;transition:color .15s;}
.pow-article .clikebtn:hover{color:var(--cyan);}
.pow-article .clikebtn.on{color:var(--neon);}
.pow-article .clikebtn:disabled{opacity:.6;cursor:default;}
.pow-article .clikeico{font-size:15px;line-height:1;}
.pow-article .cliketip{position:absolute;bottom:calc(100% + 8px);left:0;z-index:30;width:232px;
  background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px;
  box-shadow:0 10px 30px rgba(0,0,0,.45);}
.pow-article .cliketip-title{margin:0 0 8px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);}
.pow-article .cliketip-presets{display:flex;flex-wrap:wrap;gap:6px;}
.pow-article .cliketip-preset{flex:1 1 auto;background:transparent;border:1px solid var(--line);color:var(--cyan);
  font:inherit;font-size:12px;padding:5px 6px;border-radius:8px;cursor:pointer;transition:border-color .15s,box-shadow .15s;}
.pow-article .cliketip-preset:hover{border-color:var(--cyan);box-shadow:0 0 12px rgba(61,240,255,.2);}
.pow-article .cliketip-row{display:flex;align-items:center;gap:6px;margin-top:8px;}
.pow-article .cliketip-input{flex:1 1 auto;min-width:0;background:var(--panel2);border:1px solid var(--line);
  color:var(--text);font:inherit;font-size:13px;padding:6px 8px;border-radius:8px;}
.pow-article .cliketip-unit{font-size:11px;color:var(--dim);}
.pow-article .cliketip-go{background:none;border:1px solid var(--neon);color:var(--neon);font:inherit;font-size:12px;
  padding:6px 10px;border-radius:8px;cursor:pointer;transition:box-shadow .15s;}
.pow-article .cliketip-go:hover{box-shadow:0 0 12px rgba(0,255,156,.25);}
.pow-article .clikepay{position:absolute;top:calc(100% + 8px);left:0;z-index:30;width:260px;
  border:1px solid var(--line);background:var(--panel2);border-radius:12px;padding:12px;font-size:13px;color:var(--dim);}
.pow-article .clikepay strong{color:var(--text);}
.pow-article .clikepay a{color:var(--cyan);}
.pow-article .clikepay-manual summary{cursor:pointer;color:var(--cyan);font-size:12px;margin-top:6px;}
.pow-article .clikepay-row{display:flex;gap:6px;margin-top:8px;}
.pow-article .clikepay-row input{flex:1 1 auto;min-width:0;background:var(--panel);border:1px solid var(--line);
  color:var(--text);font:inherit;font-size:12px;padding:6px 8px;border-radius:8px;}
.pow-article .clikepay-row button{background:none;border:1px solid var(--cyan);color:var(--cyan);font:inherit;
  font-size:12px;padding:6px 10px;border-radius:8px;cursor:pointer;}
.pow-article .clike-cancel{background:none;border:none;color:var(--dim);font:inherit;font-size:12px;cursor:pointer;
  margin-top:8px;text-decoration:underline;}
.pow-article .clike-notice{margin:8px 0 0;font-size:12px;color:var(--no);}

/* Emoji reactions on a comment (CommentReactions) — the comment analogue of the
   feed EngagementBar picker + pills, styled for the article/paper scope. */
.pow-article .creact{position:relative;display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;}
.pow-article .creactwrap{position:relative;display:inline-flex;}
/* Outline ♡, not a filled/colored heart — the trigger reads as an action,
   not as an already-placed reaction (the pills show those in solid color).
   Needs the same size boost .clikeico gets for the same thin-glyph reason. */
.pow-article .creactbtn{background:none;border:none;color:var(--dim);font:inherit;font-size:15px;line-height:1;
  cursor:pointer;padding:0;transition:color .12s;
  /* Match the feed: fatten the thin ♡ outline (+ the +) so it's easier to see. */
  -webkit-text-stroke:0.7px currentColor;}
.pow-article .creactbtn:hover{color:var(--cyan);}
.pow-article .creactbtn:disabled{opacity:.6;cursor:default;}
/* Hidden by default; revealed on hover/focus of .creactwrap (like the feed). A
   transparent ::after bridges the gap so the pointer can travel button→picker. */
.pow-article .creactpicker{display:none;position:absolute;bottom:calc(100% + 8px);left:0;z-index:30;gap:2px;
  background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:5px 8px;
  box-shadow:0 8px 24px rgba(0,0,0,.28);}
.pow-article .creactwrap:hover .creactpicker,
.pow-article .creactwrap:focus-within .creactpicker,
.pow-article .creactwrap.open .creactpicker{display:flex;}
.pow-article .creactpicker::after{content:"";position:absolute;top:100%;left:0;right:0;height:8px;}
.pow-article .creactopt{background:none;border:none;font-size:19px;line-height:1;cursor:pointer;padding:3px;
  border-radius:8px;transition:transform .1s,background .12s;}
.pow-article .creactopt:hover{transform:scale(1.25);background:var(--panel2);}
.pow-article .creactpill{display:inline-flex;align-items:center;gap:4px;background:var(--panel2);
  border:1px solid var(--line);border-radius:999px;color:var(--text);font:inherit;font-size:12.5px;
  padding:2px 9px;cursor:pointer;font-variant-numeric:tabular-nums;transition:border-color .12s;}
.pow-article .creactpill:hover:not(:disabled){border-color:var(--cyan);}
.pow-article .creactpill:disabled{cursor:default;}
/* "Who reacted" popover on your OWN comment — the comment analogue of the feed's
   .whoreacted. Opens above the ♡+ (which turns cyan while open). */
.pow-article .creactbtn.on{color:var(--cyan);}
.pow-article .cwhoreacted{position:absolute;bottom:calc(100% + 6px);left:0;z-index:20;min-width:200px;max-width:300px;
  max-height:280px;overflow-y:auto;background:var(--panel2);border:1px solid var(--line);border-radius:12px;
  padding:10px 12px;box-shadow:0 8px 24px rgba(0,0,0,.4);display:flex;flex-direction:column;gap:8px;}
.pow-article .cwhoreacted::after{content:"";position:absolute;top:100%;left:0;right:0;height:8px;}
.pow-article .cwhorow{display:flex;align-items:baseline;gap:8px;font-size:12.5px;}
.pow-article .cwhoemoji{font-size:15px;flex-shrink:0;line-height:1;}
.pow-article .cwhonames{color:var(--text);word-break:break-word;line-height:1.45;}
.pow-article .cwhonote{margin:0;font-size:12.5px;color:var(--dim);}
.pow-article .comment-replyingto{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--dim);margin:0 0 8px;}
.pow-article .comment-replyarrow{color:var(--dim);}
.pow-article .comment-replyingto-who{color:var(--hc,var(--cyan));font-weight:600;}
.pow-article .commenttomb{color:var(--dim);font-style:italic;}
/* pay state (Cashtab opened → polling for the on-chain payment) */
.pow-article .commentpay{border:1px solid var(--line);background:var(--panel2);border-radius:12px;padding:16px;margin-top:10px;}
.pow-article .commentpay-reply{margin-top:12px;}
.pow-article .commentpay-head{font-size:13.5px;color:var(--text);margin:0 0 12px;}
.pow-article .commentpay-head strong{color:var(--neon);}
.pow-article .commentpay-poll{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text);}
.pow-article .commentmanual{margin:14px 0 0;}
.pow-article .commentmanual summary{color:var(--dim);font-size:12px;cursor:pointer;list-style:none;text-align:center;}
.pow-article .commentmanual summary::-webkit-details-marker{display:none;}
.pow-article .commentmanualrow{display:flex;gap:8px;margin:12px 0 0;}
.pow-article .commentmanualrow input{flex:1;min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:8px;
  padding:10px 12px;color:var(--text);font:inherit;font-size:12px;outline:none;}
.pow-article .commentmanualrow input:focus{border-color:var(--cyan);}

@media (prefers-reduced-motion:reduce){.pow-article *{transition:none!important;animation:none!important;}}
@media (max-width:480px){.pow-article .arttitle{font-size:27px;}}

/* =========================================================================
   PAPER (light mode) — the reader as a manuscript, not a neon sign at noon.
   The long-form body was already the one high-contrast surface; paper extends
   that honesty to the whole page: warm-paper grounds (never #fff), ink type
   (never #000), the neon accent dropped to a dark ink-green so it clears
   contrast, and glow killed wholesale in favour of hairlines + one soft
   shadow. Applies whenever <html> is NOT .dark. (Paper token set mirrors the
   feed's — see feedTheme.js.)
   ======================================================================== */
html:not(.dark) .pow-article{
  --bg:#f6f4ed; --panel:#fdfcf8; --panel2:#f1eee4; --line:#e3dfd2; --text:#1a1c17;
  --dim:#5e6155; --neon:#12703c; --cyan:#0e6b74; --no:#a3312f; --ink:#1a1c17;
  --live:#00c853; --paper-shadow:0 1px 2px rgba(26,28,23,.05);
  --accent-hover:#0d5a2f; --accent-tint:#e7f0e7;
  background-color:var(--bg);
  background-image:none;
}
/* Kill every neon text glow at once — emphasis on paper is weight + hue. */
html:not(.dark) .pow-article *{text-shadow:none;}
/* Byline handle: the account's neon swatch (carried on --hc) is too bright on
   paper — darken it toward ink on the same hue, matching the feed. */
html:not(.dark) .pow-article .bylink,
html:not(.dark) .pow-article .commentaddr{color:color-mix(in oklab, var(--hc,var(--cyan)) 58%, #000);}
html:not(.dark) .pow-article .prose blockquote{color:#3a3d33;}
html:not(.dark) .pow-article .commentarea::placeholder{color:#a9a597;}
/* Prose links: underlined ink-green, no glow (the underline does the work). */
html:not(.dark) .pow-article .prose a[href]{text-decoration-color:rgba(18,112,60,.5);}
/* Code + pre: a warm inset plate with a hairline, not a teal-black terminal. */
html:not(.dark) .pow-article .prose code{background:var(--panel2);border-color:var(--line);color:#0d5a2f;}
/* Primary actions: filled ink-green with paper text (was outline + neon glow). */
html:not(.dark) .pow-article .unlockbtn,
html:not(.dark) .pow-article .postcomment-btn{
  background:var(--neon);color:#fdfcf8;border-color:var(--neon);box-shadow:var(--paper-shadow);}
html:not(.dark) .pow-article .unlockbtn:hover:not(:disabled),
html:not(.dark) .pow-article .postcomment-btn:hover:not(:disabled){
  background:var(--accent-hover);color:#fdfcf8;box-shadow:var(--paper-shadow);}
html:not(.dark) .pow-article .unlockbtn:disabled,
html:not(.dark) .pow-article .postcomment-btn:disabled{
  background:transparent;color:var(--dim);border-color:var(--line);box-shadow:none;}
/* Comment Pay button on paper: an ink-green ring, no glow — byte-for-byte the
   same override the feed composer's .paybtn gets (glow is a dark-mode-only
   trick; paper does emphasis with weight + a solid ring instead). */
html:not(.dark) .pow-article .paybtn-amt{color:var(--neon);}
html:not(.dark) .pow-article .paybtn.active:not(:disabled){border-color:var(--neon);box-shadow:0 0 0 1px var(--neon);}
html:not(.dark) .pow-article .paybtn.active:hover:not(:disabled){box-shadow:0 0 0 1.5px var(--neon);}
/* Not-following is an outline pill; following is a bare accent check in both
   themes (see .followbtn.on above), so no light-mode fill override is needed. */
/* Elevation: recessed cards get a hairline + soft shadow, not a glow. */
html:not(.dark) .pow-article .pollcard,
html:not(.dark) .pow-article .commentitem,
html:not(.dark) .pow-article .commentpay{box-shadow:var(--paper-shadow);}
/* Delete button: warm danger outline instead of the dark-red terminal border. */
html:not(.dark) .pow-article .delbtn{border-color:var(--line);}
html:not(.dark) .pow-article .delbtn:hover:not(:disabled){border-color:var(--no);color:var(--no);box-shadow:none;}

/* ---- desktop shell: the story keeps the newspaper spread ----
   The article column is 760px (wider than the feed's 640), so the tiers sit
   higher than the feed page's: ticker joins at ≥1240 (760+36+330+40=1166),
   the front page at ≥1520 (300+36+760+36+330+40=1502). Below 1240 the
   asides are display:none and this is exactly the old standalone page.
   Rail cards are .pow-feed-scoped; each aside carries its own scope host,
   neutralized the same way the topbar host is. */
.pow-article .art-left,.pow-article .art-right{display:none;}
.pow-article .railhost.pow-feed{width:auto;margin:0;min-height:0;background:none;}
@media (min-width:1240px){
  .pow-article .topbar-host.pow-feed{max-width:1148px;}
  .pow-article .topbar-host .topbar{max-width:1148px;}
  .pow-article .art-cols{display:grid;grid-template-columns:minmax(0,760px) 330px;
    gap:18px;justify-content:center;padding:0 20px;}
  .pow-article .art-cols .wrap{max-width:none;width:100%;margin:0;padding-left:0;padding-right:0;}
  .pow-article .art-right{display:block;position:sticky;top:76px;align-self:start;
    max-height:calc(100dvh - 96px);overflow-y:auto;scrollbar-width:none;}
}
@media (min-width:1520px){
  .pow-article .topbar-host.pow-feed{max-width:1466px;}
  .pow-article .topbar-host .topbar{max-width:1466px;}
  .pow-article .art-cols{grid-template-columns:300px minmax(0,760px) 330px;}
  .pow-article .art-left{display:block;position:sticky;top:76px;align-self:start;
    max-height:calc(100dvh - 96px);overflow-y:auto;scrollbar-width:none;}
}
.pow-article .art-left::-webkit-scrollbar,.pow-article .art-right::-webkit-scrollbar{display:none;}
`
