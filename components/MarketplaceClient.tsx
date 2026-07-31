"use client";
// =============================================================================
//  MarketplaceClient.tsx — the /marketplace gallery (client component)
//  Cypherpunk-neon, scoped to .pow-market. Rendered inside MarketplaceShell,
//  which owns the page backdrop and (on desktop) the filter rail.
//
//  Two views over one grid:
//    • "forsale" — handles CURRENTLY listed on Agora (GET /api/marketplace/list,
//      live from the chain). Buying happens in Cashtab — each card deep-links to
//      the token's Cashtab page. We never take custody.
//    • "all" — every minted handle (GET /api/handles/list, paginated), each
//      decorated with its live ask price when it's also listed. Unlisted cards
//      link to the handle's own profile (/@handle), which resolves to the
//      current on-chain holder.
//
//  Offers (v1): unlisted cards carry a "Make offer" action — login-gated,
//  amount optional and PRIVATE (only the current holder sees numbers; the
//  public sees only "Offers · N"). The same panel shows the offer list when
//  the signed-in viewer IS the current holder. See sql/handle_offers.sql.
//
//  Filters (view / tier / search / sort) are CONTROLLED props — MarketplaceShell
//  owns the state so the desktop filter rail and this grid stay in sync. On
//  mobile the shell renders no rail and this component's own slim sort bar
//  (hidden on desktop) is the only control, which keeps the phone experience
//  exactly what it was.
//
//  Desktop provenance: hovering a card slides up an on-chain provenance panel
//  (mint date, transfer count, current holder) fetched lazily per token from
//  /api/handles/provenance/<tokenId> and cached for the session.
//
//  Each card's art is the hosted PNG when present, else the on-demand server
//  route /api/handle-card/<tokenId>, so the grid always draws even before
//  images backfill (the ASCII engine is Node-only and can't run in the browser).
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { priceForHandle, type Tier } from "@/lib/handlePricing";
import HandleCardImage from "@/components/HandleCardImage";

export type GalleryView = "forsale" | "all";
export type TierFilter = "all" | Tier;
export type GallerySort = "price-asc" | "price-desc" | "new" | "old" | "az";

type Listing = {
  tokenId: string;
  handle: string;
  tier: string | null;
  createdAt: string;
  imageUrl: string | null;
  priceXec: number;
  priceSats: string;
};

type MintedRow = {
  tokenId: string;
  handle: string;
  tier: string | null;
  createdAt: string;
  imageUrl: string | null;
};

type CardItem = {
  tokenId: string;
  handle: string;
  tier: Tier;
  createdAt: string;
  imageUrl: string | null;
  /** Live Agora ask when listed, else null. */
  priceXec: number | null;
};

type Provenance = {
  mintedAt: string;
  transferCount: number | null;
  holder: { address: string; escrow: boolean; display: string | null } | null;
};

type OffersDetail = {
  count: number;
  mine: { amountXec: number | null } | null;
  holder: boolean;
  offers?: Array<{ bidder: string; amountXec: number | null; at: string }>;
};

const PAGE_SIZE = 48;

/** Sort choices that make sense per view: ask-price sorts only exist for
 *  listed handles; the full collection sorts by mint date or name. */
export function sortOptionsFor(view: GalleryView): Array<{ value: GallerySort; label: string }> {
  if (view === "forsale") {
    return [
      { value: "price-asc", label: "Price: low to high" },
      { value: "price-desc", label: "Price: high to low" },
      { value: "new", label: "Newest minted" },
      { value: "old", label: "Oldest minted" },
    ];
  }
  return [
    { value: "new", label: "Newest minted" },
    { value: "old", label: "Oldest minted" },
    { value: "az", label: "Name A–Z" },
  ];
}

const TIER_CHIPS: Array<{ value: TierFilter; label: string; hint: string }> = [
  { value: "all", label: "All", hint: "" },
  { value: "short", label: "1–5", hint: "1M XEC" },
  { value: "mid", label: "6–10", hint: "100K XEC" },
  { value: "base", label: "11–15", hint: "10K XEC" },
];

