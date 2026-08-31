"use client";
// =============================================================================
//  MarketplaceShell.tsx — the /marketplace page frame (client component)
//
//  Owns what used to live inside MintHandle: the full-bleed cypherpunk
//  backdrop, the shared FeedTopbar, and — new — the responsive split:
//
//    • phones/tablets (<1100px): one 640px column, mint flow on top, gallery
//      below a hairline separator — byte-for-byte the old page.
//    • desktop (≥1100px): a sticky left rail (compact mint flow + the filter
//      panel) beside a wide gallery pane. This is the "proper gallery"
//      desktop differentiation: more cards per row, filters, provenance
//      on hover (the gallery itself is MarketplaceClient).
//
//  Filter state lives HERE so the desktop rail and the gallery stay in sync;
//  on mobile the rail's filter panel is hidden and the gallery's own slim
//  sort bar (its only mobile control, as before) drives the same state.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import FeedTopbar from "@/components/feed/FeedTopbar";
import { FEED_CSS } from "@/components/feed/feedTheme";
import MintHandle from "@/components/MintHandle";
import MarketplaceClient, {
  MarketFilters,
  sortOptionsFor,
  type GallerySort,
  type GalleryView,
  type TierFilter,
} from "@/components/MarketplaceClient";

export default function MarketplaceShell({
  signedIn = false,
  isAuthor = false,
}: {
  signedIn?: boolean;
  isAuthor?: boolean;
}) {
  const [view, setView] = useState<GalleryView>("forsale");
  const [tier, setTier] = useState<TierFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<GallerySort>("price-asc");
  // When set, the gallery is scoped to one owner's handles (the profile's
  // "Make an offer on a handle →" link → ?holder=<identity>). Picking a browse
  // view (For sale / All minted) exits the scope.
  const [holder, setHolder] = useState<string | null>(null);
  // Whether THIS page load opened on a holder deep-link — read synchronously at
  // first render (holder state is set in an effect, one tick too late to gate the
  // mint field's mount-time autoFocus). Used only to suppress that autoFocus so it
  // doesn't scroll the viewport back up to the mint hero (and pop the mobile
  // keyboard) while we auto-scroll down to the holder's handles.
  const openedOnHolder = useRef<boolean>(
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("holder"),
  );

  // Keep the sort valid for the view it applies to (ask-price sorts only
  // exist for listed handles).
  const switchView = (v: GalleryView) => {
    setView(v);
    setHolder(null);
    if (!sortOptionsFor(v).some((o) => o.value === sort)) {
      setSort(v === "forsale" ? "price-asc" : "new");
    }
  };

  // Deep links (e.g. the "made an offer on @x" bell) can pre-set the gallery:
  // /marketplace?view=all&q=name&tier=short. Read after mount — the shell is
  // SSR'd, so reading location during render would mismatch hydration.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const v = sp.get("view");
    const t = sp.get("tier");
    const q = sp.get("q");
    const h = sp.get("holder");
    if (v === "all") { setView("all"); setSort("new"); }
    else if (v === "forsale") setView("forsale");
    if (t === "short" || t === "mid" || t === "base") setTier(t);
    if (q) setQuery(q);
    // A holder scope ("@who's handles") reads over the all-minted machinery.
    if (h) { setHolder(h); setView("all"); setSort("new"); }

    // On the stacked (mobile / narrow) layout, a holder deep-link — from a
    // profile's "Make an offer on a handle →" — should LAND on the handles, not
    // the mint hero above them. Scroll so the mint↔handles divider (the .mkt-main
    // border-top) tucks behind the sticky header, leaving a little padding above
    // the handles. Desktop (>=1100px) is side-by-side with no divider, so skip.
    if (h) {
      // Land the viewport ON the handles, not the mint hero above them — but only
      // on the STACKED (mobile / narrow) layout, which is the one with a mint↔
      // handles divider (the .mkt-main border-top; side-by-side desktop has none).
      // We detect that from the divider itself, not a mount-time matchMedia (the
      // emulated/real viewport can settle a beat after mount). The handles load
      // async, but MarketplaceClient reserves gallery height WHILE they load (a
      // min-height on the loading placeholder), so the page is tall enough to
      // scroll IMMEDIATELY — we don't wait for a card to paint (that was the
      // multi-second "stuck on the mint hero" wait). We keep recomputing the
      // target each tick as the mint art and the loading→cards swap reflow the
      // page, settling only once cards have actually painted so the final layout
      // is stable. It settles within ~200ms of landing (the skeleton grid carries
      // .mkcard the moment it paints), so there's no lasting fight with a user who
      // scrolls — no event guard needed (and a synthetic touch/wheel from a mobile
      // emulator would wrongly trip one).
      const VISIBLE_PAD = 12;
      let tries = 0;
      let stable = 0;
      const land = () => {
        tries += 1;
        const main = document.querySelector<HTMLElement>(".mkt-main");
        const cs = main ? getComputedStyle(main) : null;
        const stacked = cs ? parseFloat(cs.borderTopWidth) > 0 : false;
        // Not stacked once the layout has settled → side-by-side desktop, nothing to do.
        if (main && !stacked && tries > 12) return;
        if (main && stacked && cs) {
          const inset = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0);
          const barH = document.querySelector(".topbar")?.getBoundingClientRect().height ?? 55;
          const target = Math.max(
            0,
            window.scrollY + main.getBoundingClientRect().top + inset - barH - VISIBLE_PAD
          );
          if (Math.abs(window.scrollY - target) > 2) {
            window.scrollTo({ top: target, behavior: "auto" });
            stable = 0;
          } else {
            stable += 1;
          }
          // Settle once we're steady on the handles (skeleton or real cards both
          // carry .mkcard, so this fires as soon as the placeholder grid paints).
          if (stable >= 3 && main.querySelector(".mkcard")) return;
        }
        if (tries < 120) setTimeout(land, 50); // ≤6s cap, then give up
      };
      // setTimeout (not requestAnimationFrame) so it still fires if the tab isn't
      // foregrounded during load (rAF is paused in background tabs).
      setTimeout(land, 0);
    }
  }, []);

  return (
    <div className="pow-mkt">
      <style>{SHELL_CSS}</style>

      {/* Shared feed header, hosted in its own .pow-feed scope so it renders
          identically to the homepage without the feed theme taking over this
          page's backdrop. */}
      <div className="pow-feed topbar-host">
        <style>{FEED_CSS}</style>
        <FeedTopbar signedIn={signedIn} isAuthor={isAuthor} showMarketplace={false} />
      </div>

      <div className="mkt-cols">
        <aside className="mkt-rail">
          <MintHandle signedIn={signedIn} autoFocus={!openedOnHolder.current} />

          <MarketFilters
            className="railfilters"
            view={view}
            tier={tier}
            query={query}
            sort={sort}
            onViewChange={switchView}
            onTierChange={setTier}
            onQueryChange={setQuery}
            onSortChange={setSort}
          />
        </aside>

        <main className="mkt-main">
          <MarketplaceClient
            view={view}
            tier={tier}
            query={query}
            sort={sort}
            holder={holder}
            signedIn={signedIn}
            onViewChange={switchView}
            onTierChange={setTier}
            onQueryChange={setQuery}
            onSortChange={setSort}
            onClearHolder={() => setHolder(null)}
          />
        </main>
      </div>
    </div>
  );
}

