// =============================================================================
//  feedTheme.js  —  cypherpunk-neon styling for the paid feed (scoped .pow-feed)
//  Mirrors the /mint restyle: a self-contained neon theme that takes over the
//  viewport and does not touch the rest of the site's light/dark theme. Both the
//  feed index and a single thread render inside <div className="pow-feed"> and
//  drop <style>{FEED_CSS}</style> once near the top.
// =============================================================================

// The width at which the front page (left rail) joins the shell. A standard
// Windows laptop is 1366px wide, or 1280 CSS px at the 1920×1080/150% scaling
// Windows ships by default — both used to fall under the old 1400 floor and
// lost the rail entirely. The three-column tier now starts at 1280 with the
// rails narrowed, and widens back to the roomy 300/640/330 by 1400.
//
// EXPORTED because ArticleRail matchMedia()s the same number to decide whether
// to fetch: if the two ever disagree, the rail renders as an empty box.
export const WIDE_RAIL_MIN = 1280

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
/* Sticky so the wordmark + notification bell stay reachable while scrolling.
   Semi-transparent + blur lets the neon backdrop show through; the content
   column shares the 640px width so nothing scrolls in the gutters beside it. */
.pow-feed .topbar{
  position:sticky;top:0;z-index:50;
  display:flex;align-items:center;gap:10px;min-height:52px;
  max-width:640px;margin:0 auto;padding:16px 20px 14px;
  background:rgba(7,11,10,.82);backdrop-filter:blur(10px);
  border-bottom:1px solid var(--line);
}
/* Wordmark is absolutely centered so the left/right items flow freely and the
   bell can relocate sides by breakpoint without pushing the name off-center. */
.pow-feed .wordmark{font-size:clamp(17px,4vw,20px);font-weight:800;letter-spacing:.17em;text-transform:uppercase;color:var(--neon);
  text-shadow:0 0 8px rgba(0,255,156,.5);white-space:nowrap;line-height:1;
  position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);}
/* Topbar item placement (flex order). The pocket (order:1) sits just after the
   hamburger on the LEFT. Desktop: [hamburger][pocket] … [bell][theme].
   Mobile (<1100): hamburger gone, [bell][pocket] … [theme]. */
.pow-feed .topnav{order:0;}
.pow-feed .tb-bell{display:inline-flex;order:2;margin-left:auto;}
.pow-feed .toplinks{order:3;}
/* Extra .topbar ancestor = higher specificity, so these win over the base
   .topnav / .toplinks rules that appear later in this stylesheet. */
@media (max-width:1099px){
  .pow-feed .topbar .topnav{display:none;}
  .pow-feed .topbar .tb-bell{order:0;margin-left:0;}
  .pow-feed .topbar .toplinks{order:2;margin-left:auto;}
}
/* One-shot wordmark title entrance ("the unredaction"): a censor bar over the
   name is consumed by a single cyan decrypt sweep, the letters cool from hot
   white into this resting neon, then everything holds dead still. All the
   animation CSS + variants live in WordmarkIntro.js (bench: /dev/wordmark);
   these are just the structural bones. The invisible ghost pins the width so
   the shot can never shift the nav; the base span is the real name (SSR'd),
   and the intro overlays unmount back to exactly this static state. */
.pow-feed .wm-intro{position:relative;display:inline-block;}
.pow-feed .wm-ghost{visibility:hidden;}
.pow-feed .wm-base{position:absolute;left:0;top:0;white-space:nowrap;}
.pow-feed .toplink{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--cyan);border:1px solid var(--line);
  border-radius:8px;padding:8px 14px;transition:border-color .15s,box-shadow .15s;}
.pow-feed .toplink:hover{border-color:var(--cyan);box-shadow:0 0 16px rgba(61,240,255,.22);}
.pow-feed .toplinks{display:flex;align-items:center;gap:10px;justify-self:end;}
.pow-feed .toplink-toggle{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;
  padding:0;color:var(--neon);cursor:pointer;}
.pow-feed .toplink-toggle:hover{border-color:var(--neon);box-shadow:0 0 16px rgba(0,255,156,.3);}
.pow-feed .toplink-toggle svg{width:17px;height:17px;}
/* Nav links live in the hamburger at every width; the inline pill row is hidden. */
.pow-feed .toplinks-text{display:none;}
.pow-feed .topnav{display:inline-flex;justify-self:start;position:relative;}
.pow-feed .hamburger{background:transparent;border:1px solid var(--line);border-radius:8px;width:34px;height:34px;
  display:inline-flex;align-items:center;justify-content:center;color:var(--cyan);cursor:pointer;padding:0;
  transition:border-color .15s,box-shadow .15s;}
.pow-feed .hamburger:hover{border-color:var(--cyan);box-shadow:0 0 16px rgba(61,240,255,.22);}
.pow-feed .hamicon{font-size:17px;line-height:1;}
.pow-feed .hammenu{position:absolute;top:calc(100% + 8px);left:0;z-index:60;width:max-content;min-width:120px;
  background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:6px;
  box-shadow:0 12px 32px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:2px;
  opacity:0;visibility:hidden;pointer-events:none;transition:opacity .12s ease;}
/* Transparent bridge over the 8px gap so a hover doesn't drop between the
   hamburger and the menu on the way down. */
.pow-feed .hammenu::before{content:"";position:absolute;top:-8px;left:0;right:0;height:8px;}
/* Click-pinned open (the only path on touch, where there's no hover). */
.pow-feed .topnav.open .hammenu{opacity:1;visibility:visible;pointer-events:auto;}
/* Desktop / any pointer that can hover: open the menu on hover, no click needed. */
@media (hover:hover){
  .pow-feed .topnav:hover .hammenu{opacity:1;visibility:visible;pointer-events:auto;}
}
.pow-feed .hammenu-item{display:block;width:100%;text-align:left;background:none;border:none;font:inherit;
  font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--text);padding:11px 12px;border-radius:8px;
  cursor:pointer;transition:background .12s,color .12s;}
.pow-feed .hammenu-item:hover{background:rgba(0,255,156,.1);color:var(--neon);}
/* Same hamburger-centered bar everywhere; just tighter spacing on small screens. */
@media (max-width:600px){
  .pow-feed .topbar{gap:8px;padding:12px 16px;}
  .pow-feed .toplinks{gap:6px;}
}
/* Very narrow phones: with two icon buttons on the right (search + theme), the
   absolutely-centered wordmark needs less tracking and the buttons less width
   or they collide below ~350px. */
@media (max-width:379px){
  .pow-feed .wordmark{font-size:14px;letter-spacing:.09em;}
  .pow-feed .toplink-toggle{width:30px;height:30px;}
  .pow-feed .toplink-toggle svg{width:15px;height:15px;}
}
/* Desktop reaches search through the hamburger menu (which only exists
   >=1100px); the header magnifier is the mobile-only entry, keeping the
   desktop bar to bell + theme toggle. */
@media (min-width:1100px){
  .pow-feed .tb-search{display:none;}
}

/* ---- notification bell (links to /notifications — no dropdown) ---- */
.pow-feed .notifbtn{position:relative;display:inline-flex;align-items:center;justify-content:center;
  width:34px;height:34px;background:transparent;border:1px solid var(--line);border-radius:8px;
  color:var(--neon);line-height:1;cursor:pointer;transition:border-color .15s,box-shadow .15s;}
.pow-feed .notifbtn:hover{border-color:var(--neon);box-shadow:0 0 16px rgba(0,255,156,.3);}
.pow-feed .notifbtn svg{display:block;}
/* ---- pinned agent-queue row (admin sessions only) ----
   A standing to-do at the top of /notifications: persists until the drafts are
   judged — mark-read never clears it. The API only sends the count to admin
   sessions, so this row can't exist for anyone else. */
.pow-feed .notif-agent{display:flex;align-items:center;gap:8px;padding:11px 14px;
  font-size:12.5px;letter-spacing:.04em;color:var(--neon);border:1px solid var(--line);border-radius:10px;
  background:rgba(0,255,156,.06);transition:background .12s;text-decoration:none;}
.pow-feed .notif-agent:hover{background:rgba(0,255,156,.12);}
.pow-feed .notif-agent-dot{width:7px;height:7px;border-radius:50%;background:var(--neon);
  box-shadow:0 0 8px rgba(0,255,156,.8);flex:none;}
/* Pocket button — a standalone topbar item on the LEFT (same 34px chrome as the
   bell/toggle). order:1 puts it right after the hamburger on desktop
   ([hamburger][pocket] … [bell][theme]); on mobile the hamburger is gone and the
   bell takes order 0, so the pocket sits to the bell's RIGHT
   ([bell][pocket] … [theme]) — matching its mobile corner. It renders nothing
   when there's no pocket, so it never leaves an empty slot. Dashed = signed in
   but no pocket yet. */
/* The wrap is the header flex item + positioning context for the card. The 34px
   chip button lives inside it; the balance card is a SIBLING (so it can hold a
   real, tappable Open button — a <button> can't nest another). order:1 keeps the
   pocket right after the hamburger; the topbar spaces items with gap, so wrapping
   the chip doesn't disturb the layout. */
.pow-feed .pocketbtn-wrap{order:1;position:relative;display:inline-flex;align-items:center;
  justify-content:center;flex:none;align-self:center;}
.pow-feed .pocketbtn{position:relative;display:inline-flex;align-items:center;justify-content:center;
  box-sizing:border-box;width:34px;height:34px;min-width:34px;min-height:34px;max-width:34px;max-height:34px;
  flex:none;align-self:center;padding:0;background:transparent;border:1px solid var(--line);border-radius:8px;
  color:var(--neon);line-height:1;cursor:pointer;text-decoration:none;font:inherit;appearance:none;
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:manipulation;
  transition:border-color .15s,box-shadow .15s;}
.pow-feed .pocketbtn:hover{border-color:var(--neon);box-shadow:0 0 16px rgba(0,255,156,.3);}
.pow-feed .pocketbtn svg{display:block;}
/* NB: modifier is prefixed — a bare .empty class collides with the feed's
   empty-state panel style (44px padding) further down this sheet. */
/* No Pocket yet: this chip is the way in, so it should INVITE rather than recede.
   It used to be dimmed (var(--dim)) and read as disabled. Now it carries the live
   neon + a steady soft glow, with the dashed border left in place as the "not set
   up yet" tell. Colors come from the theme vars, so paper mode inherits its ink
   green automatically. */
.pow-feed .pocketbtn.pocketbtn-empty{color:var(--neon);border-color:var(--neon);border-style:dashed;
  background:rgba(0,255,156,.10);
  box-shadow:0 0 18px rgba(0,255,156,.55),0 0 5px rgba(0,255,156,.5);}
/* …plus a ONE-SHOT beckon the first time it's seen in a session: three soft beats
   that settle back into the steady state above. A title shot, not an ambient loop
   — nothing keeps blinking in the corner of the eye. PocketChip gates it to once
   per session and skips it entirely under reduced motion. */
.pow-feed .pocketbtn.pocketbtn-empty.beckon{animation:pocket-beckon 2.6s cubic-bezier(.4,0,.2,1) .2s 1 both;}
@keyframes pocket-beckon{
  0%{box-shadow:0 0 18px rgba(0,255,156,.55),0 0 5px rgba(0,255,156,.5);transform:scale(1);}
  6%{box-shadow:0 0 28px rgba(0,255,156,.95),0 0 8px rgba(0,255,156,.7);transform:scale(1.12);}
  14%{box-shadow:0 0 18px rgba(0,255,156,.55),0 0 5px rgba(0,255,156,.5);transform:scale(1);}
  24%{box-shadow:0 0 26px rgba(0,255,156,.9),0 0 8px rgba(0,255,156,.65);transform:scale(1.1);}
  32%{box-shadow:0 0 18px rgba(0,255,156,.55),0 0 5px rgba(0,255,156,.5);transform:scale(1);}
  42%{box-shadow:0 0 24px rgba(0,255,156,.8),0 0 7px rgba(0,255,156,.6);transform:scale(1.07);}
  52%,100%{box-shadow:0 0 18px rgba(0,255,156,.55),0 0 5px rgba(0,255,156,.5);transform:scale(1);}
}
@media (prefers-reduced-motion:reduce){
  .pow-feed .pocketbtn.pocketbtn-empty.beckon{animation:none;}
}
/* Paper mode kills neon halos by design, so the invitation is carried by the
   accent tint + ink-green dashed border, and the beckon beats on scale alone
   (same rhythm, no glow). */
/* Paper kills neon halos, so "lighted" here = a stronger ink-green tint fill, a
   solid ink-green ring reinforcing the dashed border, and a soft green shadow —
   noticeable on the light masthead without a garish glow. */
html:not(.dark) .pow-feed .pocketbtn.pocketbtn-empty{
  background:color-mix(in oklab, var(--neon) 14%, #fff);
  box-shadow:0 0 0 1px var(--neon),0 2px 12px rgba(18,112,60,.28);}
html:not(.dark) .pow-feed .pocketbtn.pocketbtn-empty.beckon{animation-name:pocket-beckon-paper;}
@keyframes pocket-beckon-paper{
  0%{transform:scale(1);}
  6%{transform:scale(1.12);}
  14%{transform:scale(1);}
  24%{transform:scale(1.1);}
  32%{transform:scale(1);}
  42%{transform:scale(1.07);}
  52%,100%{transform:scale(1);}
}
/* Balance + actions card: shown on HOVER (hover-capable devices) or a TAP-toggled
   .open class (touch). The "Open Pocket →" button inside is the discoverable way
   to the full screen on mobile; long-press to /pocket is now just a shortcut.
   pointer-events flips to auto only while the card is revealed. */
.pow-feed .pocket-bal{position:absolute;top:calc(100% + 6px);left:0;z-index:60;
  display:flex;flex-direction:column;gap:6px;min-width:130px;
  color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:10px;
  padding:8px;box-shadow:0 8px 22px rgba(0,0,0,.4);
  opacity:0;pointer-events:none;transform:translateY(-3px);
  transition:opacity .12s,transform .12s,border-color .2s,box-shadow .2s;}
/* transparent hover bridge over the 6px gap so a desktop mouse can travel from
   the chip to the card without it closing (the card is a DOM descendant of the
   wrap, so hovering it — or this bridge — keeps :hover alive). */
.pow-feed .pocket-bal::before{content:"";position:absolute;top:-8px;left:0;right:0;height:8px;}
.pow-feed .pocket-bal-amt{font-size:12px;font-weight:700;letter-spacing:.02em;line-height:1.2;
  white-space:nowrap;color:var(--dim);padding:1px 3px;}
.pow-feed .pocket-open{appearance:none;font:inherit;cursor:pointer;text-align:left;white-space:nowrap;
  touch-action:manipulation;font-size:12.5px;font-weight:700;letter-spacing:.02em;line-height:1.2;
  color:var(--neon);background:transparent;border:1px solid var(--line);border-radius:7px;padding:6px 9px;
  transition:border-color .15s,background .15s;}
.pow-feed .pocket-open:hover{border-color:var(--neon);background:rgba(0,255,156,.08);}
@media (hover:hover){.pow-feed .pocketbtn-wrap:hover .pocket-bal{opacity:1;transform:translateY(0);pointer-events:auto;}}
.pow-feed .pocketbtn-wrap.open .pocket-bal,
.pow-feed .pocketbtn-wrap.flash .pocket-bal{opacity:1;transform:translateY(0);pointer-events:auto;}
/* Spend flash: a green breath on the card + chip so a pocket-paid action reads as
   "money moved" even with the card closed, then it fades back to just the icon.
   Driven by the store's spendPulse; PocketChip removes .flash after ~1.8s. */
.pow-feed .pocketbtn-wrap.flash .pocket-bal{border-color:var(--neon);
  box-shadow:0 0 0 1px var(--neon),0 8px 22px rgba(0,0,0,.45);}
.pow-feed .pocketbtn-wrap.flash .pocket-bal-amt{color:var(--neon);}
.pow-feed .pocketbtn-wrap.flash .pocketbtn{border-color:var(--neon);box-shadow:0 0 16px rgba(0,255,156,.3);}
.pow-feed .notifbadge{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;padding:0 4px;
  display:inline-flex;align-items:center;justify-content:center;border-radius:9px;
  background:var(--no);color:#0b0304;font-size:10px;font-weight:800;line-height:1;
  box-shadow:0 0 10px rgba(255,92,108,.6);}
.pow-feed .notifempty{margin:0;padding:18px 14px;font-size:13px;color:var(--dim);text-align:center;}
.pow-feed .notifmore{display:block;width:100%;background:none;border:none;border-top:1px solid var(--line);
  padding:11px 14px;font:inherit;font-size:13px;color:var(--cyan);cursor:pointer;text-align:center;transition:background .12s;}
.pow-feed .notifmore:hover{background:rgba(61,240,255,.08);}
.pow-feed .notifmore:disabled{color:var(--dim);cursor:default;}
.pow-feed .notifmsg{font-size:13px;line-height:1.5;color:var(--text);}
.pow-feed .notifmsg strong{color:var(--cyan);font-weight:700;}
/* The earned amount leads the message (right after the handle) — money green. */
.pow-feed .notifamt{color:var(--neon);font-weight:700;white-space:nowrap;}
.pow-feed .notiftime{flex:none;font-size:11px;color:var(--dim);}

/* ---- /notifications page ---- */
/* No outer box around the list itself — each row is just hairline-separated
   (its own border-bottom); the ONLY boxed "harness" left is .notifpage-body,
   the actual quoted reply/comment text, same as a feed quote embed. */
.pow-feed .notifpage-list{list-style:none;margin:16px 0 0;padding:0;}
.pow-feed .notifpage-row{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;margin:0 -16px;
  border-bottom:1px solid var(--line);text-decoration:none;transition:background .12s;border-radius:10px;}
.pow-feed .notifpage-list li:last-child .notifpage-row{border-bottom:none;}
.pow-feed .notifpage-row:hover{background:rgba(0,255,156,.06);}
.pow-feed .notifpage-row.unread{background:rgba(0,255,156,.08);}
.pow-feed .notifpage-row.unread:hover{background:rgba(0,255,156,.12);}
/* Type glyph gutter: a mono mark that lets the list scan at a glance. Dim by
   default (a quiet "nod" for reactions/reposts); the conversational rows tint it. */
.pow-feed .notifpage-glyph{flex:none;width:18px;text-align:center;font-size:15px;line-height:1.6;
  color:var(--dim);user-select:none;}
.pow-feed .notifpage-main{min-width:0;flex:1;}
/* Conversational (reply/quote/mention/comment) — someone talking TO you — steps
   forward: a cyan accent rail + a cyan glyph. Reactions/reposts stay a dim nod. */
.pow-feed .notifpage-row.convo{box-shadow:inset 2px 0 0 var(--cyan);}
.pow-feed .notifpage-row.convo .notifpage-glyph{color:var(--cyan);}
.pow-feed .notifpage-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px;}
.pow-feed .notifpage-actors{display:flex;flex-wrap:wrap;gap:4px;font-size:13.5px;line-height:1.5;color:var(--text);}
.pow-feed .notifpage-actors a{color:inherit;text-decoration:none;}
.pow-feed .notifpage-actors a:hover strong{text-decoration:underline;}
/* Actor name tints with the holder's chosen handle color (--hc); no color set
   → the default text color, so address/handle-less actors read unchanged. */
