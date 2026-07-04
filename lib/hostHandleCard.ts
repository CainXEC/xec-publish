// =============================================================================
//  hostHandleCard.ts  (WIRED — resvg rasterization + Supabase Storage)
//
//  Renders the deterministic handle card (seeded from the mint token id) to a
//  PNG, uploads it to Supabase Storage keyed by token id, records the public
//  URL on the handle row, and returns the URL.
//
//  Called BEST-EFFORT by the mint processor and by the grandfather claim: if
//  anything here throws, it returns null and the mint/claim still succeeds — the
//  card is deterministic from the token id, so it's always reproducible via the
//  backfill script (scripts/backfill-handle-cards.ts).
//
//  Runs on the Node runtime only (native resvg binary + fs). See the notes in
//  next.config.additions.md for the config keys Vercel needs.
//
//  Env:
//    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (required)
//    HANDLE_CARD_BUCKET    default "nft"        (must be a PUBLIC bucket)
//    HANDLE_CARD_PREFIX    default "handle-cards"
//    HANDLE_CARD_FONT_PATH optional ABSOLUTE path override (default: bundled font)
//    HANDLE_CARD_SIZE      default 1024
//
//  The default font is referenced via `new URL(..., import.meta.url)` so the
//  bundler traces exactly this one asset into the function (and ships it to
//  Vercel) instead of conservatively tracing the whole project.
// =============================================================================

import { renderHandleCard } from "./renderHandleCard";
import { createClient } from "@supabase/supabase-js";
import { Resvg } from "@resvg/resvg-js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SIZE = Number(process.env.HANDLE_CARD_SIZE ?? 1024);
const BUCKET = process.env.HANDLE_CARD_BUCKET ?? "nft";
const PREFIX = process.env.HANDLE_CARD_PREFIX ?? "handle-cards";

// Static asset reference: the bundler resolves and traces exactly this file.
const DEFAULT_FONT_URL = new URL(
  "../assets/fonts/CourierPrime-Bold.ttf",
  import.meta.url,
);

const supabase = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// Resolve the font file path once. resvg loads it explicitly, so the card renders
// the same on any machine regardless of installed system fonts. An optional
// HANDLE_CARD_FONT_PATH env var (absolute path) overrides the bundled default.
let _fontPath: string | null | undefined;
function fontPath(): string | null {
  if (_fontPath !== undefined) return _fontPath;
  const p = process.env.HANDLE_CARD_FONT_PATH?.trim()
    ? process.env.HANDLE_CARD_FONT_PATH.trim()
    : fileURLToPath(DEFAULT_FONT_URL);
  _fontPath = existsSync(p) ? p : null;
  if (!_fontPath) console.warn(`[hostHandleCard] font not found at ${p} — falling back to system monospace`);
  return _fontPath;
}

/** Deterministic SVG -> PNG. Exported so the backfill script can reuse it. */
export function rasterizeHandleCard(handle: string, tokenId: string): Buffer {
  const svg = renderHandleCard(handle, { seed: tokenId, size: SIZE });
  const fp = fontPath();
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: SIZE },
    font: fp
      ? { fontFiles: [fp], defaultFontFamily: "Courier Prime", loadSystemFonts: false }
      : { loadSystemFonts: true, defaultFontFamily: "monospace" },
  });
  return Buffer.from(resvg.render().asPng());
}

/** Render, upload, record on the handle row, return the public URL (or null). */
export async function hostHandleCard(handle: string, tokenId: string): Promise<string | null> {
  try {
    const png = rasterizeHandleCard(handle, tokenId);
    const path = `${PREFIX}/${tokenId}.png`;

    const up = await supabase.storage
      .from(BUCKET)
      .upload(path, png, { contentType: "image/png", upsert: true, cacheControl: "31536000" });
    if (up.error) {
      console.error("[hostHandleCard] upload failed:", up.error.message);
      return null;
    }

    const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

    // Persist on the handle row — source of truth for the gallery, OG images, wallets.
    // Best-effort: a miss here just means the backfill script picks it up later.
    await supabase.from("handles").update({ image_url: url }).eq("token_id", tokenId);

    return url;
  } catch (e: any) {
    console.error("[hostHandleCard] failed:", e?.message ?? e);
    return null;
  }
}
