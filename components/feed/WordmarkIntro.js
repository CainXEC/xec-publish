'use client'

// =============================================================================
//  WordmarkIntro — a one-shot ~2.5s "title shot" entrance for the topbar
//  wordmark, then dead-still at the exact static styling. Three variants
//  (pick with the `variant` prop; eyeball them side-by-side at /dev/wordmark):
//
//  - "unredact" (default): THE UNREDACTION. Cold open on a censor bar where
//    the name should be; a 2px cyan decrypt head ignites at its left edge and
//    makes ONE confident S-curve sweep across, consuming the redaction; the
//    letters emerge fully formed but hot-white in its wake, then the whole
//    word cools into the resting neon. The product performed: locked text,
//    one authorization, declassified.
//  - "declassified": the louder sibling — a bordered censor strip gets sliced
//    and torn off by a cyan blade, letters flash white-hot in a moving band
//    hugging the blade, afterglow cools.
//  - "strike": a dead neon sign in a dark basement stirs (cyan gas crawl),
//    strikes twice, catches — except the I of WRITING, which sputters and
//    commits last, completing the circuit and blooming the whole sign.
//
//  Engineering contract (shared by all variants):
//  - Everything is CSS keyframes with fill-mode holds — no rAF, so hidden
//    tabs can't strand a half-played intro; the final frame is guaranteed.
//  - Overlays are SSR'd, so frame zero IS the cold open (and it masks font
//    swap); the base text is the real name from the first byte for crawlers.
//  - The base text's color/opacity/shadow are NEVER animated ("unredact"
//    clips it, "strike" hides it under the sign) — when the overlays unmount
//    on animationend (4s timeout fallback), steady state is byte-identical
//    to the static wordmark. No cut, because there's nothing to cut to.
//  - Plays once per page load (module flag, set on COMPLETION so dev
//    StrictMode's double-mount still plays); topbar remounts on client-side
//    nav render nothing extra. Desktop-only + reduced-motion gates live in
//    the CSS media query so they hold pre-hydration.
//  - The ghost span pins the box width; nothing can shift the nav.
//  - `force` (the /dev/wordmark bench) bypasses the once-per-load gate.
// =============================================================================

import { useEffect, useRef, useState } from 'react'

const TARGET = 'proofofwriting'

// Reset by a real page load, survives client-side nav remounts.
let playedThisLoad = false

// The longest-running animation of each variant — its animationend is the
// whole shot's curtain call and triggers teardown.
const FINAL_ANIM = { unredact: 'wi-cool', declassified: 'pw-cool', strike: 'wi-trkC' }