.pow-feed .notifpage-name{color:var(--hc,inherit);}
.pow-feed .notifpage-more{color:var(--dim);font-weight:400;}
/* The reply/quote/comment's own words — same visual language as a feed quote
   embed, so "here is the actual text" reads consistently across the site. */
.pow-feed .notifpage-body{margin:8px 0 0;padding:11px 13px;border:1px solid var(--line);border-radius:11px;
  background:var(--panel2);font-size:13.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word;
  color:#b9e6d8;}
.pow-feed .notifpage-body.gone{color:var(--dim);font-style:italic;}

/* ---- header ---- */
.pow-feed .head{max-width:640px;margin:0 auto;padding:28px 20px 18px;text-align:center;}
.pow-feed .sub{color:#a6d8c9;font-size:14px;line-height:1.55;margin:0;}

/* ---- shared column ---- */
/* Bottom padding is a plain breather. On mobile the fixed bottom nav is cleared
   by body{padding-bottom} (see BottomNav) — the wrap must NOT re-reserve that
   height too, or the two stack into a big empty gap above the bar. */
.pow-feed .wrap{max-width:640px;margin:0 auto;padding:0 20px 56px;}
/* Breathing room under the sticky topbar (was an inline style on the feed's
   <main>); a class so the mobile block below can tighten it. */
.pow-feed .feed-main{padding-top:28px;}
@media (max-width:1099px){ .pow-feed .wrap{padding-bottom:24px;} }

/* ---- panels ---- */
.pow-feed .panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;
  box-shadow:0 0 26px rgba(0,255,156,.06);}

/* ---- compose ---- */
.pow-feed .compose{padding:16px;}
.pow-feed .compose.compact{padding:12px;}
/* Forum-post title field: a prominent single line above the body textarea. */
.pow-feed .composetitle{width:100%;background:transparent;border:none;border-bottom:1px solid var(--line);
  color:var(--text);font-family:inherit;font-size:18px;font-weight:700;padding:2px 0 10px;margin-bottom:10px;
  outline:none;}
.pow-feed .composetitle::placeholder{color:var(--dim);font-weight:700;}
.pow-feed .composetitle:focus{border-bottom-color:var(--cyan);}
.pow-feed .compose textarea{width:100%;resize:none;background:transparent;border:none;outline:none;color:var(--text);
  font:inherit;font-size:15px;line-height:1.55;box-sizing:border-box;min-height:72px;max-height:360px;overflow-y:auto;
  display:block;}
.pow-feed .compose textarea::placeholder{color:#37655a;}
/* @mention autocomplete: anchored to the textarea's own wrapper (not the whole
   panel) so it never collides with the poll-composer block below the text.
   top/left are set inline per-keystroke (useMentionSuggest's caretCoordinates)
   to sit right under the "@" itself, not the bottom of the whole (often
   multi-row, mostly-empty-below-the-caret) textarea box. */
.pow-feed .composetextwrap{position:relative;}
.pow-feed .mentionsuggest{position:absolute;z-index:20;margin:4px 0 0;width:min(240px,100%);
  max-height:220px;overflow-y:auto;list-style:none;padding:6px;background:var(--panel);
  border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.4);}
.pow-feed .mentionsuggest-item{display:block;width:100%;box-sizing:border-box;text-align:left;background:none;
  border:none;border-radius:7px;padding:7px 9px;font:inherit;font-size:13.5px;cursor:pointer;color:var(--text);}
.pow-feed .mentionsuggest-item.active,.pow-feed .mentionsuggest-item:hover{background:rgba(0,255,156,.1);}
.pow-feed .mentionsuggest-handle{color:var(--hc,var(--cyan));}
.pow-feed .composebar{display:flex;align-items:center;justify-content:space-between;gap:12px 10px;margin-top:12px;
  border-top:1px solid var(--line);padding-top:12px;flex-wrap:wrap;}
.pow-feed .barleft{display:flex;align-items:center;gap:8px;}
.pow-feed .count{font-size:12px;color:var(--dim);font-variant-numeric:tabular-nums;}
/* Why the Pay button is dimmed on a forum post — its title is still empty. */
.pow-feed .composehint{font-size:12px;color:var(--no);}
/* Flags the flat YouTube-embed surcharge as it's added to a post's cost. */
.pow-feed .count-yt{font-size:12px;color:var(--cyan);font-variant-numeric:tabular-nums;margin-right:8px;}
.pow-feed .count.over{color:var(--no);}
.pow-feed .count .cost{margin-left:10px;color:var(--neon);}
/* margin-left:auto keeps the buttons right-aligned whether they sit next to the
   emoji/count or wrap to their own line on a narrow phone (was overflowing the
   card edge before flex-wrap). */
.pow-feed .barbtns{display:flex;align-items:center;gap:10px;margin-left:auto;}
/* Tighten the pay/cancel buttons on phones so they fit on one line where they can. */
@media (max-width:480px){
  .pow-feed .composebar .btn{padding:9px 13px;letter-spacing:.03em;}
  .pow-feed .composebar .ghost{padding:9px 12px;}
}

/* ---- poll composer (ComposeBox: 📊 toggle + option inputs + eligibility) ---- */
.pow-feed .polltoggle{display:inline-flex;align-items:center;justify-content:center;background:transparent;
  border:1px solid transparent;border-radius:8px;font-size:15px;line-height:1;padding:3px 5px;cursor:pointer;
  opacity:.85;transition:opacity .15s,border-color .15s,background .15s;}
.pow-feed .polltoggle:hover{opacity:1;border-color:var(--line);background:var(--panel2);}
.pow-feed .polltoggle.on{opacity:1;border-color:var(--neon);background:var(--accent-tint,rgba(0,255,156,.12));}
.pow-feed .pollcompose{display:flex;flex-direction:column;gap:8px;margin-top:10px;}
.pow-feed .pollcompose-row{display:flex;align-items:center;gap:8px;}
.pow-feed .pollcompose-input{flex:1;min-width:0;background:var(--panel2);border:1px solid var(--line);border-radius:8px;
  padding:9px 11px;color:var(--text);font:inherit;font-size:14px;outline:none;transition:border-color .15s;}
.pow-feed .pollcompose-input:focus{border-color:var(--cyan);}
.pow-feed .pollcompose-x{background:transparent;border:none;color:var(--dim);font-size:20px;line-height:1;
  cursor:pointer;padding:0 4px;transition:color .15s;}
.pow-feed .pollcompose-x:hover{color:var(--no);}
.pow-feed .pollcompose-add{align-self:flex-start;background:transparent;border:none;color:var(--cyan);
  font:inherit;font-size:13px;cursor:pointer;padding:2px 0;}
.pow-feed .pollcompose-add:hover{text-decoration:underline;}
.pow-feed .pollcompose-elig{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin-top:2px;font-size:12.5px;}
.pow-feed .pollcompose-elig-label{text-transform:uppercase;letter-spacing:.1em;font-size:11px;color:var(--dim);}
.pow-feed .pollcompose-elig label{display:inline-flex;align-items:center;gap:6px;cursor:pointer;color:var(--text);}
.pow-feed .pollcompose-elig label.on{color:var(--neon);}
.pow-feed .pollcompose-elig input{accent-color:var(--neon);cursor:pointer;}

/* ---- poll card (FeedPost: options before voting, result bars after) ---- */
.pow-feed .pollcard{margin:10px 0 2px;display:flex;flex-direction:column;gap:7px;}
.pow-feed .poll-opts,.pow-feed .poll-results{display:flex;flex-direction:column;gap:7px;}
.pow-feed .poll-opt{width:100%;text-align:left;background:transparent;border:1px solid var(--neon);border-radius:10px;
  padding:10px 13px;color:var(--text);font:inherit;font-size:14px;cursor:pointer;transition:background .15s;}
.pow-feed .poll-opt:hover:not(:disabled){background:var(--accent-tint,rgba(0,255,156,.12));}
.pow-feed .poll-opt:disabled{opacity:.55;cursor:default;}
.pow-feed .poll-res{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:10px;
  padding:10px 13px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:14px;}
.pow-feed .poll-res-fill{position:absolute;inset:0 auto 0 0;background:var(--accent-tint,rgba(0,255,156,.1));z-index:0;
  transition:width .45s ease;}
.pow-feed .poll-res.mine{border-color:var(--neon);}
.pow-feed .poll-res.mine .poll-res-fill{background:rgba(0,255,156,.18);}
/* Paper: the neon-green wash reads washed-out on light; use an ink-green tint
   that matches the ink-green "mine" border instead. */
html:not(.dark) .pow-feed .poll-res.mine .poll-res-fill{background:rgba(18,112,60,.15);}
.pow-feed .poll-res-text{position:relative;z-index:1;color:var(--text);}
.pow-feed .poll-res-pct{position:relative;z-index:1;color:var(--dim);font-variant-numeric:tabular-nums;font-weight:700;}
.pow-feed .poll-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12px;color:var(--dim);}
.pow-feed .poll-hint{margin-left:auto;color:var(--cyan);}
.pow-feed .poll-hint-link{text-decoration:underline;text-underline-offset:2px;}
.pow-feed .poll-hint-link:hover{color:var(--neon);}
.pow-feed .poll-note{margin:2px 0 0;font-size:12.5px;color:var(--no);}

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

/* The feed composer's Pay button: an icon-only square at rest (the eCash
   mark, same asset as the dashboard "Total earned" stat), quiet until you
   actually have something to pay for. The instant you type, it lights up,
   widens, the icon settles to the left edge, and the amount reveals on the
   right. min-width (not width) carries the growth animation — width:auto
   lets it grow past that for an unusually large amount without clipping,
   min-width is what's actually animatable. Corners rounded to match the
   site's other buttons (9px, same as the shared .btn radius). */
.pow-feed .paybtn{position:relative;display:flex;align-items:center;height:38px;width:40px;min-width:40px;
  background:transparent;border:1.5px solid var(--line);border-radius:9px;cursor:pointer;overflow:hidden;
  padding:0;flex:none;transition:min-width .32s cubic-bezier(.4,0,.2,1),border-color .25s,box-shadow .25s;}
.pow-feed .paybtn.active{width:auto;min-width:118px;}
.pow-feed .paybtn:disabled{cursor:not-allowed;opacity:.6;}
.pow-feed .paybtn-icon{position:absolute;top:50%;left:12px;transform:translate(0,-50%);line-height:1;
  transition:left .32s cubic-bezier(.4,0,.2,1);}
.pow-feed .paybtn.active .paybtn-icon{left:11px;}
.pow-feed .paybtn-amt{position:absolute;top:50%;right:12px;transform:translate(6px,-50%);font-size:12.5px;
  font-weight:700;letter-spacing:.02em;white-space:nowrap;opacity:0;color:var(--neon);
  transition:opacity .22s .08s,transform .22s .08s;}
.pow-feed .paybtn.active .paybtn-amt{opacity:1;transform:translate(0,-50%);}
.pow-feed .paybtn.active:not(:disabled){border-color:var(--neon);box-shadow:0 0 14px rgba(0,255,156,.4);}
.pow-feed .paybtn.active:hover:not(:disabled){box-shadow:0 0 22px rgba(0,255,156,.55);}
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

/* ---- tabs ---- */
.pow-feed .tabs{display:flex;gap:0;margin-top:20px;border-bottom:1px solid var(--line);}
.pow-feed .tab{flex:1;background:none;border:none;border-bottom:2px solid transparent;color:var(--dim);
  font:inherit;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;
  padding:12px 0;transition:color .15s,border-color .15s;}
.pow-feed .tab:hover{color:var(--cyan);}
.pow-feed .tab.on{color:var(--neon);border-bottom-color:var(--neon);text-shadow:0 0 8px rgba(0,255,156,.4);}

/* ---- new posts pill ----
   A sleek glass pill that drops in once (one-shot entrance — no ambient loop,
   per the house motion language). Dark, translucent, ringed in neon with a soft
   halo; fills solid neon on hover. */
.pow-feed .newposts{margin:16px 0 4px;display:flex;justify-content:center;
  animation:newposts-in .34s cubic-bezier(.2,.7,.3,1) both;}
/* Rectangular, neon-outlined — matches the forum New/Top/Create buttons. */
.pow-feed .newposts-pill{display:inline-flex;align-items:center;gap:8px;
  padding:6px 16px;border-radius:6px;cursor:pointer;font:inherit;
  font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;
  color:var(--neon);background:transparent;border:1px solid var(--neon);
  transition:box-shadow .15s,color .15s;}
.pow-feed .newposts-pill:hover:not(:disabled){box-shadow:0 0 12px rgba(0,255,156,.25);}
.pow-feed .newposts-pill:disabled{opacity:.6;cursor:default;}
/* Chevron nudges up once on entrance, then rests — a single directed cue. */
.pow-feed .newposts-chev{font-size:13px;line-height:1;font-weight:800;
  animation:newposts-chev .5s ease-out .12s both;}
.pow-feed .newposts-label{line-height:1;}
@keyframes newposts-in{
  from{opacity:0;transform:translateY(-9px) scale(.96);}
  to{opacity:1;transform:translateY(0) scale(1);}}
@keyframes newposts-chev{
  0%{transform:translateY(3px);opacity:.4;}
  60%{transform:translateY(-2px);opacity:1;}
  100%{transform:translateY(0);opacity:1;}}
@media (prefers-reduced-motion:reduce){
  .pow-feed .newposts{animation:none;}
  .pow-feed .newposts-chev{animation:none;}}

/* ---- feed list ---- */
/* overflow stays visible so a post's hover popovers (e.g. the like → tip menu)
   can escape the panel instead of being clipped on the first/last post. Posts
   carry no background and dividers sit mid-list, so nothing needs corner-clipping. */
.pow-feed .posts{margin-top:16px;}
.pow-feed .post{padding:16px;border-bottom:1px solid var(--line);}
.pow-feed .post:last-child{border-bottom:none;}
/* The post a timeline reply is answering: "Replying to @X" plus the parent's
   own words. Set INSIDE a hairline left rail so it reads as the thing being
   answered rather than as this post's opening lines — the reply itself starts
   at the column edge, the context is indented behind it. Two lines, hard. */
.pow-feed .replyingto{display:flex;flex-direction:column;align-items:flex-start;gap:3px;
  font-size:12px;color:var(--dim);margin:0 0 8px;padding-left:9px;
  border-left:2px solid var(--line);transition:color .15s,border-color .15s;}