/** The gallery's filter controls — ONE component, two placements: the shell
 *  renders it as the desktop rail panel (className "railfilters"), and the
 *  gallery renders it inline above the grid for phones ("mkfilters-inline").
 *  Both instances are controlled by the same shell-owned state, so they can
 *  never disagree. Control styling lives in the shell's .pow-mkt scope. */
export function MarketFilters({
  className,
  view,
  tier,
  query,
  sort,
  onViewChange,
  onTierChange,
  onQueryChange,
  onSortChange,
}: {
  className: string;
  view: GalleryView;
  tier: TierFilter;
  query: string;
  sort: GallerySort;
  onViewChange: (v: GalleryView) => void;
  onTierChange: (t: TierFilter) => void;
  onQueryChange: (q: string) => void;
  onSortChange: (s: GallerySort) => void;
}) {
  return (
    <section className={className} aria-label="Gallery filters">
      <p className="fhead">Browse</p>
      <div className="fchips">
        <button
          className={`fchip${view === "forsale" ? " on" : ""}`}
          onClick={() => onViewChange("forsale")}
        >
          For sale
        </button>
        <button
          className={`fchip${view === "all" ? " on" : ""}`}
          onClick={() => onViewChange("all")}
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
            onClick={() => onTierChange(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="fhead">Search</p>
      <input
        className="fsearch"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="find a name…"
        aria-label="Search handles"
        spellCheck={false}
      />

      <p className="fhead">Sort</p>
      <select
        className="fsel"
        value={sort}
        onChange={(e) => onSortChange(e.target.value as GallerySort)}
        aria-label="Sort gallery"
      >
        {sortOptionsFor(view).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </section>
  );
}

// Cashtab shows the Agora sell offer + a Buy control on the token page.
const cashtabTokenUrl = (tokenId: string) => `https://cashtab.com/#/token/${tokenId}`;

const fmtXec = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " XEC";

// Pinned locale + UTC timezone so the server and the client hydrate identical
// text (an un-pinned toLocaleDateString disagrees across zones → React #418).
const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return "";
  }
};

const tierOf = (handle: string, stored: string | null): Tier =>
  stored === "short" || stored === "mid" || stored === "base"
    ? stored
    : priceForHandle(handle).tier;

const shortAddr = (address: string) => {
  const bare = address.replace(/^ecash:/, "");
  return `${bare.slice(0, 8)}…${bare.slice(-4)}`;
};

// ---------------------------------------------------------------------------
//  provenance — lazy per-token fetch, cached for the session
// ---------------------------------------------------------------------------

const provCache = new Map<string, Provenance | "error">();
const provInflight = new Set<string>();

// ---------------------------------------------------------------------------
//  offers — panel detail cache (invalidated on every place/withdraw)
// ---------------------------------------------------------------------------

const offerDetailCache = new Map<string, OffersDetail>();

function OfferPanel({
  tokenId,
  handle,
  count,
  signedIn,
  onChanged,
}: {
  tokenId: string;
  handle: string;
  count: number;
  signedIn: boolean;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<OffersDetail | "error" | null>(
    offerDetailCache.get(tokenId) ?? null
  );
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/handles/offers?tokenId=${tokenId}`);
      const j = await r.json();
      if (j.ok) {
        offerDetailCache.set(tokenId, j);
        setDetail(j);
        if (j.mine?.amountXec != null) setAmount(String(j.mine.amountXec));
      } else {
        setDetail("error");
      }
    } catch {
      setDetail("error");
    }
  }, [tokenId]);

  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);

  const act = async (action: "place" | "withdraw") => {
    setBusy(true);
    setNote(null);
    try {
      let amountXec: number | null = null;
      if (action === "place" && amount.trim() !== "") {
        amountXec = Number(amount);
        if (!Number.isFinite(amountXec) || amountXec <= 0) {
          setNote("Enter a valid XEC amount, or leave it blank.");
          setBusy(false);
          return;
        }
      }
      const r = await fetch("/api/handles/offer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenId, action, amountXec }),
      });
      const j = await r.json();
      if (!j.ok) {
        setNote(j.error ?? "Something went wrong — try again.");
      } else {
        setNote(action === "place" ? "Offer placed — the holder will see it." : "Offer withdrawn.");
        if (action === "withdraw") setAmount("");
        offerDetailCache.delete(tokenId);
        await load();
        onChanged();
      }
    } catch {
      setNote("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!signedIn) {
    return (
      <div className="mkoffer">
        <p className="onote">
          {count > 0
            ? `${count} collector${count === 1 ? " is" : "s are"} interested. `
            : ""}
          Offers are private — only the holder sees amounts.
        </p>
        <Link className="obtn olink" href="/login">Log in with your wallet →</Link>
      </div>
    );
  }

  if (detail === null) return <div className="mkoffer"><p className="onote">Loading…</p></div>;
  if (detail === "error") {
    return <div className="mkoffer"><p className="onote">Offers aren’t available yet.</p></div>;
  }

  if (detail.holder) {
    return (
      <div className="mkoffer">
        <p className="oh">Offers on @{handle}</p>
        {detail.offers && detail.offers.length > 0 ? (
          detail.offers.map((o, i) => (
            <div className="orow" key={i}>
              <span className="obidder">{o.bidder}</span>
              <span className="oamt">{o.amountXec != null ? fmtXec(o.amountXec) : "no price named"}</span>
            </div>
          ))
        ) : (
          <p className="onote">No offers yet.</p>
        )}
        {detail.offers && detail.offers.length > 0 ? (
          <p className="onote">
            Like one? <a
              className="inlink"
              href="https://cashtab.com/#/token"
              target="_blank"
              rel="noreferrer"
            >List on Agora</a> at that price — the buyer completes it in Cashtab.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mkoffer">
      <p className="oh">{detail.mine ? "Your offer" : "Make an offer"}</p>
      <input
        className="oamount"
        inputMode="decimal"
        placeholder="Amount in XEC (optional)"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        aria-label="Offer amount in XEC"
      />
      <div className="obtns">
        <button className="obtn" disabled={busy} onClick={() => act("place")}>
          {busy ? "…" : detail.mine ? "Update" : "Place offer"}
        </button>
        {detail.mine ? (
          <button className="obtn ghost" disabled={busy} onClick={() => act("withdraw")}>
            Withdraw
          </button>
        ) : null}
      </div>
      <p className="onote">{note ?? "Only the current holder sees your offer."}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  cards
// ---------------------------------------------------------------------------

function Card({
  item,
  signedIn,
  held,
  offerCount,
  offerOpen,
  onToggleOffer,
  onOfferChanged,
}: {
  item: CardItem;
  signedIn: boolean;
  /** The signed-in viewer holds this NFT in their wallet (so they can list it). */
  held: boolean;
  offerCount: number;
  offerOpen: boolean;
  onToggleOffer: () => void;
  onOfferChanged: () => void;
}) {
  const listed = item.priceXec != null;
  const [prov, setProv] = useState<Provenance | "error" | null>(
    provCache.get(item.tokenId) ?? null
  );

  const onEnter = useCallback(() => {
    // Only spend a request where the hover panel can actually show.
    if (typeof window === "undefined" || !window.matchMedia?.("(hover: hover)").matches) return;
    const cached = provCache.get(item.tokenId);
    if (cached) { setProv(cached); return; }
    if (provInflight.has(item.tokenId)) return;
    provInflight.add(item.tokenId);
    fetch(`/api/handles/provenance/${item.tokenId}`)
      .then((r) => r.json())
      .then((j) => {
        const value: Provenance | "error" = j?.ok
          ? { mintedAt: j.mintedAt, transferCount: j.transferCount, holder: j.holder }
          : "error";
        provCache.set(item.tokenId, value);
        setProv(value);
      })
      .catch(() => {
        provCache.set(item.tokenId, "error");
        setProv("error");
      })
      .finally(() => provInflight.delete(item.tokenId));
  }, [item.tokenId]);

  const provLines =
    prov === "error" ? (
      <span className="provline dimline">provenance unavailable</span>
    ) : prov ? (
      <>
        <span className="provline">minted {fmtDate(prov.mintedAt)}</span>
        <span className="provline">
          {prov.transferCount == null
            ? "transfers unknown"
            : `${prov.transferCount} transfer${prov.transferCount === 1 ? "" : "s"}`}
        </span>
        <span className="provline">
          {prov.holder == null
            ? "holder unknown"
            : prov.holder.escrow
              ? "in Agora escrow (listed)"
              : `held by ${prov.holder.display ?? shortAddr(prov.holder.address)}`}
        </span>
      </>
    ) : (
      <span className="provline dimline">loading provenance…</span>
    );

  const body = (
    <>
      <div className="mkart">
        {/* Gallery tiles are small (the grid packs 4–5 per row) and the
            provenance overlay slides up over the bottom of the art, so the
            shared hover-to-enlarge preview is what actually lets you SEE the
            piece you're shopping for — same affordance as profile pages. */}
        <HandleCardImage
          src={item.imageUrl}
          tokenId={item.tokenId}
          handle={item.handle}
          alt={`@${item.handle}`}
          loading="lazy"
        />
        <div className="mkprov" aria-hidden>{provLines}</div>
      </div>
      <div className="mkmeta">
        <div className="mkhandle">{item.handle}</div>
        {item.priceXec != null ? (
          <div className="mkprice">{fmtXec(item.priceXec)}</div>
        ) : held ? (
          <div className="mknoprice mkyours">not listed · yours</div>
        ) : (
          <div className="mknoprice">not listed</div>
        )}
        <div className="mkminted">minted {fmtDate(item.createdAt)}</div>
      </div>
    </>
  );

  // The art + meta are one click surface; actions live OUTSIDE the link so a
  // button never nests inside an anchor. Listed cards go to Cashtab (where the
  // on-chain offer is accepted); a card the viewer HOLDS goes to Cashtab too, to
  // list it for sale; every other unlisted card goes to the handle's profile.
  const toCashtab = listed || held;
  return (
    <div className="mkcard">
      {toCashtab ? (
        <a
          className="mklink"
          href={cashtabTokenUrl(item.tokenId)}
          target="_blank"
          rel="noreferrer"
          onMouseEnter={onEnter}
        >
          {body}
        </a>
      ) : (
        <Link className="mklink" href={`/@${item.handle}`} onMouseEnter={onEnter}>
          {body}
        </Link>
      )}
      <div className="mkactions">
        {listed ? (
          <a className="mkact" href={cashtabTokenUrl(item.tokenId)} target="_blank" rel="noreferrer">
            Buy on Cashtab →
          </a>
        ) : held ? (
          <a className="mkact" href={cashtabTokenUrl(item.tokenId)} target="_blank" rel="noreferrer">
            List on Cashtab →
          </a>
        ) : (
          <>
            <Link className="mkact" href={`/@${item.handle}`}>Profile →</Link>
            <button className={`mkact offerbtn${offerOpen ? " on" : ""}`} onClick={onToggleOffer}>
              {offerCount > 0 ? `Offers · ${offerCount}` : "Make offer"}
            </button>
          </>
        )}
      </div>
      {offerOpen && !listed && !held ? (
        <OfferPanel
          tokenId={item.tokenId}
          handle={item.handle}
          count={offerCount}
          signedIn={signedIn}
          onChanged={onOfferChanged}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  the gallery
// ---------------------------------------------------------------------------

export default function MarketplaceClient({
  view = "forsale",
  tier = "all",
  query = "",
  sort = "price-asc",
  signedIn = false,
  onViewChange,
  onTierChange,
  onQueryChange,
  onSortChange,
}: {
  view?: GalleryView;
  tier?: TierFilter;
  query?: string;
  sort?: GallerySort;
  signedIn?: boolean;
  onViewChange?: (v: GalleryView) => void;
  onTierChange?: (t: TierFilter) => void;
  onQueryChange?: (q: string) => void;
  onSortChange?: (s: GallerySort) => void;
}) {
  // ---- listings (Agora) — one live fetch; small set, sorted/filtered here ----
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/marketplace/list?sort=price-asc")
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        if (data.ok) setListings(data.items as Listing[]);
        else setListErr(data.error || "Marketplace unavailable");
      })
      .catch(() => alive && setListErr("Marketplace unavailable"));
    return () => {
      alive = false;
    };
  }, []);

  const listedPrice = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of listings ?? []) m.set(l.tokenId, l.priceXec);
    return m;
  }, [listings]);

  // ---- what the signed-in viewer holds — so their own cards link to Cashtab
  //      to LIST, instead of to the profile / "make offer". One session-gated
  //      call; logged-out visitors never hit it (and hold nothing). ----
  const [heldTokenIds, setHeldTokenIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!signedIn) {
      setHeldTokenIds(new Set());
      return;
    }
    let alive = true;
    fetch("/api/account/handles")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j?.authenticated) return;
        setHeldTokenIds(
          new Set((j.handles ?? []).map((h: { tokenId: string }) => h.tokenId)),
        );
      })
      .catch(() => {
        /* best-effort: cards just fall back to the profile/offer action */
      });
    return () => {
      alive = false;
    };
  }, [signedIn]);

  // ---- minted collection — server-paginated, refetched when filters move ----
  const [minted, setMinted] = useState<MintedRow[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [mintedLoading, setMintedLoading] = useState(false);
  const reqSeq = useRef(0);

  // Debounce typed search so we don't hit the API per keystroke.
  const [debouncedQ, setDebouncedQ] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const srvSort = sort === "old" ? "old" : sort === "az" ? "az" : "new";

  const fetchMinted = useCallback(
    async (offset: number, replace: boolean) => {
      const seq = ++reqSeq.current;
      setMintedLoading(true);
      try {
        const params = new URLSearchParams({
          sort: srvSort,
          limit: String(PAGE_SIZE),
          offset: String(offset),
        });
        if (debouncedQ) params.set("q", debouncedQ);
        if (tier !== "all") params.set("tier", tier);
        const r = await fetch(`/api/handles/list?${params.toString()}`);
        const j = await r.json();
        if (seq !== reqSeq.current) return; // a newer request superseded this one
        if (j.ok) {
          setMinted((prev) => (replace || !prev ? j.items : [...prev, ...j.items]));
          setHasMore(Boolean(j.hasMore));
        }
      } catch {
        /* leave the current page in place */
      } finally {
        if (seq === reqSeq.current) setMintedLoading(false);
      }
    },
    [srvSort, debouncedQ, tier]
  );

  useEffect(() => {
    if (view !== "all") return;
    setMinted(null);
    void fetchMinted(0, true);
  }, [view, fetchMinted]);

  // ---- the items the grid shows ----
  const q = query.trim().toLowerCase();
  const items: CardItem[] | null = useMemo(() => {
    if (view === "forsale") {
      if (!listings) return null;
      const filtered = listings
        .map((l) => ({
          tokenId: l.tokenId,
          handle: l.handle,
          tier: tierOf(l.handle, l.tier),
          createdAt: l.createdAt,
          imageUrl: l.imageUrl,
          priceXec: l.priceXec,
        }))
        .filter((it) => (tier === "all" || it.tier === tier) && (!q || it.handle.toLowerCase().includes(q)));
      const s = [...filtered];
      if (sort === "price-desc") s.sort((a, b) => (b.priceXec ?? 0) - (a.priceXec ?? 0));
      else if (sort === "new") s.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      else if (sort === "old") s.sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
      else if (sort === "az") s.sort((a, b) => a.handle.localeCompare(b.handle));
      else s.sort((a, b) => (a.priceXec ?? 0) - (b.priceXec ?? 0));
      return s;
    }
    if (!minted) return null;
    return minted.map((m) => ({
      tokenId: m.tokenId,
      handle: m.handle,
      tier: tierOf(m.handle, m.tier),
      createdAt: m.createdAt,
      imageUrl: m.imageUrl,
      priceXec: listedPrice.get(m.tokenId) ?? null,
    }));
  }, [view, listings, minted, listedPrice, tier, q, sort]);

  // ---- offer interest counts (public, batched per page of cards) ----
  const [offerCounts, setOfferCounts] = useState<Record<string, number>>({});
  const [openOffer, setOpenOffer] = useState<string | null>(null);

  const refreshCounts = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    try {
      const r = await fetch("/api/handles/offers/counts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenIds: ids }),
      });
      const j = await r.json();
      if (!j.ok) return;
      setOfferCounts((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = j.counts[id] ?? 0;
        return next;
      });
    } catch {
      /* interest chips just don't update */
    }
  }, []);

  useEffect(() => {
    const ids = (items ?? []).filter((it) => it.priceXec == null).map((it) => it.tokenId);
    void refreshCounts(ids);
  }, [items, refreshCounts]);

  const loading = view === "forsale" ? listings === null && !listErr : minted === null;
  const error = view === "forsale" ? listErr : null;

  return (
    <div className="pow-market" id="marketplace">
      <style>{CSS}</style>

      <header className="mkhead">
        <h1 className="title">Gallery</h1>
        <p className="sub sublist">
          Hold a handle you want to sell?{" "}
          <a
            className="inlink"
            href="https://cashtab.com/#/token"
            target="_blank"
            rel="noreferrer"
          >
            List it on Agora in Cashtab
          </a>
          .
        </p>
      </header>

      {/* Phone-width filter panel — the desktop rail renders the same
          component; CSS shows exactly one of the two instances. */}
      {onViewChange && onTierChange && onQueryChange && onSortChange ? (
        <MarketFilters
          className="mkfilters-inline"
          view={view}
          tier={tier}
          query={query}
          sort={sort}
          onViewChange={onViewChange}
          onTierChange={onTierChange}
          onQueryChange={onQueryChange}
          onSortChange={onSortChange}
        />
      ) : null}

      {loading ? (
        <p className="state">{view === "forsale" ? "Loading listings…" : "Loading the collection…"}</p>
      ) : error ? (
        <p className="state err">{error}</p>
      ) : !items || items.length === 0 ? (
        <p className="state">
          {view === "forsale" && !q && tier === "all" ? (
            <>No handles are listed for sale right now.{" "}
              <Link href="/marketplace" className="inlink">Mint one</Link> or check back soon.</>
          ) : (
            <>Nothing matches{q ? <> “<span className="mono">{query.trim()}</span>”</> : null}. Try a different filter.</>
          )}
        </p>
      ) : (
        <>
          <div className="mkgrid">
            {items.map((it) => (
              <Card
                key={it.tokenId}
                item={it}
                signedIn={signedIn}
                held={heldTokenIds.has(it.tokenId)}
                offerCount={offerCounts[it.tokenId] ?? 0}
                offerOpen={openOffer === it.tokenId}
                onToggleOffer={() =>
                  setOpenOffer((cur) => (cur === it.tokenId ? null : it.tokenId))
                }
                onOfferChanged={() => refreshCounts([it.tokenId])}
              />
            ))}
          </div>
          {view === "all" && hasMore ? (
            <button
              className="mkmore"
              disabled={mintedLoading}
              onClick={() => fetchMinted(minted?.length ?? 0, false)}
            >
              {mintedLoading ? "Loading…" : "Load more"}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

const CSS = `
.pow-market{
  --bg:#070b0a; --panel:#0d1513; --line:#173a33; --text:#d6fff0; --dim:#5f8a7e;
  --neon:#00ff9c; --cyan:#3df0ff; --no:#ff5c6c;
  color:var(--text);
  font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  box-sizing:border-box;
}
.pow-market .mono{font-family:inherit;}

.pow-market .mkhead{margin:0 0 26px;text-align:center;}
.pow-market .title{font-size:40px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:var(--neon);
  margin:0 0 14px;text-shadow:0 0 26px rgba(0,255,156,.28);}
.pow-market .sub{color:#a6d8c9;font-size:14.5px;line-height:1.6;margin:0 auto;max-width:640px;}
.pow-market .sublist{margin-top:0;color:var(--dim);font-size:13.5px;}
.pow-market .inlink,.pow-market .sublist .inlink{color:var(--cyan);text-decoration:none;border-bottom:1px solid transparent;transition:border-color .15s;}
.pow-market .inlink:hover{border-color:var(--cyan);}

/* Phone placement of the shared filter panel: a compact card between the
   gallery header and the grid. Hidden on desktop, where the rail instance
   takes over (control styling itself lives in the shell's .pow-mkt scope). */
.pow-market .mkfilters-inline{display:flex;flex-direction:column;gap:10px;margin:0 0 18px;
  background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 16px 18px;text-align:left;}

.pow-market .state{max-width:760px;margin:60px auto;text-align:center;color:var(--dim);font-size:14.5px;line-height:1.6;}
.pow-market .state.err{color:var(--no);}

/* Phone-first: the 640px column fits three tiles (two on narrow phones) —
   exactly the old embedded grid. The desktop pane relaxes the floor so the
   gallery breathes at 4–5 per row. */
.pow-market .mkgrid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));}
.pow-market .mkcard{display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);
  border-radius:14px;overflow:hidden;
  transition:border-color .15s,box-shadow .15s,transform .15s;}
