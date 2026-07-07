// =============================================================================
//  app/dev/cards/page.tsx  (DEV ONLY)
//  Visual test bench for the 3-tier Gen 1 ASCII art engine. Renders sample
//  cards per price tier straight from /api/dev-card (no minting needed), with a
//  shuffle button to re-roll seeds and a box to preview any custom handle.
//  Returns 404 in production.
// =============================================================================
"use client";

import { useState } from "react";

const TIERS: { label: string; price: string; handles: string[] }[] = [
  { label: "short — kaomoji", price: "1,000,000 XEC · 1–5 chars", handles: ["a", "zk", "sat", "moon", "alice"] },
  { label: "mid — scene", price: "100,000 XEC · 6–10 chars", handles: ["writer", "voyager", "cosmos", "explorer", "wanderer"] },
  { label: "base — silhouette", price: "10,000 XEC · 11–15 chars", handles: ["longhandle01", "writerforever", "eternalscribe"] },
];

function seedFor(nonce: number, handle: string, i: number) {
  return `dev-${nonce}-${handle}-${i}`;
}

export default function DevCards() {
  const [nonce, setNonce] = useState(0);
  const [custom, setCustom] = useState("");

  const card = (handle: string, seed: string) => (
    <figure key={seed} style={{ margin: 0, textAlign: "center" }}>
      <img
        src={`/api/dev-card?handle=${encodeURIComponent(handle)}&seed=${encodeURIComponent(seed)}`}
        alt={handle}
        width={260}
        height={260}
        style={{ width: 260, height: 260, borderRadius: 12, background: "#171513" }}
      />
      <figcaption style={{ color: "#8a8172", fontSize: 12, marginTop: 6, fontFamily: "monospace" }}>@{handle}</figcaption>
    </figure>
  );

  return (
    <main style={{ minHeight: "100vh", background: "#0e0d0c", color: "#ece6d9", padding: 32, fontFamily: "system-ui, sans-serif" }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Gen 1 art — 3-tier test bench</h1>
        <button
          onClick={() => setNonce((n) => n + 1)}
          style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #3a3628", background: "#1c1a17", color: "#e6b93f", cursor: "pointer", fontSize: 14 }}
        >
          ↻ shuffle seeds
        </button>
      </header>

      {TIERS.map((t) => (
        <section key={t.label} style={{ marginBottom: 36 }}>
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>{t.label}</span>
            <span style={{ color: "#8a8172", fontSize: 13, marginLeft: 10 }}>{t.price}</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
            {t.handles.map((h, i) => card(h, seedFor(nonce, h, i)))}
          </div>
        </section>
      ))}

      <section style={{ marginTop: 8, borderTop: "1px solid #2b2823", paddingTop: 20 }}>
        <div style={{ marginBottom: 12, fontSize: 16, fontWeight: 600 }}>Try any handle</div>
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 15))}
          placeholder="type a handle (1–15 chars)"
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #3a3628", background: "#1c1a17", color: "#ece6d9", fontSize: 14, width: 280, fontFamily: "monospace" }}
        />
        {custom.length >= 1 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginTop: 16 }}>
            {[0, 1, 2, 3].map((i) => card(custom, seedFor(nonce, custom, i)))}
          </div>
        )}
      </section>
    </main>
  );
}