.pow-feed .replyingto:hover{color:var(--cyan);border-left-color:var(--cyan);}
.pow-feed .replyingto-head{display:flex;align-items:center;gap:5px;}
.pow-feed .replyingto .replyarrow{color:var(--line);}
.pow-feed .replyingto-who{color:var(--hc,var(--cyan));font-weight:600;}
.pow-feed .replyingto-body{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
  overflow:hidden;line-height:1.45;color:var(--dim);opacity:.85;word-break:break-word;}

/* Conversation teaser under a post in For You: one reply, one line of it. Sits
   between the body and the action row, quiet enough that it never competes with
   the post it belongs to. */
.pow-feed .toprep{display:flex;align-items:baseline;gap:6px;margin:10px 0 0;padding-top:9px;
  border-top:1px dashed var(--line);font-size:12.5px;color:var(--dim);}
.pow-feed .toprep-arrow{flex:none;color:var(--line);}
.pow-feed .toprep .byline{font-size:12.5px;flex:none;}
.pow-feed .toprep .addr{font-size:12.5px;flex:none;}
.pow-feed .toprep .aibadge{font-size:9.5px;}
.pow-feed .toprep-body{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--dim);}
/* "Reposted by @X" context line above a resurfaced repost (Following timeline) */
.pow-feed .repostedby{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--dim);
  margin:0 0 6px;}
/* "📌 Pinned" eyebrow above a pinned post on a profile (reads like "Reposted by"). */
.pow-feed .pinnedtag{display:flex;align-items:center;gap:5px;font-size:12px;font-weight:600;
  color:var(--no);margin:0 0 6px;letter-spacing:.02em;}
.pow-feed .pinnedtag span{font-size:11px;line-height:1;}
.pow-feed .reposticon{font-size:11px;line-height:1;}
.pow-feed .repostedby-who{color:var(--hc,var(--dim));font-weight:600;transition:color .15s;}
.pow-feed a.repostedby-who:hover{color:var(--cyan);}
.pow-feed .postmeta{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;}
.pow-feed .byline{font-size:13px;font-weight:700;color:var(--hc,var(--neon));text-shadow:0 0 8px rgba(0,255,156,.35);transition:text-shadow .15s;}
.pow-feed .byline:hover{text-shadow:0 0 14px rgba(0,255,156,.6);}
.pow-feed .addr{font-size:13px;color:var(--cyan);text-decoration:none;}
.pow-feed a.addr:hover{text-decoration:underline;}
/* [AI] disclosure chip beside an AI-operated account's byline (authors.is_ai).
   The literal brackets are the chrome — terminal green on dark; on paper the
   --neon token remaps to ink-green and the global paper rule kills the glow. */
.pow-feed .aibadge{flex:none;font-size:10.5px;font-weight:700;letter-spacing:.1em;color:var(--neon);
  text-shadow:0 0 8px rgba(0,255,156,.35);white-space:nowrap;cursor:default;}
.pow-feed .profname .aibadge{font-size:14px;margin-left:10px;vertical-align:middle;}
.pow-feed .dot{color:var(--line);}
.pow-feed .time{font-size:12px;color:var(--dim);}
.pow-feed .time:hover{color:var(--cyan);}
/* Top-right cluster on a post's meta row: Copy link, then the "+" menu. The
   cluster owns the margin-left:auto so the two sit together at the right edge
   whether or not the menu is showing (it's viewer/ownership dependent). */
.pow-feed .postactions{margin-left:auto;align-self:center;display:inline-flex;align-items:center;gap:2px;}
.pow-feed .postactions .postmenu{margin-left:0;}
.pow-feed .postcopy{display:inline-flex;align-items:center;justify-content:center;width:26px;height:22px;
  background:none;border:none;padding:0;border-radius:6px;color:var(--dim);cursor:pointer;
  transition:color .15s,background .15s;}
.pow-feed .postcopy:hover{color:var(--cyan);background:rgba(255,255,255,.05);}
.pow-feed .postcopy.copied{color:var(--neon);}
.pow-feed .postcopy.failed{color:var(--no);}
.pow-feed .postcopy-ok{font-size:14px;line-height:1;}
/* overflow (···) menu on a post / profile — Follow + Block live here */
.pow-feed .postmenu{position:relative;align-self:center;display:inline-flex;margin-left:auto;}
.pow-feed .menubtn{background:none;border:none;color:var(--dim);font:inherit;font-size:19px;font-weight:600;line-height:1;
  padding:0 6px;border-radius:6px;cursor:pointer;transition:color .15s,background .15s;}
.pow-feed .menubtn:hover{color:var(--text);background:rgba(255,255,255,.05);}
/* Already-following state: the + trigger becomes a check, tinted so it reads as
   "you follow them" rather than a follow prompt. Used on profiles and article
   pages, where the check still opens the manage menu (unfollow / block). Feed
   posts show nothing when following. */
.pow-feed .menubtn.on{color:var(--neon);}
.pow-feed .menupop{position:absolute;top:100%;right:0;margin-top:4px;z-index:20;width:max-content;min-width:96px;
  background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:4px;
  box-shadow:0 8px 24px rgba(0,0,0,.5);}
.pow-feed .menuitem{display:block;width:100%;text-align:right;background:none;border:none;font:inherit;font-size:13px;
  color:var(--text);padding:8px 10px;border-radius:7px;cursor:pointer;transition:background .12s,color .12s;}
.pow-feed .menuitem:hover{background:rgba(255,92,108,.12);}
.pow-feed .menuitem.danger{color:var(--no);}
.pow-feed .menuitem:disabled{opacity:.6;cursor:default;}
.pow-feed .body{margin:8px 0 0;white-space:pre-wrap;word-break:break-word;font-size:15px;line-height:1.6;color:var(--text);}
/* Handle-mint card: native feed card for a freshly minted handle NFT. */
.pow-feed .mintcard{margin:10px 0 2px;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--panel2);}
.pow-feed .mintcard-imglink{display:block;}
.pow-feed .mintcard-img{display:block;width:100%;height:auto;background:#171513;transition:opacity .15s;}
.pow-feed .mintcard-imglink:hover .mintcard-img{opacity:.92;}
.pow-feed .mintcard-info{display:flex;flex-direction:column;gap:3px;padding:12px 14px;border-top:1px solid var(--line);}
.pow-feed .mintcard-kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);}
.pow-feed .mintcard-handle{font-size:18px;font-weight:700;color:var(--neon);text-shadow:0 0 8px rgba(0,255,156,.35);transition:text-shadow .15s;width:fit-content;}
.pow-feed a.mintcard-handle:hover{text-shadow:0 0 14px rgba(0,255,156,.6);}
.pow-feed .mintcard-tier{font-size:12px;color:var(--dim);font-variant-numeric:tabular-nums;}
/* Inline @handle mention link inside a post/reply/ancestor/focused body. */
.pow-feed .mention{color:var(--cyan);text-decoration:none;transition:text-shadow .15s;}
.pow-feed .mention:hover{text-shadow:0 0 10px rgba(61,240,255,.45);}
/* Outbound X/Twitter link — a trailing ↗ marks that it leaves the site (opens a
   new tab), distinguishing it from on-site cyan links. */
.pow-feed .extlink::after{content:"↗";font-size:.8em;margin-left:1px;vertical-align:baseline;}
/* Mint announcements riding the timeline as quiet pulse lines: .mintline is a
   real post rendered one-line-quiet (dim body, tighter spacing, no card art —
   the art lives on the profile gallery, thread page, and quote embeds);
   .mintdigest is the ONE synthetic row a busy span collapses into. */
.pow-feed .post.mintline{padding:12px 16px;}
.pow-feed .post.mintline .body{margin-top:4px;font-size:13px;line-height:1.5;color:var(--dim);}
.pow-feed .post.mintline .actions{margin-top:8px;}
.pow-feed .post.mintdigest{display:flex;align-items:baseline;gap:6px;padding:12px 16px;
  font-size:13px;color:var(--dim);cursor:default;}
.pow-feed .mintdigest-icon{flex:none;}
.pow-feed .mintdigest-text{min-width:0;}
.pow-feed .mintdigest-more{color:var(--dim);font-weight:600;text-decoration:none;transition:color .15s;}
.pow-feed a.mintdigest-more:hover{color:var(--cyan);}
/* The minter byline — @proofofwriting, the account every mint comes from. */
.pow-feed .mintdigest-actor{font-weight:700;color:var(--hc,var(--neon));text-decoration:none;
  text-shadow:0 0 8px rgba(0,255,156,.35);transition:text-shadow .15s;}
.pow-feed .mintdigest-actor:hover{text-shadow:0 0 12px rgba(0,255,156,.55);}
/* Mint-card art inside a quote embed (the buyer's "that's me!" post). */
.pow-feed .qmint-img{display:block;max-width:240px;width:100%;height:auto;margin-top:8px;
  border:1px solid var(--line);border-radius:10px;background:#171513;}
.pow-feed .showmore{display:inline;background:none;border:none;color:var(--cyan);font:inherit;font-size:14px;cursor:pointer;
  padding:0;margin-left:6px;transition:text-shadow .15s;}
.pow-feed .showmore:hover{text-shadow:0 0 10px rgba(61,240,255,.5);}
.pow-feed .actions{display:flex;align-items:center;gap:16px;margin-top:12px;flex-wrap:wrap;}
.pow-feed .replybtn{background:none;border:none;color:var(--dim);font:inherit;font-size:13px;cursor:pointer;padding:2px 0;
  transition:color .15s;}
.pow-feed .replybtn:hover{color:var(--cyan);}
.pow-feed .delbtn{background:none;border:none;color:var(--dim);font:inherit;font-size:13px;cursor:pointer;padding:2px 0;
  transition:color .15s;}
.pow-feed .delbtn:hover{color:var(--no);}
.pow-feed .delbtn:disabled{opacity:.5;cursor:default;}
.pow-feed .sharefeedbtn{background:none;border:none;color:var(--dim);font:inherit;font-size:13px;cursor:pointer;padding:2px 0;}
.pow-feed .sharefeedbtn:hover{color:var(--cyan);}
.pow-feed .pinbtn{background:none;border:none;color:var(--dim);font:inherit;font-size:13px;cursor:pointer;padding:2px 0;
  transition:color .15s;}
.pow-feed .pinbtn:hover{color:var(--cyan);}
.pow-feed .pinbtn:disabled{opacity:.5;cursor:default;}
/* Pin/Delete live in the top meta-row actions cluster as ICON buttons the SAME
   size as the copy-link icon (26x22 box, 15px glyph), so the three sit evenly.
   The pin lights up red (--no) when pinned; delete goes red on hover. */
.pow-feed .postactions .pinbtn,
.pow-feed .postactions .delbtn{
  display:inline-flex;align-items:center;justify-content:center;
  width:26px;height:22px;padding:0;border-radius:6px;color:var(--dim);}
.pow-feed .postactions .pinbtn:hover,
.pow-feed .postactions .delbtn:hover{background:rgba(255,255,255,.05);}
.pow-feed .postactions .pinbtn:hover{color:var(--cyan);}
.pow-feed .postactions .pinbtn.on,
.pow-feed .postactions .pinbtn.on:hover{color:var(--no);}
.pow-feed .postactions .delbtn:hover{color:var(--no);}
.pow-feed .inlinereply,.pow-feed .inlinequote{margin-top:12px;flex-basis:100%;}
/* replies just posted, nested inline under their parent post on the feed */
.pow-feed .postreplies{list-style:none;margin:12px 0 0 6px;padding:0 0 0 14px;border-left:2px solid var(--line);}
.pow-feed .postreplies .post{padding:12px 0;}
.pow-feed .postreplies .post:first-child{padding-top:0;}
.pow-feed .postreplies .post:last-child{padding-bottom:0;border-bottom:none;}
.pow-feed .tombstone{color:var(--dim);font-style:italic;}

/* ---- engagement (like / repost / quote) ---- */
/* .engage is display:contents so its buttons flow into the .actions flex row,
   while .reactpay / .notice take a full-width line of their own via flex-basis. */
.pow-feed .engage{display:contents;}
.pow-feed .engagebar{display:inline-flex;align-items:center;gap:16px;}
.pow-feed .likebtn,.pow-feed .repostbtn,.pow-feed .quotebtn{background:none;border:none;color:var(--dim);font:inherit;
  font-size:13px;cursor:pointer;padding:2px 0;font-variant-numeric:tabular-nums;transition:color .15s,text-shadow .15s;}
.pow-feed .likebtn:hover{color:var(--no);}
.pow-feed .likebtn.on{color:var(--no);text-shadow:0 0 10px rgba(255,92,108,.5);}
.pow-feed .repostbtn:hover,.pow-feed .quotebtn:hover{color:var(--neon);}
/* The ❝ quotation ornament sits on the cap-height line, riding high next to the
   vertically-centred emoji glyphs (💬 ♡ 🔁). Bump the size and nudge it down so
   it optically lines up with the other action icons. */
/* line-height:0 keeps the oversized ❝ from expanding the button's line box — so
   the quote COUNT sits at the same baseline as the reply/reaction numbers instead
   of being dragged down — while the glyph still renders at 23px (overflowing) and
   is optically centred by the translate. */
.pow-feed .qico{display:inline-block;font-size:23px;line-height:0;transform:translateY(9px);}
/* The like heart (♡/♥) and quote ❝ are thin text glyphs — render them larger so
   they carry the same visual weight as the emoji action icons (💬 reply, 🔁 repost). */
.pow-feed .likeico{display:inline-block;font-size:18px;line-height:1;transform:translateY(2px);}
.pow-feed .repostbtn.on{color:var(--neon);text-shadow:0 0 10px rgba(0,255,156,.5);}
.pow-feed .likebtn:disabled,.pow-feed .repostbtn:disabled{cursor:default;opacity:.7;}
.pow-feed .reactpay{flex-basis:100%;width:100%;margin-top:12px;padding:14px;border:1px solid var(--line);border-radius:12px;
  background:var(--panel2);}
.pow-feed .reactpay .poll{margin:0;}
.pow-feed .reactpay .manual{margin-top:14px;}
.pow-feed .engage .notice{flex-basis:100%;width:100%;}

/* Emoji reactions: per-emoji counts + the picker popover (replaces like/tip menu).
   A pill reads like the reply/repost counts — no circle — and each is its OWN
   flex item (order:10) so they flow inline after the action icons and wrap one at
   a time, aligning to the left edge like the reply count on the next row. */
.pow-feed .reactpill{order:10;background:none;border:none;color:var(--dim);font:inherit;font-size:13px;
  cursor:pointer;padding:2px 0;font-variant-numeric:tabular-nums;transition:color .15s;}
.pow-feed .reactpill:hover{color:var(--neon);}
.pow-feed .reactpill:disabled{cursor:default;opacity:.6;}
.pow-feed .reactwrap{position:relative;display:inline-flex;}
/* Outline ♡, not a filled/colored heart — the trigger for "add a reaction" has
   to read as an action, not as a reaction that's already been placed (the
   pills next to it show real reactions in solid color). Same thin-text-glyph
   case as .likeico above: needs the size boost to carry the same visual
   weight as the emoji action icons beside it. */
.pow-feed .reactbtn{background:none;border:none;color:var(--dim);font:inherit;font-size:18px;line-height:1;
  cursor:pointer;padding:0 2px;letter-spacing:-.05em;transition:color .15s;
  /* The ♡ outline reads thin/faint at --dim in both themes — stroke the glyph in
     its own colour to fatten the outline (and the +) so it's easier to spot. */
  -webkit-text-stroke:0.7px currentColor;}
.pow-feed .reactbtn:hover,.pow-feed .reactbtn.on{color:var(--neon);}
.pow-feed .reactbtn:disabled{cursor:default;opacity:.7;}
/* Picker: a fixed 2 rows of 4 (8 emoji), revealed on hover/focus of .reactwrap
   (like the old tip menu). Hidden by default; a transparent ::after bridges the
   6px gap so the pointer can travel from the button into the picker. */
.pow-feed .reactpicker{display:none;position:absolute;bottom:calc(100% + 6px);left:0;z-index:20;
  grid-template-columns:repeat(4,auto);gap:2px;background:var(--panel);border:1px solid var(--line);
  border-radius:12px;padding:8px;box-shadow:0 8px 24px rgba(0,0,0,.5);}
.pow-feed .reactwrap:hover .reactpicker,.pow-feed .reactwrap:focus-within .reactpicker{display:grid;}
.pow-feed .reactpicker::after{content:"";position:absolute;top:100%;left:0;right:0;height:8px;}
.pow-feed .reactopt{background:none;border:none;font-size:22px;line-height:1;padding:4px;border-radius:8px;
  cursor:pointer;transition:background .12s,transform .12s;}
.pow-feed .reactopt:hover{background:var(--panel2);transform:scale(1.15);}
/* "Who reacted" popover — your own post only, opened by clicking the react icon. */
.pow-feed .whoreacted{position:absolute;bottom:calc(100% + 6px);left:0;z-index:20;min-width:210px;max-width:300px;
  max-height:280px;overflow-y:auto;background:var(--panel);border:1px solid var(--line);border-radius:12px;
  padding:10px 12px;box-shadow:0 8px 24px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:8px;}
.pow-feed .whoreacted::after{content:"";position:absolute;top:100%;left:0;right:0;height:8px;}
.pow-feed .whorow{display:flex;align-items:baseline;gap:8px;font-size:12.5px;}
.pow-feed .whoemoji{font-size:15px;flex-shrink:0;line-height:1;}
.pow-feed .whonames{color:var(--text);word-break:break-word;line-height:1.45;}
.pow-feed .whonote{margin:0;font-size:12.5px;color:var(--dim);}

/* like → tip menu: quick presets + a custom amount, floating above the button.
   Revealed on hover (or keyboard focus) of the Like button; a transparent bridge
   spans the gap so the pointer can travel from button up into the menu without
   the hover dropping. */
.pow-feed .likewrap{position:relative;display:inline-flex;}
.pow-feed .tipmenu{display:none;position:absolute;bottom:calc(100% + 6px);left:0;z-index:20;width:264px;
  background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px;
  box-shadow:0 8px 24px rgba(0,0,0,.5);}
.pow-feed .likewrap:hover .tipmenu,.pow-feed .likewrap:focus-within .tipmenu{display:block;}
.pow-feed .tipmenu::after{content:"";position:absolute;top:100%;left:0;right:0;height:10px;}
.pow-feed .tiptitle{margin:0 0 8px;font-size:12px;color:var(--dim);}
.pow-feed .tippresets{display:flex;gap:6px;margin-bottom:8px;}
.pow-feed .tippreset{flex:1;background:var(--panel2);border:1px solid var(--line);color:var(--text);
  font:inherit;font-size:11px;padding:6px 0;border-radius:8px;cursor:pointer;font-variant-numeric:tabular-nums;
  transition:border-color .12s,color .12s;}
.pow-feed .tippreset:hover{border-color:var(--neon);color:var(--neon);}
.pow-feed .tiprow{display:flex;align-items:center;gap:6px;}
.pow-feed .tipfield{flex:1;min-width:0;display:flex;align-items:center;gap:6px;background:var(--bg);
  border:1px solid var(--line);border-radius:8px;padding:0 8px;}
.pow-feed .tipfield:focus-within{border-color:var(--neon);}
.pow-feed .tipinput{flex:1;min-width:0;background:transparent;border:none;color:var(--text);
  font:inherit;font-size:13px;padding:6px 0;font-variant-numeric:tabular-nums;}
.pow-feed .tipinput:focus{outline:none;}
.pow-feed .tipunit{font-size:12px;color:var(--dim);flex:none;}
.pow-feed .tipgo{background:var(--neon);border:1px solid var(--neon);color:#04140d;font:inherit;font-size:13px;
  font-weight:600;padding:6px 12px;border-radius:8px;cursor:pointer;transition:opacity .12s;}
.pow-feed .tipgo:hover{opacity:.85;}
.pow-feed .tipmenu .notice{margin:8px 0 0;font-size:12px;}

/* ---- quoted embed ---- */
.pow-feed .quoted{margin:12px 0 0;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--panel2);
  transition:border-color .15s,box-shadow .15s;}