export default function WordmarkIntro({ text = TARGET, variant = 'unredact', force = false }) {
  // Server + first client render agree: a fresh load plays, a nav remount
  // doesn't. The initializer runs before any effect, so SSR markup includes
  // the overlays and the cold open is on screen at first paint.
  const [play, setPlay] = useState(() => force || !playedThisLoad)
  const doneRef = useRef(false)

  const finish = () => {
    if (doneRef.current) return
    doneRef.current = true
    if (!force) playedThisLoad = true
    setPlay(false)
  }

  useEffect(() => {
    if (!play) return
    // Fallback curtain: mobile/reduced-motion never fire animationend
    // (overlays are display:none), and background tabs may defer it.
    const tm = setTimeout(finish, 4000)
    return () => clearTimeout(tm)
  }, [play])

  const onAnimationEnd = (e) => {
    if (e.animationName === FINAL_ANIM[variant]) finish()
  }

  // The stubborn letter in "strike" — the writer's I commits last.
  const stubborn = text.lastIndexOf('i') !== -1 ? text.lastIndexOf('i') : text.length - 1

  return (
    <span
      className={`wm-intro${play && variant === 'strike' ? ' wi-strike-on' : ''}`}
      aria-label={text}
      onAnimationEnd={play ? onAnimationEnd : undefined}
    >
      <span className="wm-ghost" aria-hidden="true">
        {text}
      </span>
      <span className={play && variant === 'unredact' ? 'wm-base wi-unredact-base' : 'wm-base'}>
        {text}
      </span>

      {play && variant === 'unredact' && (
        <>
          <span className="wi-hot" aria-hidden="true">
            {text}
          </span>
          <span className="wi-bar" aria-hidden="true" />
          <span className="wi-scanwrap" aria-hidden="true">
            <span className="wi-scan" />
          </span>
        </>
      )}

      {play && variant === 'declassified' && (
        <>
          <span className="pw-bloom" aria-hidden="true">
            {text}
          </span>
          <span className="pw-hot" aria-hidden="true">
            {text}
          </span>
          <span className="pw-strip" aria-hidden="true" />
          <span className="pw-bladewrap" aria-hidden="true">
            <span className="pw-blade" />
          </span>
        </>
      )}

      {play && variant === 'strike' && (
        <span className="wi-neon" aria-hidden="true">
          {text.split('').map((ch, i) => (
            <span key={i} className={i === stubborn ? 'wi-tC' : 'wi-tA'}>
              {ch}
            </span>
          ))}
          <span className="wi-streakwrap">
            <span className="wi-streak" />
          </span>
        </span>
      )}

      {play && <style>{INTRO_CSS}</style>}
    </span>
  )
}