.pow-market .mkcard:hover{border-color:var(--neon);box-shadow:0 0 24px rgba(0,255,156,.18);transform:translateY(-2px);}
.pow-market .mklink{display:flex;flex-direction:column;text-decoration:none;color:inherit;flex:1;}
.pow-market .mkart{aspect-ratio:1/1;background:#0a0f0e;position:relative;overflow:hidden;}
.pow-market .mkart img{display:block;width:100%;height:100%;}
.pow-market .mkmeta{padding:14px 16px;display:flex;flex-direction:column;gap:4px;}
/* Keep a full 15-char handle on ONE line so it never wraps the last letter onto
   a new row and grows the card. On the narrow grid (150px floor below 1100px) a
   15-char handle only fits at ~13px (measured, JetBrains Mono 700); desktop cards
   are wide enough to restore 16px (see the min-width:1100px block). nowrap instead
   of break-all guarantees a single line. */
.pow-market .mkhandle{font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;}
.pow-market .mkprice{font-size:15px;font-weight:700;color:var(--neon);text-shadow:0 0 8px rgba(0,255,156,.35);}
.pow-market .mknoprice{font-size:13px;font-weight:700;color:var(--dim);letter-spacing:.04em;}
.pow-market .mkyours{color:var(--cyan);}
.pow-market .mkminted{font-size:11.5px;color:var(--dim);}

/* Action strip: link zones and buttons live OUTSIDE the card's main anchor. */
.pow-market .mkactions{display:flex;border-top:1px solid var(--line);}
.pow-market .mkact{flex:1;padding:10px 8px;font:inherit;font-size:12px;color:var(--cyan);letter-spacing:.02em;
  text-decoration:none;text-align:center;background:none;border:none;cursor:pointer;transition:color .15s;}
.pow-market .mkact:hover{color:var(--neon);}
.pow-market .mkact + .mkact{border-left:1px solid var(--line);}
.pow-market .offerbtn.on{color:var(--neon);}

/* Offer panel — expands under the card. */
.pow-market .mkoffer{border-top:1px solid var(--line);padding:12px 14px 14px;display:flex;flex-direction:column;gap:9px;text-align:left;}
.pow-market .mkoffer .oh{font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--dim);margin:0;}
.pow-market .mkoffer .oamount{background:var(--bg);border:1px solid var(--line);border-radius:8px;
  padding:9px 11px;color:var(--text);font:inherit;font-size:13px;outline:none;width:100%;box-sizing:border-box;}