.pow-feed .quoted[role="link"]:hover{border-color:var(--cyan);box-shadow:0 0 16px rgba(61,240,255,.12);}
.pow-feed .quoted .qmeta{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;}
.pow-feed .qbyline{font-weight:700;color:var(--hc,var(--neon));font-size:12px;text-shadow:0 0 8px rgba(0,255,156,.3);}
.pow-feed .qaddr{font-size:12px;color:var(--cyan);text-decoration:none;}
.pow-feed a.qaddr:hover{text-decoration:underline;}
/* Forum label on a shared forum post/comment embed — a small cyan kicker. */
.pow-feed .qforum{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--cyan);margin:0 0 6px;font-weight:700;}
.pow-feed .qforum-slug{color:var(--cyan);}
.pow-feed .qtitle{margin:6px 0 0;font-size:15px;font-weight:700;line-height:1.3;color:var(--text);word-break:break-word;}
.pow-feed .qbody{margin:6px 0 0;white-space:pre-wrap;word-break:break-word;font-size:14px;line-height:1.5;color:#b9e6d8;}
.pow-feed .quoted-gone{color:var(--dim);font-style:italic;font-size:13px;}

/* ---- article link card ---- */
/* Trying the OTHER idea from the share-card brainstorm this time: not a
   settle-into-static-glow entrance, but a genuine ambient loop — a thin arc
   perpetually orbits the border ring via a masked conic-gradient overlay
   (same trick as before: a ::before sized to the border, masked so only the
   ring shows), driven by an animated @property angle. Dark mode only — a
   rotating gradient read as "glow in motion" needs real light to travel
   through, which paper's flat ink-on-paper theme doesn't have; light mode
   keeps the plain hairline card, hover-lit like every other feed element. */
@property --artcard-angle{syntax:'<angle>';inherits:false;initial-value:0deg;}
.pow-feed .artcard{position:relative;isolation:isolate;display:flex;flex-direction:column;gap:6px;
  margin:12px 0 0;padding:14px 16px;
  border:1px solid var(--neon);border-radius:12px;background:var(--panel2);
  transition:box-shadow .15s,background .15s;}
.pow-feed .artcard:hover{box-shadow:0 0 20px rgba(0,255,156,.22);background:rgba(0,255,156,.06);}
/* A point of LIGHT orbiting the border, not just a colored stripe. The base
   border is solid neon everywhere, so the arc has to out-shine it: a white-hot
   head with a neon tail trailing behind (a comet), and — the piece that sells
   it as a light rather than a painted arc — a drop-shadow bloom that travels
   WITH the head, spilling glow off the ring as it passes. Everywhere the comet
   isn't, the gradient is transparent, so the plain neon ring shows through
   unchanged. The bloom is a dark-theme device (see the paper override below,
   which trades it for pure saturation). */
.pow-feed .artcard::before{content:"";position:absolute;inset:-1px;border-radius:inherit;
  padding:1.5px;pointer-events:none;
  background:conic-gradient(from var(--artcard-angle),transparent 0deg,transparent 28deg,rgba(0,255,156,.55) 55deg,var(--neon) 72deg,#a9ffd8 82deg,#fff 89deg,#fff 92deg,transparent 97deg,transparent 360deg);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude;
  filter:drop-shadow(0 0 5px #fff) drop-shadow(0 0 14px var(--neon));
  animation:artcard-orbit 4s linear infinite;}
@keyframes artcard-orbit{to{--artcard-angle:360deg;}}
@media (prefers-reduced-motion:reduce){
  .pow-feed .artcard::before{animation:none;display:none;}
}
.pow-feed .artcard-tag{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--neon);
  text-shadow:0 0 8px rgba(0,255,156,.4);}
/* A forum link card reuses the article-card shell but tags in cyan, so Forum vs
   Article reads at a glance. */
.pow-feed .forumembed .artcard-tag{color:var(--cyan);text-shadow:0 0 8px rgba(61,240,255,.4);}
.pow-feed .forumembed:hover{box-shadow:0 0 20px rgba(61,240,255,.22);background:rgba(61,240,255,.06);}
.pow-feed .artcard-title{font-size:16px;font-weight:700;line-height:1.35;color:var(--text);}
.pow-feed .artcard-teaser{font-size:13px;line-height:1.5;color:#b9e6d8;}
.pow-feed .artcard-meta{margin-top:2px;font-size:12px;letter-spacing:.02em;color:var(--dim);}
.pow-feed .artcard-price{color:var(--cyan);}

/* ---- profile header ---- */
.pow-feed .profhead{margin:0 0 8px;}
.pow-feed .profname{margin:0;font-size:30px;font-weight:800;letter-spacing:.02em;color:var(--hc,var(--neon));
  text-shadow:0 0 14px rgba(0,255,156,.45);word-break:break-word;}
.pow-feed .profname.isaddr{font-size:18px;letter-spacing:0;color:var(--cyan);text-shadow:0 0 12px rgba(61,240,255,.4);}
/* The address + Tip button share one row right under the byline; each child's
   own top margin is reset here so the ROW carries that spacing instead (else
   they'd double up). */
.pow-feed .profaddrrow{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:8px 0 0;}
.pow-feed .profaddrrow .profaddr,.pow-feed .profaddrrow .profcopied{margin:0;}
.pow-feed .profaddr{display:inline-block;margin:8px 0 0;padding:0;font:inherit;font-size:12px;background:none;border:0;color:var(--dim);cursor:pointer;transition:color .15s;}
.pow-feed .profaddr:hover{color:var(--cyan);}
.pow-feed .profcopied{display:inline-block;margin:8px 0 0 10px;font-size:12px;color:var(--neon);}
.pow-feed .proffollow{display:flex;align-items:center;gap:14px;margin:14px 0 0;}
.pow-feed .proffollowers{font-size:14px;color:var(--dim);}
.pow-feed .proffollowers.standalone{display:block;margin:14px 0 0;}
.pow-feed .proffollowers strong{color:var(--text);font-weight:700;}
.pow-feed .proffollow .postmenu{margin-left:0;}
/* The follow control sits alone in its own row now (Tip moved up next to the
   address — see .profaddrrow above). */
.pow-feed .profactions{display:flex;align-items:center;flex-wrap:wrap;gap:14px;margin:14px 0 0;}
.pow-feed .profactions .proffollow,.pow-feed .profactions .proffollowers.standalone{margin-top:0;}
.pow-feed .tipwrap{display:inline-flex;}
/* The feed like menu opens UPWARD (the like button sits at the bottom of a post).
   The profile Tip button sits near the TOP of the page under a sticky header, so
   an upward menu would render behind it — flip this one to open DOWNWARD, and move
   the invisible hover-bridge above the menu (between button and menu) to match. */
.pow-feed .tipwrap .tipmenu{top:calc(100% + 6px);bottom:auto;}
.pow-feed .tipwrap .tipmenu::after{top:auto;bottom:100%;}
/* On phones the 264px dropdown, anchored to the BUTTON's left edge, ran off the
   right side (worse the further right the button sits — a longer follower count,
   or a long address). Keep it a dropdown BELOW the button, but anchor it to the
   address row (which starts at the content's left margin, not wherever the
   button landed) and cap its width to the viewport — so it always fits. */
@media (max-width:600px){
  .pow-feed .profaddrrow{position:relative;}
  .pow-feed .tipwrap{position:static;} /* menu now anchors to .profaddrrow, not the button */
  .pow-feed .tipwrap .tipmenu{
    top:calc(100% + 6px);bottom:auto;left:0;right:auto;
    width:min(264px, calc(100vw - 24px));
  }
}
.pow-feed .tipbtn{background:none;border:1px solid var(--line);color:var(--text);font:inherit;font-size:12px;
  font-weight:600;line-height:1;padding:4px 9px;border-radius:999px;cursor:pointer;display:inline-flex;
  align-items:center;gap:4px;transition:border-color .15s,color .15s;}
.pow-feed .tipbtn:hover{border-color:var(--neon);color:var(--neon);}
.pow-feed .tipbtn:disabled{opacity:.7;cursor:default;}
.pow-feed .profstats{display:flex;align-items:center;flex-wrap:wrap;gap:16px;margin:16px 0 0;font-size:13px;color:var(--dim);}
.pow-feed .profstat{display:inline-flex;align-items:center;gap:6px;}
.pow-feed .profstat strong{color:var(--text);font-weight:700;}
.pow-feed .artlink{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;
  padding:6px 14px;font-size:13px;color:var(--cyan);transition:border-color .15s,box-shadow .15s;}
.pow-feed .artlink:hover{border-color:var(--cyan);box-shadow:0 0 14px rgba(61,240,255,.2);}
.pow-feed .profbio{margin:16px 0 0;white-space:pre-wrap;word-break:break-word;font-size:14px;line-height:1.6;color:#b9e6d8;}

/* ---- article listing (profile → articles) ---- */
.pow-feed .artlist{margin-top:16px;overflow:hidden;list-style:none;padding:0;}
.pow-feed .artrow{padding:16px;border-bottom:1px solid var(--line);}
.pow-feed .artrow:last-child{border-bottom:none;}
.pow-feed .artrow-title{display:inline-block;font-size:17px;font-weight:700;line-height:1.35;color:var(--text);
  transition:color .15s,text-shadow .15s;}
.pow-feed .artrow-title:hover{color:var(--neon);text-shadow:0 0 12px rgba(0,255,156,.4);}
.pow-feed .artrow-meta{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:8px 0 0;font-size:12px;color:var(--dim);
  font-variant-numeric:tabular-nums;}
.pow-feed .artrow-sep{color:var(--line);}
.pow-feed .artrow-teaser{margin:10px 0 0;font-size:14px;line-height:1.55;color:#b9e6d8;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
.pow-feed .artlegacy{margin-top:20px;}
.pow-feed .artlegacy summary{cursor:pointer;list-style:none;font-size:12px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--dim);transition:color .15s;}
.pow-feed .artlegacy summary::-webkit-details-marker{display:none;}
.pow-feed .artlegacy summary:hover{color:var(--cyan);}
.pow-feed .artlegacy[open] summary{color:var(--cyan);margin-bottom:4px;}

/* ---- dashboard ---- */
.pow-feed .dashpanel{background:var(--panel);border:1px solid var(--line);border-radius:14px;
  box-shadow:0 0 26px rgba(0,255,156,.06);padding:22px;margin-top:18px;}
.pow-feed .wrap > .dashpanel:first-child{margin-top:0;}
.pow-feed .dashtop{display:flex;align-items:center;justify-content:space-between;gap:12px;}
.pow-feed .dashwelcome{margin:0;font-size:22px;font-weight:800;letter-spacing:.01em;color:var(--neon);
  text-shadow:0 0 12px rgba(0,255,156,.4);min-width:0;overflow-wrap:anywhere;}
/* compact logout in the welcome header (mobile only) — never shrinks, so a long
   handle wraps instead of squeezing the button. Selector carries .dashbtn so it
   beats the base .dashbtn sizing that appears later in this sheet. */
.pow-feed .dashbtn.dash-logout-top{flex-shrink:0;padding:6px 12px;font-size:12px;}
.pow-feed .dashwelcome a{color:var(--hc,var(--cyan));}
.pow-feed .dashwelcome a:hover{text-shadow:0 0 10px rgba(61,240,255,.5);}
.pow-feed .dashbell{position:relative;display:inline-flex;align-items:center;justify-content:center;
  width:38px;height:38px;border-radius:999px;border:1px solid var(--line);background:var(--panel2);
  color:var(--text);font-size:16px;cursor:pointer;flex:none;transition:border-color .15s,box-shadow .15s;}
.pow-feed .dashbell:hover{border-color:var(--cyan);box-shadow:0 0 14px rgba(61,240,255,.2);}
.pow-feed .dashbell svg{display:block;}
.pow-feed .dashbadge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 5px;
  display:inline-flex;align-items:center;justify-content:center;border-radius:999px;background:var(--no);
  color:#170305;font-size:10px;font-weight:700;line-height:1;}
.pow-feed .dashstats{display:flex;flex-direction:column;gap:10px;margin-top:18px;}
.pow-feed .dashstat{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:12px 16px;}
.pow-feed .dashstat-label{margin:0;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);}
.pow-feed .dashstat-value{margin:6px 0 0;font-size:18px;font-weight:800;color:var(--text);font-variant-numeric:tabular-nums;}
.pow-feed .dashbio{margin:16px 0 0;font-size:14px;line-height:1.6;color:#b9e6d8;white-space:pre-wrap;word-break:break-word;}
.pow-feed .dashaddr{margin:12px 0 0;font-size:12px;color:var(--dim);word-break:break-all;cursor:pointer;transition:color .15s;}
.pow-feed .dashaddr:hover{color:var(--cyan);}
.pow-feed .dashcopied{margin:6px 0 0;font-size:12px;color:var(--neon);}
.pow-feed .dashhandles{margin-top:20px;}
.pow-feed .dashhandles-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}
.pow-feed .dashhandles-search{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:6px 10px;
  font:inherit;font-size:12px;color:var(--text);min-width:160px;transition:border-color .15s,box-shadow .15s;}
.pow-feed .dashhandles-search:focus{outline:none;border-color:var(--cyan);box-shadow:0 0 12px rgba(61,240,255,.16);}
.pow-feed .dashhandles-track{display:flex;align-items:flex-start;gap:10px;margin-top:12px;overflow-x:auto;padding:4px 2px 12px;
  scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;
  /* scrolls by wheel/swipe, never shows the gray gutter (macOS always-show) */
  scrollbar-width:none;}
.pow-feed .dashhandles-track::-webkit-scrollbar{display:none;}
.pow-feed .dashhandle{flex:0 0 auto;width:88px;display:flex;flex-direction:column;align-items:center;gap:8px;
  background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:12px 8px;cursor:pointer;
  font:inherit;color:var(--text);scroll-snap-align:start;transition:border-color .15s,box-shadow .15s,transform .1s;}
.pow-feed .dashhandle:hover{border-color:var(--cyan);box-shadow:0 0 12px rgba(61,240,255,.14);}
.pow-feed .dashhandle:disabled{cursor:default;opacity:.7;}
.pow-feed .dashhandle.static{cursor:default;}
.pow-feed .dashhandle.static:hover{border-color:var(--line);box-shadow:none;}
/* A static card that links out (to its Cashtab token page to list/buy) is
   clickable — restore the pointer, and give the text-only fallback a hover
   glow. Image cards keep their existing .hasimg img glow. */
.pow-feed .dashhandle.static.link{cursor:pointer;text-decoration:none;}
.pow-feed .dashhandle.static.link:not(.hasimg):hover{border-color:var(--cyan);box-shadow:0 0 12px rgba(61,240,255,.18);}
.pow-feed .dashhandle.active{border-color:var(--neon);box-shadow:0 0 16px rgba(0,255,156,.28);}
.pow-feed .dashhandle-img{width:104px;height:104px;max-width:none;border-radius:12px;object-fit:cover;background:var(--panel);border:1px solid var(--line);
  transition:border-color .15s,box-shadow .15s;}
/* Handle tiles that have a rendered card: the card IS the tile (no chrome, no label below). */
.pow-feed .dashhandle.hasimg{width:auto;padding:0;border:none;background:none;box-shadow:none;}
.pow-feed .dashhandle.hasimg:hover{box-shadow:none;}
.pow-feed .dashhandle.hasimg:hover .dashhandle-img{border-color:var(--cyan);box-shadow:0 0 14px rgba(61,240,255,.22);}
.pow-feed .dashhandle.hasimg.active .dashhandle-img{border-color:var(--neon);box-shadow:0 0 16px rgba(0,255,156,.28);}
.pow-feed .dashhandle-addr{width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:18px;font-weight:800;color:var(--neon);background:var(--panel);border:1px solid var(--line);}
.pow-feed .dashhandle-name{max-width:100%;font-size:12px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pow-feed .dashhandle.active .dashhandle-name{color:var(--neon);}
/* "Buy handle" call-to-action tile (shown when the wallet holds no handles). */
.pow-feed .dashhandle.buy{border-style:dashed;border-color:var(--neon);text-decoration:none;}
.pow-feed .dashhandle.buy:hover{border-color:var(--neon);box-shadow:0 0 14px rgba(0,255,156,.28);}
.pow-feed .dashhandle.buy .dashhandle-addr{color:var(--neon);border-color:var(--neon);font-size:30px;font-weight:400;}
.pow-feed .dashhandle.buy .dashhandle-name{color:var(--neon);}
/* Full handle shown in a floating tooltip on hover/focus (portal-rendered at
   the body so the carousel's horizontal scroll can't clip it). The card itself
   never resizes. */
.dashhandle-tip{position:fixed;transform:translate(-50%,-100%);margin-top:-8px;background:#0d1513;
  border:1px solid #00ff9c;color:#00ff9c;padding:4px 9px;border-radius:7px;font-size:11px;
  font-family:'JetBrains Mono',ui-monospace,monospace;white-space:nowrap;pointer-events:none;z-index:9999;
  box-shadow:0 0 14px rgba(0,255,156,.28);}
html:not(.dark) .dashhandle-tip{background:#fdfcf8;border-color:#e3dfd2;color:#12703c;box-shadow:0 8px 24px rgba(26,28,23,.12);}
.pow-feed .dashhandle-more{flex:0 0 auto;align-self:center;font-size:11px;color:var(--dim);padding:0 8px;white-space:nowrap;}
.pow-feed .dashhandles-error{margin:8px 0 0;font-size:12px;color:var(--no);}
.pow-feed .dashnotifs{margin-top:16px;background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:14px;}
.pow-feed .dashnotifs-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;}
.pow-feed .dashnotifs-title{margin:0;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);}
.pow-feed .dashnotifs-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;
  max-height:min(60vh,460px);overflow-y:auto;}
.pow-feed .dashnotif{display:block;border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--panel);
  transition:border-color .15s,box-shadow .15s;}
.pow-feed .dashnotif:hover{border-color:var(--cyan);box-shadow:0 0 12px rgba(61,240,255,.12);}
.pow-feed .dashnotif.hl{border-left:3px solid var(--neon);}
.pow-feed .dashnotif.read{opacity:.55;}
.pow-feed .dashnotif-msg{margin:0;font-size:13px;color:var(--text);}
.pow-feed .dashnotif-time{margin:4px 0 0;font-size:11px;color:var(--dim);}
.pow-feed .dashnotif-more{display:block;width:100%;margin-top:10px;background:none;border:1px solid var(--line);
  border-radius:9px;padding:9px 12px;font:inherit;font-size:13px;color:var(--cyan);cursor:pointer;text-align:center;
  transition:background .12s,border-color .12s;}
.pow-feed .dashnotif-more:hover{border-color:var(--cyan);background:rgba(61,240,255,.08);}
.pow-feed .dashnotif-more:disabled{color:var(--dim);cursor:default;}
.pow-feed .dashactions{display:flex;flex-wrap:wrap;gap:12px;margin-top:20px;}
.pow-feed .dashbtn{display:inline-flex;align-items:center;justify-content:center;background:transparent;color:var(--neon);
  border:1px solid var(--neon);border-radius:9px;padding:10px 18px;font:inherit;font-size:13px;font-weight:700;
  letter-spacing:.05em;cursor:pointer;box-shadow:0 0 16px rgba(0,255,156,.14),inset 0 0 12px rgba(0,255,156,.05);
  transition:background .15s,color .15s,box-shadow .15s;white-space:nowrap;}
.pow-feed .dashbtn:hover{background:var(--neon);color:#04120c;box-shadow:0 0 26px rgba(0,255,156,.5);}
/* Muted until there are unsaved changes — the button "lights up" (neon glow
   above) only when the form is dirty, cueing the user to save. */
.pow-feed .dashbtn:disabled{color:var(--dim);border-color:var(--line);box-shadow:none;cursor:default;}
.pow-feed .dashbtn:disabled:hover{background:transparent;color:var(--dim);box-shadow:none;}
.pow-feed .dashbtn.sec{color:var(--cyan);border-color:var(--line);box-shadow:none;}
.pow-feed .dashbtn.sec:hover{background:transparent;color:var(--cyan);border-color:var(--cyan);box-shadow:0 0 14px rgba(61,240,255,.18);}
.pow-feed .dashsection-title{margin:0;font-size:14px;letter-spacing:.1em;text-transform:uppercase;color:var(--neon);
  text-shadow:0 0 8px rgba(0,255,156,.3);}
.pow-feed .dashsection-head{display:flex;align-items:center;justify-content:space-between;gap:12px;}
.pow-feed .dashlist{list-style:none;margin:16px 0 0;padding:0;display:flex;flex-direction:column;gap:10px;}
.pow-feed .dashpost{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:14px 16px;}
.pow-feed .dashpost-row{display:flex;flex-direction:column;gap:12px;}
@media(min-width:560px){.pow-feed .dashpost-row{flex-direction:row;align-items:flex-start;justify-content:space-between;}}
.pow-feed .dashpost-main{min-width:0;flex:1;}
.pow-feed .dashpost-titlerow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;}
.pow-feed .dashpost-title{font-size:15px;font-weight:700;color:var(--text);transition:color .15s,text-shadow .15s;}
.pow-feed a.dashpost-title:hover{color:var(--neon);text-shadow:0 0 10px rgba(0,255,156,.35);}
.pow-feed .dashdraft{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;
  padding:2px 9px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);}
