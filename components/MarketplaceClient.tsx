"use client";
// =============================================================================
//  MarketplaceClient.tsx — the /marketplace grid (client component)
//  Cypherpunk-neon, scoped to .pow-market (mirrors the mint page theme).
//
//  Shows only handles CURRENTLY listed for sale on Agora. The list comes live
//  from GET /api/marketplace/list (which reads the chain); a bought/cancelled
//  listing simply drops out on the next refresh. Buying happens in Cashtab —
//  each card deep-links to the token's Cashtab page, where the on-chain offer
//  can be accepted. We never take custody or handle the purchase ourselves.
//
//  Cards are rendered client-side from renderHandleCard when no hosted PNG
//  exists, so the grid always draws even before images backfill.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { renderHandleCard } from "@/lib/renderHandleCard";
import ThemeToggle from "@/components/ThemeToggle";

type Listing = {
  tokenId: string;
  handle: string;
  tier: string | null;
  createdAt: string;
  imageUrl: string | null;
  priceXec: number;
  priceSats: string;
};

type Sort = "price-asc" | "price-desc" | "new" | "old";

// Cashtab shows the Agora sell offer + a Buy control on the token page.
const cashtabTokenUrl = (tokenId: string) => `https://cashtab.com/#/token/${tokenId}`;

const fmtXec = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " XEC";

const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
};

function Card({ listing }: { listing: Listing }) {
  const svg = useMemo(
    () => renderHandleCard(listing.handle, { seed: listing.tokenId }),
    [listing.handle, listing.tokenId]
  );
  return (
    <a
      className="mkcard"
      href={cashtabTokenUrl(listing.tokenId)}
      target="_blank"
      rel="noreferrer"
    >
      <div className="mkart">
        {listing.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={listing.imageUrl} alt={`@${listing.handle}`} />
        ) : (
          <div className="mksvg" dangerouslySetInnerHTML={{ __html: svg }} />
        )}
      </div>
      <div className="mkmeta">
        <div className="mkhandle">{listing.handle}</div>
        <div className="mkprice">{fmtXec(listing.priceXec)}</div>
        <div className="mkminted">minted {fmtDate(listing.createdAt)}</div>
        <div className="mkbuy">Buy on Cashtab →</div>
      </div>
    </a>
  );
}

