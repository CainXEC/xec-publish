"use client";

import { useEffect, useState } from "react";

// Live "X / 10,000 minted" progress on the mint page. Polls the counter so it
// ticks up as new handles mint while you're on the page. Styling lives in
// MintHandle's CSS (.pow-mint .mintcount*). NOTE: minted counts POST-LAUNCH
// mints only, so it reads 0 until the collection goes live.
export default function MintCounter() {
  const [state, setState] = useState<{ minted: number; cap: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/mint/count", { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (alive && d?.ok) setState({ minted: Number(d.minted) || 0, cap: Number(d.cap) || 10000 });
      } catch {
        /* transient — keep the last good value */
      }
    };
    load();
    const id = setInterval(load, 12000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!state) return null;
  const { minted, cap } = state;
  const pct = cap > 0 ? Math.min(100, (minted / cap) * 100) : 0;

  return (
    <div className="mintcount" aria-label={`${minted} of ${cap} handles minted`}>
      <div className="mintcount-row">
        <span className="mintcount-num">{minted.toLocaleString("en-US")}</span>
        <span className="mintcount-of"> / {cap.toLocaleString("en-US")} minted</span>
      </div>
      <div className="mintcount-bar">
        <div className="mintcount-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