.pow-feed .dashpost-meta{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:8px 0 0;font-size:12px;
  color:var(--dim);font-variant-numeric:tabular-nums;}
.pow-feed .dashpost-price{color:var(--text);font-weight:700;}
.pow-feed .dashpost-btns{display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex:none;}
.pow-feed .dashmini{display:inline-flex;align-items:center;gap:5px;background:transparent;border:1px solid var(--line);
  border-radius:8px;padding:6px 12px;font:inherit;font-size:12px;color:var(--text);cursor:pointer;white-space:nowrap;
  transition:border-color .15s,color .15s,box-shadow .15s;}
.pow-feed .dashmini:hover:not(:disabled){border-color:var(--cyan);color:var(--cyan);}
.pow-feed .dashmini:disabled{opacity:.5;cursor:not-allowed;}
.pow-feed .dashmini.warn{border-color:#7a5a12;color:#f0c04b;}
.pow-feed .dashmini.warn:hover:not(:disabled){border-color:#f0c04b;color:#f7d478;box-shadow:0 0 12px rgba(240,192,75,.2);}
.pow-feed .dashmini.danger{border-color:#6e2831;color:var(--no);}
.pow-feed .dashmini.danger:hover:not(:disabled){border-color:var(--no);color:#ff8892;box-shadow:0 0 12px rgba(255,92,108,.2);}
.pow-feed .dashpager{display:flex;align-items:center;gap:10px;margin-top:18px;border-top:1px solid var(--line);
  padding-top:14px;font-size:12px;color:var(--dim);font-variant-numeric:tabular-nums;}
.pow-feed .dashpager-side{flex:1;min-width:0;}
.pow-feed .dashpager-end{text-align:right;}
.pow-feed .dashpager-mid{flex:none;}
.pow-feed .dashlegacy-toggle{display:flex;width:100%;align-items:center;justify-content:space-between;gap:10px;
  background:none;border:none;color:var(--dim);font:inherit;font-size:12px;letter-spacing:.1em;text-transform:uppercase;
  cursor:pointer;padding:0;transition:color .15s;}
.pow-feed .dashlegacy-toggle:hover{color:var(--cyan);}

/* ---- states ---- */
.pow-feed .error{border:1px solid var(--no);border-radius:10px;background:rgba(255,92,108,.08);color:var(--no);
  padding:12px 16px;font-size:13px;margin:16px 0 0;}
.pow-feed .empty{border:1px dashed var(--line);border-radius:14px;padding:44px 24px;text-align:center;color:var(--dim);
  font-size:14px;margin-top:16px;}
.pow-feed .loadmore{text-align:center;margin-top:20px;}

/* ---- thread ---- */
/* X-style connected thread: an ancestor chain joined by a rail line down to the
   focused post. Each .tnode is [rail | body]; .lineup/.linedown draw the segment
   above/below the node's dot so adjacent nodes form one continuous line. */
.pow-feed .thread{margin:0;}
.pow-feed .tnode{position:relative;display:flex;gap:12px;padding:16px 4px;}
.pow-feed .trail{width:22px;flex:none;}
.pow-feed .tdot{position:absolute;top:20px;left:9px;width:12px;height:12px;border-radius:50%;background:var(--neon);
  box-shadow:0 0 8px rgba(0,255,156,.55);z-index:1;}
.pow-feed .tnode.lineup::before{content:"";position:absolute;left:14px;top:0;height:20px;width:2px;background:var(--line);}
.pow-feed .tnode.linedown::after{content:"";position:absolute;left:14px;top:32px;bottom:0;width:2px;background:var(--line);}
.pow-feed .tnode:hover .ttext{color:var(--text);}
.pow-feed .tbody{min-width:0;flex:1;}
.pow-feed .tmeta{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;}
.pow-feed .ttext{margin:6px 0 0;white-space:pre-wrap;word-break:break-word;font-size:15px;line-height:1.55;color:#c8efe1;
  display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;transition:color .15s;}
.pow-feed .ttext.expanded{display:block;-webkit-line-clamp:unset;overflow:visible;}
.pow-feed .tbody > .showmore{margin-top:4px;}
/* Focused post reads as "the post you're on": no rail indent (full width, content
   flush-left with the dot), and its dot sits inline at the head of the byline row
   rather than out in the rail gutter. */
.pow-feed .tnode.focused{padding-left:10px;}
/* A focused FORUM post reads as a post inside a community: a distinct card
   surface with a "Posted in /f/<slug>" tag, not a feed row. */
.pow-feed .tnode.focused.forumpost{padding:16px 18px;background:var(--panel);border:1px solid var(--line);
  border-radius:14px;margin-top:14px;}
/* The card is its own surface — the ancestor thread rail leads down TO it, but the
   connecting stub must not pierce the card's rounded border. */
.pow-feed .tnode.focused.forumpost.lineup::before{display:none;}
.pow-feed .forumpost-tag{display:inline-block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;
  color:var(--cyan);font-weight:700;margin:0 0 8px;}
.pow-feed .forumpost-tag:hover{text-decoration:underline;text-underline-offset:2px;}
.pow-feed .tnode.focused .tmeta{align-items:center;}
.pow-feed .tnode.focused .tdot{position:static;flex:none;width:11px;height:11px;
  background:var(--cyan);box-shadow:0 0 10px rgba(61,240,255,.6);}
.pow-feed .tnode.focused.lineup::before{left:14px;top:0;height:22px;}
/* A forum post opens like a Reddit thread: big title heading, then the body. */
.pow-feed .focustitle{margin:12px 0 0;font-size:26px;font-weight:800;line-height:1.25;color:var(--text);word-break:break-word;}
/* The forum title on an ANCESTOR node (a titled forum post shown above the
   focused reply) — smaller than the focused heading, but still bold. */
.pow-feed .tnode-title{margin:2px 0 0;font-size:16px;font-weight:700;line-height:1.3;color:var(--text);word-break:break-word;}
.pow-feed .focustitle + .focusbody{font-size:16px;}
.pow-feed .focusbody{margin:10px 0 0;white-space:pre-wrap;word-break:break-word;font-size:18px;line-height:1.6;color:var(--text);}
.pow-feed .onchain{font-size:12px;color:var(--dim);}
.pow-feed .onchain:hover{color:var(--cyan);}
.pow-feed .replieshead{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin:24px 0 10px;}
/* "N quotes" toggle — reveals the posts that quote this one. Reads like the
   replies head but is a button. */
.pow-feed .quotes-section{margin:20px 0 0;}
.pow-feed .quoteshead{background:none;border:none;cursor:pointer;font:inherit;font-size:12px;letter-spacing:.14em;
  text-transform:uppercase;color:var(--dim);padding:0;transition:color .15s;}
.pow-feed .quoteshead:hover{color:var(--cyan);}
.pow-feed .quotes-caret{font-size:9px;}
.pow-feed .quotes-section .posts{margin-top:10px;}

/* Forum thread comments — Reddit-style nested tree. Each comment is flat text
   (byline · time, full body, compact actions); children indent under a thread
   line so the whole discussion reads at once, not as feed-post cards. */
.pow-feed .fcomments{display:flex;flex-direction:column;}
.pow-feed .fcomment-main{padding:10px 0;border-top:1px solid var(--line);}
.pow-feed .fcomments > .fcomment:first-child > .fcomment-main{border-top:none;}
.pow-feed .fcomment-meta{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--dim);flex-wrap:wrap;}
.pow-feed .fcomment-meta .time{color:var(--dim);}
.pow-feed .fcomment-meta .onchain{font-size:12px;}
.pow-feed .fcomment-body{margin:5px 0 0;white-space:pre-wrap;word-break:break-word;font-size:14.5px;
  line-height:1.55;color:var(--text);}
/* Nested children: a thread line on the left + indent, so depth reads at a glance. */
.pow-feed .fcomment-children{margin-left:8px;padding-left:14px;border-left:2px solid var(--line);}
.pow-feed .fcomment-reply{margin-top:8px;}

@media (prefers-reduced-motion:reduce){.pow-feed *{transition:none!important;animation:none!important;}}
@media (max-width:480px){.pow-feed .head{padding-top:20px;}}

/* ---- Forums: directory (the Forums tab) + create form + a forum's header ----
   All colors go through the shared tokens (--panel/--line/--text/--dim/--neon/
   --cyan), so these theme automatically in both the terminal and paper lenses. */
.pow-feed .forumdir{display:flex;flex-direction:column;gap:14px;}
/* Two equal columns mirroring the Feed|Forums tabs above, so the copy sits under
   the Feed half (left) and the create button centers under the Forums half
   (right). margin-top drops the row off the tab underline for some breathing room. */
.pow-feed .forumdir-head{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:16px;margin-top:18px;}
.pow-feed .forumdir-sub{font-size:12.5px;line-height:1.5;color:var(--dim);margin:0;max-width:44ch;}
.pow-feed .forumdir-create{display:flex;justify-content:center;}
.pow-feed .forumlist{list-style:none;margin:0;padding:0;}
.pow-feed .forumrow{border-bottom:1px solid var(--line);}
.pow-feed .forumrow:last-child{border-bottom:none;}
.pow-feed .forumrow-link{display:block;padding:14px 16px;transition:background .12s;}
.pow-feed .forumrow-link:hover{background:var(--panel2);}
.pow-feed .forumrow-main{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;}
.pow-feed .forumrow-name{font-size:15px;font-weight:700;color:var(--neon);}
.pow-feed .forumrow-titletext{font-size:14px;color:var(--text);}
.pow-feed .forumrow-desc{font-size:12.5px;line-height:1.5;color:var(--dim);margin:5px 0 0;overflow-wrap:anywhere;}
.pow-feed .forumrow-meta{display:flex;gap:14px;font-size:11px;color:var(--dim);margin-top:8px;
  font-variant-numeric:tabular-nums;}
.pow-feed .forumrow-runner{color:var(--cyan);}

/* Create-forum panel */
.pow-feed .forumcreate{padding:18px 18px 16px;display:flex;flex-direction:column;gap:14px;}
.pow-feed .forumcreate-head{font-size:16px;font-weight:800;color:var(--text);margin:0;}
.pow-feed .forumcreate-sub{font-size:12px;line-height:1.55;color:var(--dim);margin:-6px 0 0;}
.pow-feed .forumcreate-field{display:flex;flex-direction:column;gap:6px;}
.pow-feed .forumcreate-label{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);}
.pow-feed .forumcreate-opt{text-transform:none;letter-spacing:0;opacity:.7;}
.pow-feed .forumcreate-input{width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:8px;
  padding:9px 11px;color:var(--text);font-family:inherit;font-size:14px;}
.pow-feed .forumcreate-input:focus{outline:none;border-color:var(--cyan);}
.pow-feed .forumcreate-slugwrap{display:flex;align-items:stretch;border:1px solid var(--line);border-radius:8px;
  overflow:hidden;background:var(--panel2);}
.pow-feed .forumcreate-slugwrap:focus-within{border-color:var(--cyan);}
.pow-feed .forumcreate-slugpre{display:flex;align-items:center;padding:0 4px 0 11px;color:var(--dim);font-size:14px;}
.pow-feed .forumcreate-slugwrap .forumcreate-input{border:none;border-radius:0;background:transparent;padding-left:2px;}
.pow-feed .forumcreate-hint{font-size:11px;color:var(--dim);}
.pow-feed .forumcreate-hint.over{color:var(--no);}
.pow-feed .forumcreate-bar{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:2px;}
/* The create-forum pay button: a normal flow-layout button (icon + label in a
   flex row, no absolute positioning), so a long "Create · 10,000 XEC" label
   never overflows/clips the way the compact .paybtn does. */
.pow-feed .forumcreate-pay{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 16px;
  background:transparent;border:1.5px solid var(--neon);border-radius:9px;cursor:pointer;
  color:var(--neon);font-family:inherit;font-size:12.5px;font-weight:700;letter-spacing:.02em;
  white-space:nowrap;box-shadow:0 0 14px rgba(0,255,156,.4);transition:box-shadow .25s,opacity .2s;}
.pow-feed .forumcreate-pay:hover:not(:disabled){box-shadow:0 0 22px rgba(0,255,156,.55);}
.pow-feed .forumcreate-pay:disabled{cursor:not-allowed;opacity:.5;border-color:var(--line);
  color:var(--dim);box-shadow:none;}
.pow-feed .forumcreate-pay-icon{display:inline-flex;align-items:center;line-height:1;}
html:not(.dark) .pow-feed .forumcreate-pay{box-shadow:0 0 0 1px var(--neon);}
html:not(.dark) .pow-feed .forumcreate-pay:hover:not(:disabled){box-shadow:0 0 0 1.5px var(--neon);}
html:not(.dark) .pow-feed .forumcreate-pay:disabled{box-shadow:none;}

/* A forum's header on /f/<slug> */
.pow-feed .forumhead{padding:0 4px 18px;border-bottom:1px solid var(--line);margin-bottom:16px;}
.pow-feed .forumhead-back{display:inline-block;font-size:11px;letter-spacing:.12em;text-transform:uppercase;
  color:var(--cyan);margin-bottom:12px;}
.pow-feed .forumhead-name{font-size:22px;font-weight:800;color:var(--neon);margin:0;}
.pow-feed .forumhead-title{font-size:15px;color:var(--text);margin:6px 0 0;}
.pow-feed .forumhead-desc{font-size:13px;line-height:1.55;color:var(--dim);margin:8px 0 0;overflow-wrap:anywhere;}
.pow-feed .forumhead-meta{display:flex;flex-wrap:wrap;gap:14px;font-size:11.5px;color:var(--dim);margin-top:12px;
  font-variant-numeric:tabular-nums;}
.pow-feed .forumhead-runner{color:var(--cyan);}
.pow-feed .forumhead-youtag{color:var(--neon);}

/* Forum controls row: New/Top sort tabs on the left, "Create Post" on the right.
   Rectangular buttons (small radius), not pills. */
.pow-feed .forumsort{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:14px 0;}
.pow-feed .forumsort-tabs{display:flex;gap:8px;}
.pow-feed .forumsort-tab{background:transparent;border:1px solid var(--line);border-radius:6px;
  padding:6px 15px;font-family:inherit;font-size:11px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--dim);cursor:pointer;transition:border-color .15s,color .15s;}
.pow-feed .forumsort-tab:hover{color:var(--text);}
.pow-feed .forumsort-tab.on{color:var(--neon);border-color:var(--neon);}
/* Create Post: rectangular, neon-outlined action; flips to a quiet "Close" when
   the composer is open. */
.pow-feed .forumsort-create{background:transparent;border:1px solid var(--neon);border-radius:6px;
  padding:6px 16px;font-family:inherit;font-size:11px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--neon);cursor:pointer;transition:border-color .15s,color .15s,box-shadow .15s;}