// All play-state styling. Everything lives inside the desktop +
// no-reduced-motion media query; outside it the overlays are display:none and
// the base text stands alone — the gates hold before hydration, no JS needed.
// Structural styles (.wm-intro/.wm-ghost/.wm-base) live in feedTheme.js.
const INTRO_CSS = `
.wm-intro .wi-hot,.wm-intro .wi-bar,.wm-intro .wi-scanwrap,
.wm-intro .pw-bloom,.wm-intro .pw-hot,.wm-intro .pw-strip,.wm-intro .pw-bladewrap,
.wm-intro .wi-neon{display:none;}

@media (min-width:1100px) and (prefers-reduced-motion: no-preference){

/* ---- unredact: one-pass decrypt sweep --------------------------------- */
/* One timeline, one bezier: base clip, bar consumption, and the sweeping
   head all share duration/delay/easing against the same box, so their edges
   are pixel-locked every frame. */
.wm-intro .wi-unredact-base{
  animation:wi-unredact 1400ms cubic-bezier(.7,.02,.24,1) 410ms both;
  z-index:1;
}
.wm-intro .wi-hot{
  display:block;position:absolute;left:0;top:0;white-space:nowrap;z-index:2;
  color:#dffff2;text-shadow:0 0 6px rgba(190,255,225,.9),0 0 14px rgba(0,255,156,.55);
  animation:wi-unredact 1400ms cubic-bezier(.7,.02,.24,1) 410ms both,
            wi-cool 420ms ease-out 1830ms forwards;
}
.wm-intro .wi-bar{
  display:block;position:absolute;left:-2px;right:calc(.17em - 2px);top:-2px;bottom:-2px;z-index:3;
  background:#101d18;
  border-top:1px solid rgba(0,255,156,.65);border-bottom:1px solid rgba(0,255,156,.65);
  animation:wi-consume 1400ms cubic-bezier(.7,.02,.24,1) 410ms both;
}
.wm-intro .wi-scanwrap{
  display:block;position:absolute;left:-2px;right:calc(.17em - 2px);top:-2px;bottom:-2px;z-index:4;
  animation:wi-sweep 1400ms cubic-bezier(.7,.02,.24,1) 410ms both;
}
.wm-intro .wi-scan{
  position:absolute;right:-1px;top:-2px;bottom:-2px;width:2px;
  background:#3df0ff;box-shadow:0 0 8px #3df0ff,0 0 20px rgba(61,240,255,.45);
  animation:wi-ignite 150ms ease-out 260ms both,
            wi-exit 220ms ease-in 1810ms forwards;
}
@keyframes wi-unredact{from{clip-path:inset(-6px 100% -6px -6px);}to{clip-path:inset(-6px -6px -6px -6px);}}
@keyframes wi-consume{from{clip-path:inset(0 0 0 0);}to{clip-path:inset(0 0 0 100%);}}
@keyframes wi-sweep{from{transform:translateX(-100%);}to{transform:translateX(0);}}
@keyframes wi-ignite{from{opacity:0;transform:scaleY(.2);}to{opacity:1;transform:scaleY(1);}}
@keyframes wi-exit{
  0%{opacity:1;}
  30%{opacity:1;box-shadow:0 0 12px #3df0ff,0 0 28px rgba(61,240,255,.6);}
  100%{opacity:0;}
}
@keyframes wi-cool{from{opacity:1;}to{opacity:0;}}

/* ---- declassified: the redaction tear --------------------------------- */
/* Strip and blade track share the same overbled box so %-clip and
   %-translate agree for the full traverse. */
.wm-intro .pw-bloom{
  display:block;position:absolute;left:0;top:0;white-space:nowrap;z-index:2;
  color:#00ff9c;text-shadow:0 0 12px rgba(0,255,156,.95),0 0 24px rgba(0,255,156,.5);
  animation:pw-cool 380ms ease-out 1880ms both;
}
.wm-intro .pw-hot{
  display:block;position:absolute;left:0;top:0;white-space:nowrap;z-index:3;
  color:#eaffec;text-shadow:0 0 3px #fff,0 0 10px rgba(0,255,156,.9);
  animation:pw-hotband 1380ms cubic-bezier(.7,0,.3,1) 420ms both;
}
.wm-intro .pw-strip{
  display:block;position:absolute;left:-4px;right:calc(.17em - 4px);top:-2px;bottom:-2px;z-index:4;
  background:#0f231c;border:1px solid rgba(0,255,156,.85);
  box-shadow:0 0 10px rgba(0,255,156,.35);
  animation:pw-tear 1380ms cubic-bezier(.7,0,.3,1) 420ms both;
}
.wm-intro .pw-bladewrap{
  display:block;position:absolute;left:-4px;right:calc(.17em - 4px);top:-2px;bottom:-2px;z-index:5;
  animation:pw-drag 1380ms cubic-bezier(.7,0,.3,1) 420ms both;
}
.wm-intro .pw-blade{
  position:absolute;right:-1px;top:-2px;bottom:-2px;width:2px;transform-origin:top;
  background:#3df0ff;box-shadow:0 0 8px #3df0ff,0 0 2px #fff;
  animation:pw-slice 120ms cubic-bezier(.2,.9,.3,1) 300ms both,
            pw-out 90ms ease-out 1800ms forwards;
}
@keyframes pw-tear{from{clip-path:inset(0 0 0 0);}to{clip-path:inset(0 0 0 100.5%);}}
@keyframes pw-drag{from{transform:translateX(-100%);}to{transform:translateX(0);}}
@keyframes pw-hotband{from{clip-path:inset(0 100% 0 -13%);}to{clip-path:inset(0 -13% 0 100%);}}
@keyframes pw-slice{from{transform:scaleY(0);}to{transform:scaleY(1);}}
@keyframes pw-out{to{opacity:0;}}
@keyframes pw-cool{from{opacity:.8;}to{opacity:0;}}

/* ---- strike: cold glass, full hum ------------------------------------- */
/* Timeline = 2600ms, 1% = 26ms. 13 letters share one track (one transformer,
   whole-sign strikes); only the stubborn I performs solo. Hard cuts are
   keyframe pairs 0.1% apart; the 100% frames are verbatim the shipped
   .wordmark values, so removing the overlay is invisible. */
.wm-intro.wi-strike-on .wm-base{visibility:hidden;}
.wm-intro .wi-neon{
  display:block;position:absolute;left:0;top:0;white-space:nowrap;z-index:2;
}
.wm-intro .wi-neon .wi-tA{animation:wi-trkA 2600ms linear both;}
.wm-intro .wi-neon .wi-tC{animation:wi-trkC 2600ms linear both;}
.wm-intro .wi-streakwrap{position:absolute;inset:-6px;overflow:hidden;z-index:3;pointer-events:none;}
.wm-intro .wi-streak{
  position:absolute;left:0;top:0;bottom:0;width:36px;
  background:linear-gradient(90deg,transparent,rgba(61,240,255,.35),transparent);
  filter:blur(3px);
  animation:wi-crawl 450ms cubic-bezier(.4,0,.6,1) 350ms both;
}
@keyframes wi-crawl{
  0%{transform:translateX(-44px);opacity:0;}
  50%{opacity:.5;}
  100%{transform:translateX(300px);opacity:0;}
}
@keyframes wi-trkA{
  0%,30.7%{color:rgba(0,255,156,.18);text-shadow:none;}
  30.8%,32.3%{color:#d8fff2;text-shadow:0 0 10px rgba(61,240,255,.8);}
  35.8%,36.5%{color:rgba(0,255,156,.18);text-shadow:none;}
  36.6%,38.5%{color:rgba(160,255,215,.55);text-shadow:0 0 6px rgba(61,240,255,.4);}
  40.4%{color:rgba(0,255,156,.18);text-shadow:none;}
  40.5%,49.9%{color:#00ff9c;text-shadow:0 0 7px rgba(0,255,156,.42);}
  50%{color:rgba(0,255,156,.55);text-shadow:0 0 4px rgba(0,255,156,.25);}
  51.2%,76.9%{color:#00ff9c;text-shadow:0 0 7px rgba(0,255,156,.42);}
  82.7%{color:#ccffe9;text-shadow:0 0 13px rgba(0,255,156,.9),0 0 26px rgba(0,255,156,.35);
    animation-timing-function:cubic-bezier(.22,1,.36,1);}
  100%{color:#00ff9c;text-shadow:0 0 8px rgba(0,255,156,.5);}
}
@keyframes wi-trkC{
  0%,30.7%{color:rgba(0,255,156,.18);text-shadow:none;}
  30.8%,32.3%{color:#d8fff2;text-shadow:0 0 10px rgba(61,240,255,.8);}
  35.8%,36.5%{color:rgba(0,255,156,.18);text-shadow:none;}
  36.6%,38.5%{color:rgba(160,255,215,.55);text-shadow:0 0 6px rgba(61,240,255,.4);}
  40.4%,53.7%{color:rgba(0,255,156,.18);text-shadow:none;}
  53.8%,54.2%{color:rgba(0,255,156,.3);text-shadow:none;}
  54.6%,61.4%{color:rgba(0,255,156,.18);text-shadow:none;}
  61.5%,64%{color:rgba(0,255,156,.7);text-shadow:0 0 5px rgba(0,255,156,.35);}
  66%,67.2%{color:rgba(0,255,156,.18);text-shadow:none;}
  67.3%{color:#baf6ff;text-shadow:0 0 8px rgba(61,240,255,.6);}
  71%,74.9%{color:rgba(0,255,156,.18);text-shadow:none;}
  75%,75.4%{color:#d8fff2;text-shadow:0 0 10px rgba(61,240,255,.8);}
  75.8%,76.9%{color:#00ff9c;text-shadow:0 0 7px rgba(0,255,156,.42);}
  82.7%{color:#ccffe9;text-shadow:0 0 13px rgba(0,255,156,.9),0 0 26px rgba(0,255,156,.35);
    animation-timing-function:cubic-bezier(.22,1,.36,1);}
  100%{color:#00ff9c;text-shadow:0 0 8px rgba(0,255,156,.5);}
}

}
`
