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

import { useEffect, useState } from "react";
import FeedTopbar from "@/components/feed/FeedTopbar";
import { FEED_CSS } from "@/components/feed/feedTheme";
import MintHandle from "@/components/MintHandle";
import MarketplaceClient, {
  sortOptionsFor,
  type GallerySort,
  type GalleryView,
  type TierFilter,
} from "@/components/MarketplaceClient";

const TIER_CHIPS: Array<{ value: TierFilter; label: string; hint: string }> = [
  { value: "all", label: "All", hint: "" },
  { value: "short", label: "1–5", hint: "1M XEC" },
  { value: "mid", label: "6–10", hint: "100K XEC" },
  { value: "base", label: "11–15", hint: "10K XEC" },
];

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

  // Keep the sort valid for the view it applies to (ask-price sorts only
  // exist for listed handles).
  const switchView = (v: GalleryView) => {
    setView(v);
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
    if (v === "all") { setView("all"); setSort("new"); }
    else if (v === "forsale") setView("forsale");
    if (t === "short" || t === "mid" || t === "base") setTier(t);
    if (q) setQuery(q);
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
          <MintHandle />

          <section className="railfilters" aria-label="Gallery filters">
            <p className="fhead">Browse</p>
            <div className="fchips">
              <button
                className={`fchip${view === "forsale" ? " on" : ""}`}
                onClick={() => switchView("forsale")}
              >
                For sale
              </button>
              <button
                className={`fchip${view === "all" ? " on" : ""}`}
                onClick={() => switchView("all")}
              >
                All minted
              </button>
            </div>

            <p className="fhead">Name length</p>
            <div className="fchips">
              {TIER_CHIPS.map((t) => (
                <button
                  key={t.value}
                  className={`fchip${tier === t.value ? " on" : ""}`}
                  title={t.hint}
                  onClick={() => setTier(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <p className="fhead">Search</p>
            <input
              className="fsearch"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="find a name…"
              aria-label="Search handles"
              spellCheck={false}
            />

            <p className="fhead">Sort</p>
            <select
              className="fsel"
              value={sort}
              onChange={(e) => setSort(e.target.value as GallerySort)}
              aria-label="Sort gallery"
            >
              {sortOptionsFor(view).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </section>
        </aside>

        <main className="mkt-main">
          <MarketplaceClient
            view={view}
            tier={tier}
            query={query}
            sort={sort}
            signedIn={signedIn}
            onSortChange={setSort}
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
    max-height:calc(100dvh - 96px);overflow-y:auto;scrollbar-width:thin;
    display:flex;flex-direction:column;gap:26px;padding-right:4px;}
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
html:not(.dark) .pow-mkt{
  --bg:#e9faf2; --panel:#ffffff; --panel2:#f0f9f4; --line:#bfe6d5; --text:#07271d;
  --dim:#5c8578; --neon:#00b06e; --cyan:#0898b4; --no:#e23b4d;
  background-color:var(--bg);
  background-image:
    radial-gradient(1200px 480px at 50% -8%, rgba(0,255,156,.28), transparent 62%),
    repeating-linear-gradient(0deg, rgba(0,180,110,.055) 0 1px, transparent 1px 3px);
}
html:not(.dark) .pow-mkt .fsearch::placeholder{color:#8fb3a6;}
`;