.pow-feed .forumsort-create:hover{box-shadow:0 0 12px rgba(0,255,156,.25);}
.pow-feed .forumsort-create.on{color:var(--dim);border-color:var(--line);box-shadow:none;}
html:not(.dark) .pow-feed .forumsort-create:hover{box-shadow:0 0 0 1px var(--neon);}

/* Forum post cards — Reddit-style discussion rows: a clamped body preview led by
   a loud engagement footer. The whole card opens the thread page. */
.pow-feed .forumcards{list-style:none;margin:0;padding:0;}
.pow-feed .forumcard-li{border-bottom:1px solid var(--line);}
.pow-feed .forumcard-li:last-child{border-bottom:none;}
.pow-feed .forumcard{display:block;padding:14px 16px;cursor:pointer;transition:background .12s;}
.pow-feed .forumcard:hover{background:var(--panel2);}
.pow-feed .forumcard:focus-visible{outline:2px solid var(--neon);outline-offset:-2px;}
.pow-feed .forumcard-meta{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--dim);}
.pow-feed .forumcard-meta .dot{color:var(--dim);}
.pow-feed .forumcard-meta .time{color:var(--dim);}
/* Reddit-style: the TITLE is the loud line, the body a muted preview beneath it. */
.pow-feed .forumcard-title{margin:6px 0 0;font-size:18px;font-weight:700;line-height:1.3;
  color:var(--text);word-break:break-word;}
/* Clamp the preview to a few lines; the full body lives on the thread page. */
.pow-feed .forumcard-body{margin:6px 0 0;font-size:14.5px;line-height:1.5;color:var(--text);
  overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;word-break:break-word;}
.pow-feed .forumcard-body.has-title{margin-top:4px;color:var(--dim);-webkit-line-clamp:2;}
/* Compact "has a video" chip on a forum card (the full player is on the post page). */
.pow-feed .forumcard-video{display:inline-flex;align-items:center;gap:4px;margin-top:8px;font-size:11.5px;
  font-weight:700;letter-spacing:.04em;color:var(--cyan);}

