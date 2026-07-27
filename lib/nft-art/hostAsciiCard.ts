// =============================================================================
//  hostAsciiCard.ts — deterministic SVG -> PNG for a Gen 1 ASCII card, then
//  upload + record + Cashtab icon. Parallel to lib/hostHandleCard.ts.
//
//  The ASCII card reuses the handle-card shell (charcoal ground, colored frame,
//  @handle label, PROOFOFWRITING footer) — only the art in the box changes from
//  isometric voxels to ASCII silhouette art. Because the label uses Courier Prime
//  and the art uses DejaVu Sans Mono, resvg loads BOTH bundled fonts explicitly
//  (loadSystemFonts:false) so the card rasterizes the same on any machine —
//  Vercel serverless included — regardless of installed system fonts.
//
//  Called BEST-EFFORT by the mint processor (seed = mint token id, blind reveal):
//  if anything here throws it returns null and the mint still succeeds — the card
//  is deterministic from the token id, so it's always reproducible via backfill.
//
//  Node runtime only (native resvg binary + fs; reads masks/library.json).
// =============================================================================

import { Resvg } from "@resvg/resvg-js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { adminDb } from "@/lib/db";
import { submitTokenIcon } from "../submitTokenIcon";
import { renderAsciiCard, CANVAS } from "./render";

const SIZE = Number(process.env.HANDLE_CARD_SIZE ?? CANVAS);
const BUCKET = process.env.HANDLE_CARD_BUCKET ?? "nft";
const PREFIX = process.env.HANDLE_CARD_PREFIX ?? "handle-cards";

// Static asset references: the bundler resolves and traces exactly these files.
// Courier Prime draws the @handle label + footer; DejaVu Sans Mono draws the
// ASCII art; GNU Unifont carries the exotic glyphs in the short-tier kaomoji
// (ツ, ಠ, ┻ …) that DejaVu lacks — resvg falls back to it per-glyph.
const LABEL_FONT_URL = new URL("../../assets/fonts/CourierPrime-Bold.ttf", import.meta.url);
const ART_FONT_URL = new URL("./fonts/DejaVuSansMono-Bold.ttf", import.meta.url);
const UNI_FONT_URL = new URL("./fonts/unifont.otf", import.meta.url);

const supabase = adminDb();

// Resolve the bundled font files once. resvg loads them explicitly so the card
// renders the same on any machine regardless of installed system fonts.
let _fonts: string[] | undefined;
function fontFiles(): string[] {
  if (_fonts !== undefined) return _fonts;
  const cands = [fileURLToPath(LABEL_FONT_URL), fileURLToPath(ART_FONT_URL), fileURLToPath(UNI_FONT_URL)];
  _fonts = cands.filter((p) => {
    const ok = existsSync(p);
    if (!ok) console.warn(`[hostAsciiCard] font not found at ${p} — falling back to system fonts`);
    return ok;
  });
  return _fonts;
}

/** Deterministic SVG -> PNG. Seed MUST be the mint token id. Exported for backfill. */
export function rasterizeAsciiCard(handle: string, tokenId: string): Buffer {
  const svg = renderAsciiCard(handle, { seed: tokenId, size: SIZE });
  const files = fontFiles();
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: SIZE },
    font: files.length
      ? { fontFiles: files, defaultFontFamily: "Courier Prime", loadSystemFonts: false }
      : { loadSystemFonts: true, defaultFontFamily: "monospace" },
  });
  return Buffer.from(resvg.render().asPng());
}

/** Render, upload, record on the handle row, return the public URL (or null). */
export async function hostAsciiCard(handle: string, tokenId: string): Promise<string | null> {
  try {
    const png = rasterizeAsciiCard(handle, tokenId);
    const path = `${PREFIX}/${tokenId}.png`;

    const up = await supabase.storage
      .from(BUCKET)
      .upload(path, png, { contentType: "image/png", upsert: true, cacheControl: "31536000" });
    if (up.error) {
      console.error("[hostAsciiCard] upload failed:", up.error.message);
      return null;
    }

    const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

    // Persist on the handle row — source of truth for the gallery, OG images, wallets.
    await supabase.from("handles").update({ image_url: url }).eq("token_id", tokenId);

    // Register the SAME PNG as the Cashtab token icon (best-effort).
    await submitTokenIcon(png, tokenId, {
      name: handle,
      ticker: handle,
      url: `https://proofofwriting.com/@${handle}`,
    });

    return url;
  } catch (e: any) {
    console.error("[hostAsciiCard] failed:", e?.message ?? e);
    return null;
  }
}