export default function MarketplaceClient() {
  const [items, setItems] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<Sort>("price-asc");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/marketplace/list?sort=${sort}`);
        const data = await r.json();
        if (!alive) return;
        if (data.ok) setItems(data.items as Listing[]);
        else setError(data.error || "Marketplace unavailable");
      } catch {
        if (alive) setError("Marketplace unavailable");
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [sort]);

  return (
    <div className="pow-market">
      <style>{CSS}</style>

      <header className="mkhead">
        <p className="eyebrow">
          <Link href="/" className="brandlink">proofofwriting</Link>
          {" // marketplace"}
        </p>
        <h1 className="title">Handles for sale</h1>
        <p className="sub">
          One-of-one <span className="mono">@handles</span>, listed by their holders on
          Agora. Prices are live and on-chain — buy directly in Cashtab. A listed handle
          can&apos;t be used as a profile name until the sale clears or the listing is
          cancelled.
        </p>
        <p className="sub sublist">
          Hold a handle you want to sell?{" "}
          <a
            className="inlink"
            href="https://cashtab.com/#/token"
            target="_blank"
            rel="noreferrer"
          >
            List it on Agora in Cashtab
          </a>{" "}
          and it will appear here automatically.
        </p>
      </header>

      <div className="mkbar">
        <ThemeToggle variant="bare" />
        <label className="sortlabel" htmlFor="mk-sort">Sort</label>
        <select
          id="mk-sort"
          className="sortsel"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
        >
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
          <option value="new">Newest minted</option>
          <option value="old">Oldest minted</option>
        </select>
      </div>

      {loading ? (
        <p className="state">Loading listings…</p>
      ) : error ? (
        <p className="state err">{error}</p>
      ) : !items || items.length === 0 ? (
        <p className="state">
          No handles are listed for sale right now.{" "}
          <Link href="/mint" className="inlink">Mint one</Link> or check back soon.
        </p>
      ) : (
        <div className="mkgrid">
          {items.map((it) => (
            <Card key={it.tokenId} listing={it} />
          ))}
        </div>
      )}
    </div>
  );
}

const CSS = `
.pow-market{
  --bg:#070b0a; --panel:#0d1513; --line:#173a33; --text:#d6fff0; --dim:#5f8a7e;
  --neon:#00ff9c; --cyan:#3df0ff; --no:#ff5c6c;
  min-height:100dvh; background:var(--bg); color:var(--text);
  font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  padding:56px 20px 80px; box-sizing:border-box;
}
.pow-market .mono{font-family:inherit;}
.pow-market .mkhead{max-width:760px;margin:0 auto 34px;text-align:center;}
.pow-market .eyebrow{font-size:12px;letter-spacing:.34em;text-transform:uppercase;color:var(--cyan);margin:0 0 16px;}
.pow-market .brandlink{color:inherit;text-decoration:none;transition:text-shadow .15s,color .15s;}
.pow-market .brandlink:hover{color:var(--neon);text-shadow:0 0 12px rgba(0,255,156,.5);}
.pow-market .title{font-size:40px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:var(--neon);
  margin:0 0 14px;text-shadow:0 0 26px rgba(0,255,156,.28);}
.pow-market .sub{color:#a6d8c9;font-size:14.5px;line-height:1.6;margin:0 auto;max-width:640px;}
.pow-market .sublist{margin-top:12px;color:var(--dim);font-size:13.5px;}
.pow-market .inlink,.pow-market .sublist .inlink{color:var(--cyan);text-decoration:none;border-bottom:1px solid transparent;transition:border-color .15s;}
.pow-market .inlink:hover{border-color:var(--cyan);}

.pow-market .mkbar{max-width:1080px;margin:0 auto 22px;display:flex;justify-content:flex-end;align-items:center;gap:10px;}
.pow-market .pow-toggle{margin-right:auto;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;
  padding:0;background:var(--panel);border:1px solid var(--line);border-radius:9px;color:var(--neon);cursor:pointer;
  transition:border-color .15s,box-shadow .15s;}
.pow-market .pow-toggle:hover{border-color:var(--neon);box-shadow:0 0 16px rgba(0,255,156,.3);}
.pow-market .pow-toggle svg{width:15px;height:15px;}
.pow-market .sortlabel{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);}
.pow-market .sortsel{background:var(--panel);border:1px solid var(--line);color:var(--text);
  font:inherit;font-size:13px;padding:8px 12px;border-radius:8px;outline:none;cursor:pointer;}
.pow-market .sortsel:focus{border-color:var(--cyan);}

.pow-market .state{max-width:760px;margin:60px auto;text-align:center;color:var(--dim);font-size:14.5px;line-height:1.6;}
.pow-market .state.err{color:var(--no);}

.pow-market .mkgrid{max-width:1080px;margin:0 auto;display:grid;gap:18px;
  grid-template-columns:repeat(auto-fill,minmax(220px,1fr));}
.pow-market .mkcard{display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);
  border-radius:14px;overflow:hidden;text-decoration:none;color:inherit;
  transition:border-color .15s,box-shadow .15s,transform .15s;}
.pow-market .mkcard:hover{border-color:var(--neon);box-shadow:0 0 24px rgba(0,255,156,.18);transform:translateY(-2px);}
.pow-market .mkart{aspect-ratio:1/1;background:#0a0f0e;}
.pow-market .mkart img,.pow-market .mksvg{display:block;width:100%;height:100%;}
.pow-market .mksvg svg{display:block;width:100%;height:100%;}
.pow-market .mkmeta{padding:14px 16px 16px;display:flex;flex-direction:column;gap:4px;}
.pow-market .mkhandle{font-size:16px;font-weight:700;color:var(--text);word-break:break-all;}
.pow-market .mkprice{font-size:15px;font-weight:700;color:var(--neon);text-shadow:0 0 8px rgba(0,255,156,.35);}
.pow-market .mkminted{font-size:11.5px;color:var(--dim);}
.pow-market .mkbuy{margin-top:8px;font-size:12.5px;color:var(--cyan);letter-spacing:.02em;}

@media (prefers-reduced-motion:reduce){.pow-market *{transition:none!important;}}
@media (max-width:520px){.pow-market .title{font-size:30px;}.pow-market .mkgrid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;}}

/* Daylight neon: keep the electric palette on a bright ground — the terminal
   glowing under fluorescent light. Grounds flip light, neon deepens just enough
   to stay legible on white; the rgba glow halos stay bright so text still lights. */
html:not(.dark) .pow-market{
  --bg:#e9faf2; --panel:#ffffff; --panel2:#f0f9f4; --line:#bfe6d5; --text:#07271d;
  --dim:#5c8578; --neon:#00b06e; --cyan:#0898b4; --no:#e23b4d;
  background:var(--bg);
  background-image:
    radial-gradient(1200px 480px at 50% -8%, rgba(0,255,156,.28), transparent 62%),
    repeating-linear-gradient(0deg, rgba(0,180,110,.055) 0 1px, transparent 1px 3px);
}
html:not(.dark) .pow-market .sub{color:#3f6b5d;}
html:not(.dark) .pow-market .mkart{background:#eef7f2;}
`;