const SHELL_CSS = `
.pow-mkt{
  --bg:#070b0a; --panel:#0d1513; --line:#173a33; --text:#d6fff0; --dim:#5f8a7e;
  --neon:#00ff9c; --cyan:#3df0ff; --no:#ff5c6c;
  width:100vw; margin-left:calc(50% - 50vw); min-height:100dvh; box-sizing:border-box;
  background-color:var(--bg);
  background-image:
    radial-gradient(1200px 480px at 50% -8%, rgba(0,255,156,.12), transparent 62%),
    repeating-linear-gradient(0deg, rgba(0,255,156,.035) 0 1px, transparent 1px 3px);
  color:var(--text);
  font-family:'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  padding:0 0 110px;
}

/* The shared topbar spans the full page; neutralize .pow-feed's own
   full-bleed + viewport chrome (this shell already owns both). The HOST is
   the sticky element: the inner .topbar's own sticky can't escape this
   wrapper's box (sticky pins only within its parent), so pinning must
   happen at this level for the bar to survive scrolling — same behavior
   as the feed, where the bar's parent is the full-height page. */
.pow-mkt .topbar-host.pow-feed{position:sticky;top:0;z-index:50;width:auto;margin:0 0 26px;min-height:0;background:none;}

/* ---- phone-first: one centered column, mint flow then gallery ---- */
.pow-mkt .mkt-cols{padding:0 20px;}
.pow-mkt .mkt-rail{max-width:640px;margin:0 auto;}
.pow-mkt .mkt-main{max-width:640px;margin:32px auto 0;padding-top:28px;border-top:1px solid var(--line);}
.pow-mkt .railfilters{display:none;}

/* ---- desktop (≥1100px): sticky rail + wide gallery ---- */
@media (min-width:1100px){
  .pow-mkt .topbar-host .topbar{max-width:1560px;}
  .pow-mkt .mkt-cols{display:grid;grid-template-columns:390px minmax(0,1fr);gap:40px;
    max-width:1560px;margin:0 auto;padding:0 28px;align-items:start;}
  .pow-mkt .mkt-rail{position:sticky;top:76px;max-width:none;margin:0;
    max-height:calc(100dvh - 96px);overflow-y:auto;scrollbar-width:none;
    display:flex;flex-direction:column;gap:26px;padding-right:4px;}
  .pow-mkt .mkt-rail::-webkit-scrollbar{display:none;}
  .pow-mkt .mkt-main{max-width:none;margin:0;padding-top:0;border-top:none;}

  /* Keep the rail lean: hide the big mystery card until a name is typed (it
     reappears live as you type — and always shows during pay/reveal). The
     MINT heading itself stays full-size to mirror GALLERY across the fold. */
  .pow-mkt .mkt-rail .stage-idle{display:none;}
  .pow-mkt .mkt-rail .pow-mint .card{width:220px;height:220px;}
}

/* ---- the desktop filter panel ---- */
.pow-mkt .railfilters{flex-direction:column;gap:10px;background:var(--panel);
  border:1px solid var(--line);border-radius:14px;padding:18px 18px 20px;text-align:left;}
@media (min-width:1100px){.pow-mkt .railfilters{display:flex;}}
.pow-mkt .fhead{font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--dim);margin:8px 0 0;}
.pow-mkt .fhead:first-child{margin-top:0;}
.pow-mkt .fchips{display:flex;flex-wrap:wrap;gap:8px;}
.pow-mkt .fchip{background:transparent;border:1px solid var(--line);color:var(--text);
  border-radius:999px;padding:7px 14px;font:inherit;font-size:12.5px;cursor:pointer;
  transition:border-color .15s,color .15s,box-shadow .15s;}
.pow-mkt .fchip:hover{border-color:var(--cyan);color:var(--cyan);}
.pow-mkt .fchip.on{border-color:var(--neon);color:var(--neon);box-shadow:0 0 14px rgba(0,255,156,.22);}
.pow-mkt .fsearch{background:var(--bg);border:1px solid var(--line);border-radius:8px;
  padding:10px 12px;color:var(--text);font:inherit;font-size:13px;outline:none;width:100%;box-sizing:border-box;}
.pow-mkt .fsearch:focus{border-color:var(--cyan);}
.pow-mkt .fsearch::placeholder{color:#37655a;}
.pow-mkt .fsel{background:var(--bg);border:1px solid var(--line);color:var(--text);
  font:inherit;font-size:13px;padding:9px 12px;border-radius:8px;outline:none;cursor:pointer;width:100%;}
.pow-mkt .fsel:focus{border-color:var(--cyan);}

@media (prefers-reduced-motion:reduce){.pow-mkt *{transition:none!important;}}

/* Daylight neon: same recipe the mint page used — grounds flip light, glow
   halos stay bright. */
/* PAPER (light mode) — warm manuscript grounds, ink type, glow killed.
   Mirrors the feed/article paper token set. */
html:not(.dark) .pow-mkt{
  --bg:#f6f4ed; --panel:#fdfcf8; --panel2:#f1eee4; --line:#e3dfd2; --text:#1a1c17;
  --dim:#5e6155; --neon:#12703c; --cyan:#0e6b74; --no:#a3312f; --live:#00c853;
  --paper-shadow:0 1px 2px rgba(26,28,23,.05); --accent-hover:#0d5a2f; --accent-tint:#e7f0e7;
  background-color:var(--bg);
  background-image:none;
}
html:not(.dark) .pow-mkt *{text-shadow:none;}
html:not(.dark) .pow-mkt .fsearch::placeholder{color:#a9a597;}
`;