.pow-market .mkoffer .oamount:focus{border-color:var(--cyan);}
.pow-market .mkoffer .obtns{display:flex;gap:8px;}
.pow-market .mkoffer .obtn{flex:1;background:transparent;border:1px solid var(--neon);color:var(--neon);
  border-radius:8px;padding:9px 8px;font:inherit;font-size:12px;font-weight:700;letter-spacing:.04em;cursor:pointer;
  text-align:center;text-decoration:none;transition:background .15s,color .15s;}
.pow-market .mkoffer .obtn:hover{background:var(--neon);color:#04120c;}
.pow-market .mkoffer .obtn:disabled{border-color:var(--line);color:var(--dim);background:none;cursor:default;}
.pow-market .mkoffer .obtn.ghost{border-color:var(--line);color:var(--dim);}
.pow-market .mkoffer .obtn.ghost:hover{background:none;border-color:var(--no);color:var(--no);}
.pow-market .mkoffer .olink{display:block;}
.pow-market .mkoffer .onote{font-size:11.5px;color:var(--dim);line-height:1.5;margin:0;}
.pow-market .mkoffer .orow{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:12.5px;}
.pow-market .mkoffer .obidder{color:var(--text);word-break:break-all;}
.pow-market .mkoffer .oamt{color:var(--neon);font-weight:700;white-space:nowrap;}

/* On-chain provenance panel — slides up over the art on hover-capable desktop. */
.pow-market .mkprov{position:absolute;left:0;right:0;bottom:0;display:none;flex-direction:column;gap:3px;
  padding:10px 12px;font-size:11px;line-height:1.45;color:var(--text);
  background:rgba(7,11,10,.88);backdrop-filter:blur(6px);border-top:1px solid var(--line);
  transform:translateY(102%);transition:transform .18s ease;pointer-events:none;}
.pow-market .provline{display:block;}
.pow-market .dimline{color:var(--dim);}
@media (hover:hover) and (min-width:1100px){
  .pow-market .mkprov{display:flex;}
  .pow-market .mkcard:hover .mkprov{transform:translateY(0);}
}

.pow-market .mkmore{display:block;margin:26px auto 0;background:transparent;border:1px solid var(--line);
  color:var(--text);border-radius:10px;padding:12px 26px;font:inherit;font-size:13px;cursor:pointer;
  transition:border-color .15s,color .15s;}
.pow-market .mkmore:hover{border-color:var(--neon);color:var(--neon);}
.pow-market .mkmore:disabled{color:var(--dim);border-color:var(--line);cursor:default;}

@media (min-width:1100px){
  .pow-market .mkfilters-inline{display:none;}
  .pow-market .mkgrid{gap:18px;grid-template-columns:repeat(auto-fill,minmax(205px,1fr));}
  .pow-market .mkhead{margin-bottom:30px;}
  /* Wide (205px) cards fit a 15-char handle at the full size again. */
  .pow-market .mkhandle{font-size:16px;}
}
@media (prefers-reduced-motion:reduce){.pow-market *{transition:none!important;}}
@media (max-width:520px){.pow-market .title{font-size:30px;}.pow-market .mkgrid{gap:12px;}}

/* Daylight neon: grounds flip light, neon deepens just enough to stay legible;
   the page background itself belongs to MarketplaceShell. */
/* PAPER (light mode) — see feedTheme.js for the shared token set. */
html:not(.dark) .pow-market{
  --bg:#f6f4ed; --panel:#fdfcf8; --panel2:#f1eee4; --line:#e3dfd2; --text:#1a1c17;
  --dim:#5e6155; --neon:#12703c; --cyan:#0e6b74; --no:#a3312f; --live:#00c853;
  --paper-shadow:0 1px 2px rgba(26,28,23,.05); --accent-hover:#0d5a2f; --accent-tint:#e7f0e7;
}
html:not(.dark) .pow-market *{text-shadow:none;}
html:not(.dark) .pow-market .sub{color:#4a4d42;}
/* The NFT art tile (.mkart) + its provenance overlay (.mkprov) stay on a dark
   chip in BOTH themes — intentional, framed like a plate on the page rather
   than a leak (suggestion #7). The overlay KEEPS its dark background, but its
   text is var(--text) — which is ink on paper and would vanish on the dark
   plate — so we hold it light here (ink-on-dark, matching the plate). */
html:not(.dark) .pow-market .mkprov{color:#efece2;}
html:not(.dark) .pow-market .mkprov .dimline{color:#a7a293;}
html:not(.dark) .pow-market .mkoffer .obtn:hover{color:#fdfcf8;}
`;