/* Embedded YouTube player (feed posts + top-level forum posts). Responsive 16:9. */
.pow-feed .ytembed{position:relative;margin:12px 0 0;width:100%;aspect-ratio:16/9;border-radius:12px;
  overflow:hidden;border:1px solid var(--line);background:#000;}
.pow-feed .ytembed iframe{position:absolute;inset:0;width:100%;height:100%;border:0;}
.pow-feed .forumcard-foot{display:flex;align-items:center;flex-wrap:wrap;gap:16px;margin-top:11px;
  font-size:12.5px;color:var(--dim);}
/* The comment count is the row's primary invitation — give it the accent. */
.pow-feed .forumcard-comments{color:var(--neon);font-weight:700;font-variant-numeric:tabular-nums;}
.pow-feed .forumcard-reactions{display:inline-flex;align-items:center;gap:10px;}
.pow-feed .forumcard-react{display:inline-flex;align-items:center;gap:3px;font-variant-numeric:tabular-nums;}
.pow-feed .forumcard-rep{font-variant-numeric:tabular-nums;}

/* =========================================================================
   PAPER (light mode) — dark mode is a terminal; light mode is the page.
   Not the neon sign at a different brightness: a different metaphor. The feed
   is driven by the ~9 vars at the top of .pow-feed, so paper re-derives those
   to a warm-manuscript palette (never #fff, never #000), then does three
   structural things the naive flip can't: (1) elevation now goes UP toward
   white — warm-paper page, near-white cards; (2) the neon green survives only
   as a small non-text fill (the live dot) — as TEXT it drops to a dark ink of
   the same hue so it clears contrast; (3) glow, the dark theme's whole
   emphasis mechanism, is killed wholesale and replaced by hairlines + weight +
   one very soft shadow. Applies whenever <html> is NOT .dark; the dark block
   above is the default and still wins under .dark.

   Paper token set (kept in sync across every scoped theme):
     bg #f6f4ed  panel #fdfcf8  panel2 #f1eee4  line #e3dfd2
     ink #1a1c17  dim #5e6155  accent #12703c  accent-hover #0d5a2f
     link/teal #0e6b74  danger #a3312f  live-dot #00c853
     paper-shadow 0 1px 2px rgba(26,28,23,.05)
   ======================================================================== */
html:not(.dark) .pow-feed{
  --bg:#f6f4ed; --panel:#fdfcf8; --panel2:#f1eee4; --line:#e3dfd2; --text:#1a1c17;
  --dim:#5e6155; --neon:#12703c; --cyan:#0e6b74; --no:#a3312f; --live:#00c853;
  --paper-shadow:0 1px 2px rgba(26,28,23,.05);
  --accent-hover:#0d5a2f; --accent-tint:#e7f0e7;
  background-color:var(--bg);
  background-image:none;
}
/* Glow is a dark-theme device. On paper it does nothing but muddy the ink, so
   kill every text-shadow in one stroke — emphasis is carried by weight + hue. */
html:not(.dark) .pow-feed *{text-shadow:none;}
/* body/secondary copy -> warm ink so it reads on paper (was light-teal) */
html:not(.dark) .pow-feed .sub{color:#4a4d42;}
html:not(.dark) .pow-feed .qbody,
html:not(.dark) .pow-feed .notifpage-body,
html:not(.dark) .pow-feed .artcard-teaser,
html:not(.dark) .pow-feed .artrow-teaser,
html:not(.dark) .pow-feed .profbio,
html:not(.dark) .pow-feed .dashbio,
html:not(.dark) .pow-feed .ttext{color:#3a3d33;}
/* @handle text in light mode: no neon glow, and MATTE the color — darken the
   swatch (carried on --hc) toward ink so it stays on-hue but reads crisply on
   white. Dark mode keeps the bright, glowing swatch. The plain var() is a fallback
   for browsers without color-mix. */
html:not(.dark) .pow-feed .byline,
html:not(.dark) .pow-feed .qbyline,
html:not(.dark) .pow-feed .profname{
  color:var(--hc,#008a55);
  color:color-mix(in oklab, var(--hc,#00b06e) 55%, #000);
  text-shadow:none;
}
/* Same paper darkening for the dashboard handle bylines (Welcome @X, the
   follower/following list) — the swatch on --hc would otherwise stay neon. */
html:not(.dark) .pow-feed .dashwelcome a{color:color-mix(in oklab, var(--hc,var(--cyan)) 58%, #000);}
html:not(.dark) .pow-feed .dashfollow{color:color-mix(in oklab, var(--hc,var(--text)) 62%, #000);}
/* …and the "Replying to @X" / "Reposted by @X" context handles (--hc swatch). */
html:not(.dark) .pow-feed .replyingto-who{color:color-mix(in oklab, var(--hc,var(--cyan)) 58%, #000);}
html:not(.dark) .pow-feed .repostedby-who{color:color-mix(in oklab, var(--hc,var(--dim)) 62%, #000);}
/* An ADDRESS profile name is teal (--cyan, already paper-readable), not a handle
   swatch: the general .profname paper rule above would fall back to a GREEN mix,
   so pin it to the plain teal here — matching the ecash: address bylines below
   it (higher specificity wins). */
html:not(.dark) .pow-feed .profname.isaddr{color:var(--cyan);}
html:not(.dark) .pow-feed .byline:hover{text-shadow:none;filter:brightness(.88);}
html:not(.dark) .pow-feed .compose textarea::placeholder{color:#a9a597;}
/* sticky topbar tint = translucent paper (dark default is set inline above) */
html:not(.dark) .pow-feed .topbar{background:rgba(246,244,237,.85);}

/* ---- desktop shell: 640px feed column + live activity rail ----
   Only pages that render .feed-cols/.feed-rail (the home feed) are affected;
   below 1100px the rail is gone and .feed-cols is a plain block, so phones
   and tablets render exactly the pre-shell page. */
.pow-feed .feed-rail{display:none;}
.pow-feed .feed-left{display:none;}
@media (min-width:1100px){
  .pow-feed.has-rail .topbar{max-width:1028px;}
  .pow-feed.has-rail .feed-cols{display:grid;grid-template-columns:minmax(0,640px) 330px;
    gap:18px;justify-content:center;padding:0 20px;}
  .pow-feed.has-rail .feed-cols .wrap{max-width:none;width:100%;margin:0;padding-left:0;padding-right:0;}
  .pow-feed .feed-rail{display:block;position:sticky;top:76px;align-self:start;
    max-height:calc(100dvh - 96px);overflow-y:auto;}
}
/* Wide desktop: the front page joins on the left. The rails are elastic rather
   than fixed so ONE tier covers every laptop instead of an all-or-nothing jump:
   at the 1280 floor they sit at their minimums (240 + 640 + 290 + gaps/padding
   = ~1237, which still clears a 1280 window carrying a classic Windows
   scrollbar), and they grow to the roomy 300/330 by ~1400. The center reading
   column never moves off 640 — it's the spine of the page, so the rails give
   up the width instead. */
@media (min-width:${WIDE_RAIL_MIN}px){
  .pow-feed.has-rail .topbar{max-width:1346px;}
  .pow-feed.has-rail .feed-cols{
    grid-template-columns:minmax(264px,315px) 640px minmax(264px,315px);
    gap:clamp(12px,1.2vw,18px);padding:0 clamp(12px,1.4vw,20px);}
  .pow-feed .feed-left{display:block;position:sticky;top:76px;align-self:start;
    max-height:calc(100dvh - 96px);overflow-y:auto;}
}
/* The rails scroll independently but never show a scrollbar — on systems set
   to "always show scrollbars" (macOS with a mouse plugged in), the default
   gray gutter would slice between the columns. Wheel/trackpad still scrolls. */
.pow-feed .feed-left,.pow-feed .feed-rail{scrollbar-width:none;}
.pow-feed .feed-left::-webkit-scrollbar,.pow-feed .feed-rail::-webkit-scrollbar{display:none;}

/* ---- the front page (left rail): newspaper structure, terminal skin.
   Type rule: serif = writing, mono = machinery, neon = money. Same 17px
   top margin arithmetic as .arail so all three column tops align — the
   sticky rail clamps to top:76px while .wrap's own natural (non-sticky)
   top sits at 65px, an 11px gap the wrap's paddingTop:28px doesn't share,
   so this margin needs to be 11px short of matching it (28-11=17), not
   equal to it. ---- */
.pow-feed .npaper{border:1px solid var(--line);border-radius:14px;background:var(--panel2);
  padding:16px 16px 12px;margin-top:17px;}
.pow-feed .np-serif{font-family:Georgia,'Iowan Old Style','Times New Roman',serif;}
.pow-feed .np-mast{border-bottom:1px solid var(--line);
  padding:0 0 7px;text-align:center;font-size:12px;letter-spacing:.24em;text-transform:uppercase;
  color:var(--neon);text-shadow:0 0 10px rgba(0,255,156,.3);}
.pow-feed .np-date{font-size:10px;color:var(--dim);text-align:center;margin:7px 0 0;
  padding-bottom:9px;border-bottom:1px solid var(--line);
  letter-spacing:.05em;text-transform:uppercase;font-variant-numeric:tabular-nums;}
.pow-feed .np-empty{color:var(--dim);font-size:12px;line-height:1.6;margin:16px 0;text-align:center;}
.pow-feed .np-kick{font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--neon);margin:0 0 6px;}
.pow-feed .np-meta{font-size:10.5px;color:var(--dim);line-height:1.5;display:flex;justify-content:space-between;align-items:baseline;gap:10px;}
.pow-feed .np-author{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pow-feed .np-price{color:var(--neon);white-space:nowrap;flex:none;}
.pow-feed .np-stat{white-space:nowrap;font-variant-numeric:tabular-nums;}
.pow-feed .np-sec{font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;color:var(--dim);
  border-bottom:1px solid var(--line);padding:16px 0 5px;}
/* Front-page lens filter: a bare <select> dressed as a section heading — same
   size/letter-spacing as the masthead ("THE FRONT PAGE"), stretched to fill the
   card's width (a <select> otherwise only sizes to its selected option's text,
   which is what left the empty gap on the right) — with a drawn ▾ caret that
   tints neon on hover. */
.pow-feed .np-filterbar{padding:12px 0 10px;border-bottom:1px solid var(--line);}
.pow-feed .np-filter{display:block;width:100%;box-sizing:border-box;
  appearance:none;-webkit-appearance:none;background-color:transparent;
  border:1px solid var(--line);border-radius:8px;color:var(--text);font:inherit;font-size:12px;
  font-weight:700;letter-spacing:.24em;text-transform:uppercase;padding:7px 26px 7px 11px;cursor:pointer;
  background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),
    linear-gradient(135deg,currentColor 50%,transparent 50%);
  background-position:calc(100% - 14px) center,calc(100% - 10px) center;
  background-size:4px 4px,4px 4px;background-repeat:no-repeat;
  transition:border-color .15s,color .15s,box-shadow .15s;}
.pow-feed .np-filter:hover{border-color:var(--neon);color:var(--neon);}
.pow-feed .np-filter:focus-visible{outline:none;border-color:var(--neon);box-shadow:0 0 0 1px var(--neon);}
.pow-feed .np-filter option{background:var(--panel,#0d1513);color:var(--text);
  text-transform:none;letter-spacing:normal;font-weight:400;}
/* The mast's wide .24em tracking doesn't fit the longer option labels ("MOST
   READ · THIS WEEK") in a narrow card — tighten it below the width where that
   starts clipping against the caret. */
@media (max-width:420px){
  .pow-feed .np-filter{font-size:11px;letter-spacing:.11em;padding-right:24px;}
}
/* the lead: a full newspaper hero — headline, meta beneath it, then a generous
   preview. The whole thing opens the story (no buttons); unlock lives inside. */
.pow-feed .np-lead{padding:13px 0 15px;border-bottom:1px solid var(--line);}
.pow-feed .np-lead-hl{display:block;}
/* Hero as rank #1 of the most-read list: a neon number, the big serif headline
   taking the middle, and its 7-day read count at the right — the same
   [rank] headline [reads] layout as the ranked rows below, sized up. */
.pow-feed .np-lead-hrow{display:flex;align-items:baseline;gap:12px;}
/* The #1's rank number matches the 2–7 rows' number (.np-rank-n), not the big
   lead title — so all the most-read numbers read as one consistent column. */
.pow-feed .np-lead-n{flex:none;min-width:13px;font-size:15px;font-weight:800;line-height:1.25;
  color:var(--neon);font-variant-numeric:tabular-nums;}
/* The #1 headline matches the 2–7 rows' headline (.np-rank-h) — same size and
   weight; only the teaser preview below sets the lead apart. hyphens:auto puts a
   real hyphen at a wrap in a long word; overflow-wrap:anywhere is the fallback
   that still fits an unbreakable token (e.g. a bare domain). */
.pow-feed .np-lead-h{flex:1;min-width:0;font-size:14.5px;line-height:1.3;color:var(--text);overflow-wrap:anywhere;hyphens:auto;}
.pow-feed .np-lead-c{flex:none;font-size:10.5px;color:var(--dim);font-variant-numeric:tabular-nums;white-space:nowrap;}
/* Byline: below the headline row (every lens, matching .np-rank-by), left-
   indented to align under the headline rather than the rank number. */
.pow-feed .np-lead-by{display:block;margin:4px 0 0 25px;font-size:10.5px;color:var(--dim);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pow-feed .np-lead-hl:hover .np-lead-h{text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px;}
.pow-feed .np-lead-teaser-link{display:block;margin-top:9px;}
.pow-feed .np-lead-teaser{font-size:12.5px;line-height:1.6;color:var(--dim);margin:0;
  display:-webkit-box;-webkit-line-clamp:7;-webkit-box-orient:vertical;overflow:hidden;}
.pow-feed .np-lead-teaser-link:hover .np-lead-teaser{color:var(--text);}
.pow-feed .np-lead.now .np-lead-h{color:var(--neon);}
/* More-stories rows: the whole row is a click-to-open link (headline + meta) */
.pow-feed .np-entry{display:block;padding:10px 0;border-bottom:1px solid rgba(23,58,51,.55);}
.pow-feed .np-entry-h{display:block;font-size:14.5px;line-height:1.3;color:var(--text);overflow-wrap:anywhere;hyphens:auto;}
.pow-feed .np-entry:hover .np-entry-h{text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px;}
.pow-feed .np-entry .np-meta{margin-top:3px;}
.pow-feed .np-foot{border-top:1px solid var(--line);margin-top:12px;padding-top:10px;
  font-size:10.5px;color:var(--dim);text-align:center;line-height:1.5;}
.pow-feed .np-foot a{color:var(--cyan);}
.pow-feed .np-foot a:hover{border-bottom:1px solid var(--cyan);}
/* the story currently being read (article page keeps this rail beside it) */
.pow-feed .np-now,.pow-feed .np-entry.now .np-entry-h,.pow-feed .np-rank.now .np-rank-h{color:var(--neon);}
/* Most-read ranked list. These were referenced but never styled, so the rank
   number, headline and read-count ran together ("1Announcing…56"). Lay each row
   out as [rank] headline [reads]: neon tabular rank, serif headline (via
   .np-serif) taking the middle, a dim read-count on the right. */
.pow-feed .np-rank{display:flex;align-items:baseline;gap:11px;padding:9px 0;
  border-bottom:1px solid var(--line);text-decoration:none;}
.pow-feed .np-rank:last-child{border-bottom:none;}
.pow-feed .np-rank-n{flex:none;min-width:13px;font-size:15px;font-weight:800;line-height:1.25;
  color:var(--neon);font-variant-numeric:tabular-nums;}
/* Wraps the headline (+ the byline, stacked beneath it) so the headline gets
   the row's full remaining width instead of sharing a line with a read
   count/byline off to the side. */
.pow-feed .np-rank-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}
.pow-feed .np-rank-h{font-size:14.5px;line-height:1.3;color:var(--text);overflow-wrap:anywhere;hyphens:auto;}
.pow-feed .np-rank:hover .np-rank-h{text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px;}
.pow-feed .np-rank-c{flex:none;font-size:10.5px;color:var(--dim);font-variant-numeric:tabular-nums;white-space:nowrap;}
/* Byline sits BELOW the headline (not beside it, every lens), so the
   headline itself spans the row's full width. */
.pow-feed .np-rank-by{font-size:10.5px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;}
/* Entry (Latest) headline link wraps a block; teaser + button row when expanded. */
.pow-feed .np-hl{display:block;text-decoration:none;}
.pow-feed .np-teaser{font-size:12.5px;line-height:1.6;color:var(--dim);margin:8px 0 0;}
.pow-feed .np-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}
/* first section header leads the widget — trim its top padding. */
.pow-feed .np-sec.np-first{padding-top:4px;}

/* ---- the front page, reflowed ABOVE the feed in the 1100–1279 gap band ----
   The left rail (.feed-left) only appears at ≥WIDE_RAIL_MIN and the mobile
   bottom bar's "Paper" tab only <1100, leaving a band where a narrow desktop
   window sees no front page at all. This compact copy fills exactly that band
   (hidden ≥WIDE_RAIL_MIN where the rail takes over, and <1100 where Paper
   does). Its matchMedia gate matches, so only one placement fetches. */
.pow-feed .feed-topstories{display:none;margin-bottom:16px;}
@media (min-width:1100px) and (max-width:${WIDE_RAIL_MIN - 1}px){
  .pow-feed .feed-topstories{display:block;}
}
.pow-feed .npaper-top{margin-top:0;}
/* "More stories" expander: a section header that toggles the rest of the list.
   Native <details> — no JS — with the disclosure marker replaced by a chevron. */
.pow-feed .np-more{margin-top:2px;}
.pow-feed .np-more-sum{display:flex;align-items:center;gap:6px;cursor:pointer;list-style:none;
  padding-top:12px;user-select:none;}
.pow-feed .np-more-sum::-webkit-details-marker{display:none;}
.pow-feed .np-more-n{color:var(--dim);}
.pow-feed .np-more-sum::after{content:'▾';margin-left:auto;font-size:11px;color:var(--dim);
  transition:transform .15s;}
.pow-feed .np-more[open] .np-more-sum::after{transform:rotate(180deg);}
.pow-feed .np-more-sum:hover{color:var(--text);}

/* shown only on mobile (the bottom-bar shell), hidden where the topbar
   hamburger still carries the same action */
@media (min-width:1100px){.pow-feed .dash-mobile-only{display:none;}}

/* author profile spread: the handle carousel lives in the CENTER column
   below the wide tier (unchanged mobile) and moves into the left rail on wide
   desktop, where it gets room + the make-an-offer link. Must fire at the SAME
   width the left rail appears at, or the carousel renders twice. */
@media (min-width:${WIDE_RAIL_MIN}px){
  .pow-feed.has-rail .prof-handles-center{display:none;}
}
.pow-feed .prof-handles-rail{margin-top:14px;}
.pow-feed .prof-offerlink{display:block;margin-top:8px;font-size:11px;color:var(--cyan);
  letter-spacing:.03em;border-bottom:1px solid transparent;width:fit-content;transition:border-color .15s;}
.pow-feed .prof-offerlink:hover{border-color:var(--cyan);}

/* ---- dashboard desktop: fill the screen. The dashboard is chrome, not a
   reading column — wide rows scan fine, and the stat cards spread into one
   band. Phones keep the standard 640px stack. ---- */
@media (min-width:1100px){
  .pow-feed.dash-wide .topbar{max-width:1320px;}
  .pow-feed.dash-wide .wrap{max-width:1320px;}
  .pow-feed.dash-wide .dashstats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));flex-direction:unset;}
}

/* follower/following stat cards double as toggles for the account lists */
.pow-feed .dashstat-btn{cursor:pointer;text-align:left;font-family:inherit;width:100%;
  transition:border-color .15s,box-shadow .15s;}
.pow-feed .dashstat-btn:hover{border-color:var(--neon);}
.pow-feed .dashstat-btn.on{border-color:var(--neon);box-shadow:0 0 14px rgba(0,255,156,.18);}
.pow-feed .dashstat-btn .dashstat-label,.pow-feed .dashstat-btn .dashstat-value{display:block;}
.pow-feed .dashstat-btn .dashstat-value{margin-top:6px;}
.pow-feed .dashfollows{margin-top:12px;border:1px solid var(--line);border-radius:12px;
  background:var(--panel2);padding:14px 16px;}
.pow-feed .dashfollows-title{margin:0 0 9px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--dim);}
.pow-feed .dashfollows-empty{margin:4px 0 0;font-size:13px;color:var(--dim);line-height:1.5;}
.pow-feed .dashfollows-list{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:8px 18px;}
.pow-feed .dashfollow{font-size:13.5px;font-weight:700;color:var(--hc,var(--text));word-break:break-all;}
.pow-feed a.dashfollow:hover{color:var(--neon);text-shadow:0 0 8px rgba(0,255,156,.35);}

/* ---- the reading pane: a front-page story open in the feed's center column.
   Article typography rides in a neutralized .pow-article scope host. ---- */
.pow-feed .hr-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 20px;}
.pow-feed .hr-actions{display:flex;align-items:center;flex-wrap:wrap;gap:14px;justify-content:flex-end;}
.pow-feed .hr-back{background:transparent;border:1px solid var(--line);color:var(--cyan);border-radius:9px;
  padding:9px 16px;font:inherit;font-size:12px;letter-spacing:.06em;cursor:pointer;
  transition:border-color .15s,box-shadow .15s;}
.pow-feed .hr-back:hover{border-color:var(--cyan);box-shadow:0 0 14px rgba(61,240,255,.2);}
.pow-feed .hr-open{font-size:11.5px;color:var(--dim);border-bottom:1px solid transparent;transition:color .15s,border-color .15s;
  background:none;border-top:none;border-left:none;border-right:none;font-family:inherit;cursor:pointer;padding:0;}
.pow-feed .hr-open:hover{color:var(--cyan);border-bottom-color:var(--cyan);}
.pow-feed .hr-open.copied{color:var(--neon);border-bottom-color:transparent;}
.pow-feed .hr-state{color:var(--dim);font-size:13px;margin:48px 0;text-align:center;}
.pow-feed .readerhost.pow-article{width:auto;margin:0;min-height:0;background:none;padding:0;}
.pow-feed .hr-title{font-size:30px;line-height:1.22;color:var(--text);margin:4px 0 10px;font-weight:700;}
.pow-feed .hr-meta{font-size:11.5px;color:var(--dim);margin:0 0 24px;}
.pow-feed .hr-author{font-weight:700;color:var(--hc);}
.pow-feed a.hr-author:hover{text-decoration:underline;text-underline-offset:2px;}
.pow-feed .hr-jump{background:none;border:none;padding:0;margin:0;font:inherit;color:inherit;
  cursor:pointer;text-decoration:underline;text-underline-offset:2px;transition:color .15s;}
.pow-feed .hr-jump:hover{color:var(--cyan);}
/* Paper: darken the account's neon handle swatch (carried on --hc) toward ink
   on the same hue; no --hc (address byline) inherits the meta color. */
html:not(.dark) .pow-feed .hr-author{color:color-mix(in oklab, var(--hc) 58%, #000);}
.pow-feed .hr-paywall{border:1px solid var(--line);border-radius:12px;padding:20px 16px;margin-top:26px;text-align:center;}
.pow-feed .hr-lockline{font-size:12.5px;color:var(--dim);margin:0 0 12px;}
.pow-feed .hr-unlock{display:inline-block;border:1px solid var(--neon);color:var(--neon);border-radius:9px;
  padding:11px 24px;font-size:13px;font-weight:700;letter-spacing:.05em;background:transparent;
  font-family:inherit;cursor:pointer;
  transition:background .15s,color .15s,box-shadow .15s;}
.pow-feed .hr-unlock:hover{background:var(--neon);color:#04120c;box-shadow:0 0 22px rgba(0,255,156,.4);}
.pow-feed .hr-note{font-size:10.5px;color:var(--dim);margin:11px 0 0;line-height:1.5;}
/* comments inside the reading pane (entitled readers only) */
.pow-feed .hr-comments{border-top:1px solid var(--line);margin-top:30px;padding-top:18px;text-align:left;}
.pow-feed .hr-comments-title{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--neon);margin:0;}
.pow-feed .hr-comments-count{font-size:11px;color:var(--dim);margin:6px 0 14px;}
.pow-feed .hr-comment{border:1px solid var(--line);border-radius:10px;background:var(--panel2);
  padding:10px 13px;margin:0 0 10px;}
.pow-feed .hr-comment-meta{font-size:10.5px;color:var(--dim);margin:0 0 5px;}
.pow-feed .hr-comment-who{color:var(--cyan);}
.pow-feed .hr-comment-body{font-size:13px;line-height:1.6;color:var(--text);margin:0;white-space:pre-wrap;word-break:break-word;}
.pow-feed .hr-commentform{margin-top:14px;}
.pow-feed .hr-commentarea{width:100%;box-sizing:border-box;background:var(--panel);border:1px solid var(--line);
  border-radius:10px;padding:11px 13px;color:var(--text);font:inherit;font-size:13px;line-height:1.55;
  outline:none;resize:vertical;}
.pow-feed .hr-commentarea:focus{border-color:var(--cyan);}
.pow-feed .hr-commentarea::placeholder{color:#37655a;}
.pow-feed .hr-commentrow{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px;}
.pow-feed .hr-commentcount{font-size:10.5px;color:var(--dim);font-variant-numeric:tabular-nums;}
.pow-feed .hr-commentbtn{background:transparent;border:1px solid var(--cyan);color:var(--cyan);border-radius:8px;
  padding:9px 18px;font:inherit;font-size:12px;font-weight:700;letter-spacing:.04em;cursor:pointer;
  transition:background .15s,color .15s;}
.pow-feed .hr-commentbtn:hover{background:var(--cyan);color:#04120c;}
.pow-feed .hr-commentbtn:disabled{border-color:var(--line);color:var(--dim);background:none;cursor:default;}
.pow-feed .hr-commenterr{font-size:11.5px;color:var(--no);margin:8px 0 0;}
html:not(.dark) .pow-feed .hr-commentarea::placeholder{color:#8fb3a6;}
.pow-feed .hr-watching{font-size:13px;color:var(--cyan);margin:2px 0 0;animation:arail-pulse 1.4s ease-in-out infinite;}
.pow-feed .hr-cancelwait{background:none;border:none;font:inherit;font-size:10.5px;color:var(--dim);
  cursor:pointer;margin-top:10px;border-bottom:1px solid transparent;padding:0;}
.pow-feed .hr-cancelwait:hover{color:var(--no);border-color:var(--no);}
html:not(.dark) .pow-feed .np-entry{border-bottom-color:rgba(191,230,213,.85);}
html:not(.dark) .pow-feed .np-mast{text-shadow:none;}

/* the ticker card. margin-top is 17px, not the column's 28px, on purpose:
   the sticky rail clamps to top:76px, 11px past .wrap's own natural
   (non-sticky) top of 65px under the topbar — so this margin has to be
   11px short of the wrap's paddingTop:28px (28-11=17) for 76+17 to land on
   the same 93px as the compose card (65+28), not equal to it. Re-measure
   both numbers (getBoundingClientRect on .feed-rail and .wrap) if the
   topbar's height ever changes — they silently drifted 4px out of sync
   once already. */
.pow-feed .arail{border:1px solid var(--line);border-radius:14px;background:var(--panel2);
  padding:16px 16px 8px;margin-top:17px;}
.pow-feed .arail-head{display:flex;align-items:center;gap:9px;font-size:12px;letter-spacing:.22em;
  text-transform:uppercase;color:var(--neon);text-shadow:0 0 10px rgba(0,255,156,.35);}
.pow-feed .arail-dot{width:7px;height:7px;border-radius:50%;background:var(--neon);
  box-shadow:0 0 10px rgba(0,255,156,.8);animation:arail-pulse 2.2s ease-in-out infinite;}
@keyframes arail-pulse{50%{opacity:.35;}}
/* Live presence count: just a number at the header's trailing edge. Inherits
   the head's font/size/color/glow in BOTH modes so it reads as the same type
   as "LIVE ON ECASH"; only the tracking is reset so lone digits sit snug. */
.pow-feed .arail-online{margin-left:auto;letter-spacing:normal;font-variant-numeric:tabular-nums;}
.pow-feed .arail-sub{margin:9px 0 4px;font-size:11px;color:var(--dim);line-height:1.55;}
.pow-feed .arail-empty{color:var(--dim);font-size:12.5px;margin:14px 0;line-height:1.55;}
.pow-feed .arail-list{list-style:none;margin:6px 0 0;padding:0;}
.pow-feed .arow{padding:10px 2px;border-top:1px solid rgba(23,58,51,.55);}
.pow-feed .arail-list .arow:first-child{border-top:none;}
.pow-feed .arow.fresh{animation:arow-in 1.1s ease;}
@keyframes arow-in{0%{background:rgba(0,255,156,.16);}100%{background:transparent;}}
.pow-feed .arow-main{display:block;font-size:12.5px;line-height:1.5;color:var(--text);word-break:break-word;}
.pow-feed .arow-say{color:inherit;}
/* Tints with the actor's chosen handle color (--hc) when set inline; otherwise
   inherits the row's text color, so address/placeholder bylines read unchanged. */
.pow-feed .arow-actor{color:var(--hc,inherit);font-weight:700;transition:color .15s;}
/* The byline is its own link to the actor's profile; light it up on hover so
   it reads as tappable, distinct from the rest of the row (which opens the
   thread/article). A colored handle keeps ITS color on hover (--hc wins) instead
   of flipping to neon; the static <strong> variant stays plain. */
.pow-feed .arow-actor-link:hover{color:var(--hc,var(--neon));text-shadow:0 0 8px rgba(0,255,156,.4);}
html:not(.dark) .pow-feed .arow-actor-link:hover{color:var(--hc,var(--accent-hover));text-shadow:none;}
.pow-feed .arow-target{color:#a6d8c9;}
.pow-feed .arow-meta{display:flex;align-items:center;gap:10px;margin-top:3px;font-size:11px;
  color:var(--dim);font-variant-numeric:tabular-nums;}
.pow-feed .arow-amt{color:var(--neon);font-weight:700;}
.pow-feed .arow-tx{margin-left:auto;color:var(--dim);border-bottom:1px solid transparent;transition:color .15s,border-color .15s;}
.pow-feed .arow-tx:hover{color:var(--cyan);border-color:var(--cyan);}
html:not(.dark) .pow-feed .arow-target{color:#4a4d42;}
html:not(.dark) .pow-feed .arow{border-top-color:var(--line);}
html:not(.dark) .pow-feed .arow.fresh{animation-name:arow-in-light;}
@keyframes arow-in-light{0%{background:var(--accent-tint);}100%{background:transparent;}}

/* -------------------------------------------------------------------------
   PAPER structural overrides. The dark theme leans on neon box-shadow halos
   for elevation and on neon-green for every emphasis; on paper we swap the
   halos for one soft shadow + hairlines, and demote green from "glowing text"
   to "solid accent fill." Grouped by mechanism so it stays legible.
   ------------------------------------------------------------------------- */
/* Elevation: cards sit ABOVE the page with a whisper of shadow, not a glow. */
html:not(.dark) .pow-feed .panel,
html:not(.dark) .pow-feed .dashpanel{box-shadow:var(--paper-shadow);}

/* Primary buttons: filled ink-green with paper text (was outline + neon glow). */
html:not(.dark) .pow-feed .btn,
html:not(.dark) .pow-feed .dashbtn,
html:not(.dark) .pow-feed .hr-unlock,
html:not(.dark) .pow-feed .np-btn.unlock,
html:not(.dark) .pow-feed .tipgo{
  background:var(--neon);color:#fdfcf8;border-color:var(--neon);
  box-shadow:var(--paper-shadow);}
html:not(.dark) .pow-feed .btn:hover:not(:disabled),
html:not(.dark) .pow-feed .dashbtn:hover:not(:disabled),
html:not(.dark) .pow-feed .hr-unlock:hover,
html:not(.dark) .pow-feed .np-btn.unlock:hover,
html:not(.dark) .pow-feed .tipgo:hover{
  background:var(--accent-hover);color:#fdfcf8;box-shadow:var(--paper-shadow);}
html:not(.dark) .pow-feed .btn:disabled,
html:not(.dark) .pow-feed .dashbtn:disabled{
  background:transparent;color:var(--dim);border-color:var(--line);box-shadow:none;}
/* Pay button on paper: an ink-green ring, no glow (paper kills glow/light-as-
   motion — same trade every other lit-up control on this theme makes). */
html:not(.dark) .pow-feed .paybtn-amt{color:var(--neon);}
html:not(.dark) .pow-feed .paybtn.active:not(:disabled){border-color:var(--neon);box-shadow:0 0 0 1px var(--neon);}
html:not(.dark) .pow-feed .paybtn.active:hover:not(:disabled){box-shadow:0 0 0 1.5px var(--neon);}
/* Secondary/ghost dashbtn stays an outline, not a fill. */
html:not(.dark) .pow-feed .dashbtn.sec{background:transparent;color:var(--neon);border-color:var(--border-strong,#cfc9b8);}
html:not(.dark) .pow-feed .dashbtn.sec:hover{background:var(--accent-tint);color:var(--accent-hover);border-color:var(--neon);box-shadow:none;}
/* New-posts button on paper: rectangular ink-green outline, hairline on hover —
   matches the forum New/Top/Create buttons. */
html:not(.dark) .pow-feed .newposts-pill:hover:not(:disabled){box-shadow:0 0 0 1px var(--neon);}

/* Article link card: a hairline card that warms on hover — no neon border/glow. */
html:not(.dark) .pow-feed .artcard{border-color:var(--line);background:var(--panel);box-shadow:var(--paper-shadow);}
html:not(.dark) .pow-feed .artcard:hover{border-color:var(--neon);background:var(--accent-tint);box-shadow:var(--paper-shadow);}
/* Paper's take on the orbit: a pen tracing the margin, not a light. Glow is a
   dark-theme device, so instead of a blooming comet this is a crisp saturated
   ink bead (bright --live green head → ink-green tail, no drop-shadow) drawing
   itself around the border — the "ignite via saturation, not glow" swap the
   AnimatedLogo makes. Slower than the dark comet (6s) so it reads as a calm
   pen stroke fitting the manuscript theme, not a racing light. Re-enables the
   ::before the base rule set up (content/mask/inset all inherit); only the
   paint (background), the bloom (filter:none), and the pace change here. */
html:not(.dark) .pow-feed .artcard::before{content:"";display:block;filter:none;
  background:conic-gradient(from var(--artcard-angle),transparent 0deg,transparent 34deg,var(--live) 58deg,var(--neon) 67deg,transparent 79deg,transparent 360deg);
  animation-duration:6s;}
/* Paper reduced-motion: the base @media rule above is out-specificity'd by the
   html:not(.dark) paper selector, so it needs its own paper-scoped kill. */
@media (prefers-reduced-motion:reduce){
  html:not(.dark) .pow-feed .artcard::before{animation:none;display:none;}
}

/* The neon green survives ONLY as a small solid fill: the live/thread dots. */
html:not(.dark) .pow-feed .tdot,
html:not(.dark) .pow-feed .arail-dot{background:var(--live);box-shadow:none;}
html:not(.dark) .pow-feed .tnode.focused .tdot{background:var(--cyan);box-shadow:none;}

/* Count badges: solid danger chip with paper text, no glow. */
html:not(.dark) .pow-feed .notifbadge,
html:not(.dark) .pow-feed .dashbadge{background:var(--no);color:#fdfcf8;box-shadow:none;}
/* Pinned agent row on paper: ink-green on a soft green tint, glow killed. */
html:not(.dark) .pow-feed .notif-agent{background:var(--accent-tint,#e7f0e7);}
html:not(.dark) .pow-feed .notif-agent:hover{background:#dce9dc;}
html:not(.dark) .pow-feed .notif-agent-dot{box-shadow:none;}

/* Floating menus / popovers: a soft ink shadow, not the dark theme's rgba(0,0,0,.5). */
html:not(.dark) .pow-feed .hammenu,
html:not(.dark) .pow-feed .menupop,
html:not(.dark) .pow-feed .tipmenu,
html:not(.dark) .pow-feed .mentionsuggest{box-shadow:0 8px 24px rgba(26,28,23,.12);}
html:not(.dark) .pow-feed .mentionsuggest-item.active,
html:not(.dark) .pow-feed .mentionsuggest-item:hover{background:var(--accent-tint);}

/* Green/white hover washes -> a soft warm accent tint so they read on paper. */
html:not(.dark) .pow-feed .hammenu-item:hover,
html:not(.dark) .pow-feed .notifpage-row:hover,
html:not(.dark) .pow-feed .notifpage-row.unread,
html:not(.dark) .pow-feed .notifmore:hover,
html:not(.dark) .pow-feed .dashnotif-more:hover,
html:not(.dark) .pow-feed .tippreset:hover{background:var(--accent-tint);}
html:not(.dark) .pow-feed .notifpage-row.unread:hover{background:#dce8dc;}
html:not(.dark) .pow-feed .menubtn:hover{background:rgba(26,28,23,.06);}
html:not(.dark) .pow-feed .postcopy:hover{background:rgba(26,28,23,.06);}

/* Inset fields / recessed surfaces read as a slightly darker paper, not teal. */
html:not(.dark) .pow-feed .manualrow input,
html:not(.dark) .pow-feed .tipfield{background:var(--panel2);}
html:not(.dark) .pow-feed .compose textarea::placeholder,
html:not(.dark) .pow-feed .hr-commentarea::placeholder{color:#a9a597;}

/* QR plate: keep it a clean near-white card, drop the neon ring for a hairline. */
html:not(.dark) .pow-feed .qr{background:#fff;box-shadow:0 0 0 1px var(--line),var(--paper-shadow);}

/* Warm the last teal-tinted hairlines that were set explicitly for daylight. */
html:not(.dark) .pow-feed .np-entry{border-bottom-color:var(--line);}

/* ===========================================================================
   MOBILE EDGE-TO-EDGE FEED (≤600px)
   Post LISTS and the tabs break OUT of the column's 20px side inset to the
   screen edges, and the list sheds its card bubble (border / radius / glow /
   panel fill) — leaving only the full-width hairline between posts. Everything
   else in the column keeps its padding. The always-open composer is hidden here;
   a floating pen-nib button (.feed-fab) opens it as a bottom sheet instead, so a
   visitor lands straight in the feed and sees more of it.
   =========================================================================== */
@media (max-width:600px){
  .pow-feed .tabs,
  .pow-feed .panel.posts,
  .pow-feed .panel.forumlist{ margin-left:-20px; margin-right:-20px; }
  .pow-feed .panel.posts,
  .pow-feed .panel.forumlist{
    border-left:0; border-right:0; border-top:0; border-radius:0; box-shadow:none; background:transparent;
  }
  /* Tuck the list up under the tabs divider: drop the 16px gap (and the list's own
     top hairline, above) so the tabs' bottom line IS the line above the first
     post — no floating second separator below the tabs. */
  .pow-feed .panel.posts{ margin-top:0; }
  .pow-feed .feed-compose-inline{ display:none; }
  /* Forums: drop the "Topic communities" header + inline Create button so the
     forum list starts right under the tabs — same as the feed's posts do — and
     creating a forum moves to the floating pen-nib button. */
  .pow-feed .forumdir-head{ display:none; }
  /* No banner on a phone (the top-stories rail is hidden < 1100px), so the tabs
     ride right under the sticky topbar. Zero the gap so the space ABOVE the tab
     labels equals the space below them (the buttons' own 12px padding) — the
     Feed/Forums labels sit visually centered in their strip. */
  .pow-feed .feed-main{ padding-top:0; }
  /* Freeze the Feed/Forums strip: it sticks right under the topbar so you can
     always toggle. --topbar-h is measured live (FeedClient) = the topbar's exact
     rendered height, so the strip's resting and stuck positions match EXACTLY —
     no 1px shift in the space above the labels when it pins. Opaque --bg so posts
     scroll cleanly beneath the full-width strip. */
  .pow-feed .feed-main .tabs{
    margin-top:0; position:sticky; top:var(--topbar-h, 55px); z-index:40; background:var(--bg);
  }
}

/* Floating compose button — mobile only, cleared above the fixed bottom nav
   (~62px). The pen-nib is the POWR mark; it themes via tokens (--bg ink on the
   --neon disc, --neon accent cut) so it flips with light/dark automatically. */
.pow-feed .feed-fab{ display:none; }
@media (max-width:600px){
  .pow-feed .feed-fab{
    display:flex; position:fixed; right:16px;
    bottom:calc(62px + env(safe-area-inset-bottom) + 16px);
    width:56px; height:56px; border-radius:50%; background:var(--neon); border:none;
    align-items:center; justify-content:center; cursor:pointer; z-index:70;
    box-shadow:0 4px 16px rgba(0,0,0,.35);
  }
}
.pow-feed .feed-fab svg{ width:30px; height:30px; }
.pow-feed .feed-fab .pnib{ fill:var(--bg); stroke:var(--bg); stroke-width:1.2; stroke-linejoin:round; }
.pow-feed .feed-fab .pcut{ stroke:var(--neon); stroke-width:1.4; }

/* Compose bottom-sheet (opened by the FAB): a backdrop with a panel that holds
   the same ComposeBox the top of the feed used to. */
.pow-feed .feed-sheet-backdrop{ position:fixed; inset:0; z-index:90; background:rgba(0,0,0,.5);
  display:flex; align-items:flex-end; }
.pow-feed .feed-sheet{ width:100%; background:var(--bg); border-top:1px solid var(--line);
  border-radius:16px 16px 0 0; max-height:88vh; overflow:auto;
  padding:8px 16px calc(16px + env(safe-area-inset-bottom)); }
.pow-feed .feed-sheet-head{ display:flex; justify-content:flex-end; padding:2px 0; }
.pow-feed .feed-sheet-close{ background:none; border:none; color:var(--dim); cursor:pointer;
  font-size:20px; line-height:1; padding:4px 6px; }
.pow-feed .feed-sheet-close:hover{ color:var(--text); }
`
