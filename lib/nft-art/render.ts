// =============================================================================
//  render.ts — Gen 1 ASCII card (blind reveal), THREE price tiers
//
//  SAME CARD SHELL as lib/renderHandleCard.ts (charcoal ground, colored frame,
//  @handle label, footer) — only the art in the box changes. The art is chosen
//  by the handle's PRICE TIER (lib/handlePricing.ts), so the tier itself is the
//  collectible differentiator:
//
//    short  (1–5  chars, 1,000,000 XEC) -> minimalist kaomoji face   (kaomoji.ts)
//    mid    (6–10 chars,   100,000 XEC) -> ASCII scene: a subject in a
//                                          starfield                  (subjects.json)
//    base   (11–15 chars,   10,000 XEC) -> ASCII silhouette mask      (masks/library.json)
//
//  Tier is a PURE FUNCTION of the handle (priceForHandle), so nothing has to be
//  threaded through the DB or the rasterizer — the renderer derives it from the
//  handle it is already given.
//
//  Like the voxel engine every tier is seeded ONLY by the mint transaction id
//  (blind reveal), deterministic via sfc32(xmur3(seed)), emits SVG, and is
//  rasterized to PNG by resvg (lib/nft-art/hostAsciiCard.ts) — the runtime output
//  IS the reference; nothing is pixel-matched. Node-only (reads JSON from disk).
// =============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CHARCOAL, PAPER, DIM, COLORS, COLOR_NAMES, shade, esc, frame, labelBlock,
} from "../renderHandleCard";
import { displayHandle } from "../handleSkeleton";
import { priceForHandle, type Tier } from "../handlePricing";
import { KAOMOJI, isAsciiFace, type Face } from "./kaomoji";

// ---------------------------------------------------------------- PRNG (shared contract)
function xmur3(str: string) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
}
function sfc32(a: number, b: number, c: number, d: number) {
  return () => { a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0; let t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0; return (t >>> 0) / 4294967296; };
}
const rngFromSeed = (seed: string) => { const s = xmur3(seed); return sfc32(s(), s(), s(), s()); };
type Rng = () => number;

// warm paper ground for the rare white-background short-tier variant
const PAPER_WHITE = "#f4efe3";

// ---------------------------------------------------------------- grid (base/silhouette tier)
export const CANVAS = 1024;
const W = 64, H = 32;                    // grid, matches the offline bake
const CW = 16, CH = 32;                  // native cell px (2:1 ASCII aspect)
const FILLRAMP = ".:-=+*#%@";
const FONT_SIZE = 26;                    // fills the 16px cell in the mono face

// art box inside the card — same placement the voxels use in renderHandleCard
const ART_CY = 0.39, ART_MAXW = 0.74, ART_MAXH = 0.56;

// ---------------------------------------------------------------- baked masks (Node-only, base tier)
interface MaskEntry { char: string; bbox: [number, number, number, number]; cells: number[]; }
interface MaskFile { meta: Record<string, unknown>; masks: Record<string, MaskEntry>; }
let _lib: MaskFile | null = null;
let _names: string[] | null = null;
function library(): MaskFile {
  if (!_lib) {
    // new URL(..., import.meta.url) so Next's file tracer bundles the JSON into
    // the serverless function (same pattern hostHandleCard uses for its font).
    const libPath = fileURLToPath(new URL("./masks/library.json", import.meta.url));
    _lib = JSON.parse(readFileSync(libPath, "utf-8")) as MaskFile;
    _names = Object.keys(_lib.masks).sort();
  }
  return _lib;
}
function subjectNames(): string[] { library(); return _names!; }

// ---------------------------------------------------------------- scene subjects (Node-only, mid tier)
interface SceneSubject { name: string; category: string; width: number; height: number; art: string[]; }
interface SceneFile { meta: Record<string, unknown>; subjects: SceneSubject[]; }
let _scene: SceneSubject[] | null = null;
function sceneSubjects(): SceneSubject[] {
  if (!_scene) {
    const p = fileURLToPath(new URL("./subjects.json", import.meta.url));
    _scene = (JSON.parse(readFileSync(p, "utf-8")) as SceneFile).subjects;
  }
  return _scene;
}

// ---------------------------------------------------------------- fill (glyphgen1 port, base tier)
interface Cell { x: number; y: number; ch: string; col: string; }

// Map a per-cell brightness b (~0.45 dim .. ~1.2 bright edge) onto a shade of
// the trait color: bright -> lighter, dim -> toward charcoal. Keeps the art
// on the same 5-color palette as the handle card's frame/label.
function cellColor(color: string, b: number): string {
  const pct = Math.max(-0.42, Math.min(0.34, (b - 0.85) * 0.6));
  return shade(color, pct);
}

function fillMask(mask: MaskEntry, r: Rng, txid: string, color: string): Cell[] {
  const occ = new Uint8Array(W * H);
  let y0 = H, y1 = 0;
  for (const v of mask.cells) { occ[v] = 1; const y = v >> 6; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const isSet = (x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H && occ[y * W + x] === 1;

  const useTx = r() < 0.6;
  const out: Cell[] = [];
  // cells are stored ascending == row-major (y,x), matching the Python fill order
  for (const v of mask.cells) {
    const x = v & 63, y = v >> 6;
    const t = (y - y0) / Math.max(1, y1 - y0);
    let b = 0.85 - 0.4 * t;
    const edge = !(isSet(x + 1, y) && isSet(x - 1, y) && isSet(x, y + 1) && isSet(x, y - 1));
    let ch: string;
    if (edge) { b = Math.min(1, b + 0.35); ch = r() < 0.3 ? "@" : "#"; }
    else if (useTx) { ch = txid[Math.floor(r() * 64) % txid.length]; }
    else { ch = FILLRAMP[Math.min(8, Math.floor(2 + b * 6))]; }
    out.push({ x, y, ch, col: cellColor(color, b) });
  }
  return out;
}

// ---------------------------------------------------------------- art-in-box SVG (base tier)
function artGroup(cells: Cell[], S: number): string {
  if (!cells.length) return "";
  // native pixel bbox of the drawn cells (cell centers)
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const c of cells) {
    const px = c.x * CW + CW / 2, py = c.y * CH + CH / 2;
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
  }
  const bw = maxX - minX || 1, bh = maxY - minY || 1;
  const sc = Math.min((S * ART_MAXW) / bw, (S * ART_MAXH) / bh);
  const bcx = (minX + maxX) / 2, bcy = (minY + maxY) / 2;
  const tx = S / 2 - bcx * sc, ty = S * ART_CY - bcy * sc;

  let body = "";
  for (const c of cells) {
    if (c.ch === " ") continue;
    body += `<text x="${(c.x * CW + CW / 2).toFixed(1)}" y="${(c.y * CH + CH / 2).toFixed(1)}" fill="${c.col}">${esc(c.ch)}</text>`;
  }
  return (
    `<g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${sc.toFixed(4)})" ` +
    `font-family="DejaVu Sans Mono, monospace" font-weight="bold" font-size="${FONT_SIZE}" ` +
    `text-anchor="middle" dominant-baseline="central">${body}</g>`
  );
}

// ---------------------------------------------------------------- shared: a centered block of mono text
// Fits `lines` (a small ASCII/kaomoji drawing) into a maxW×maxH box centered at
// (cx,cy). `advance` is the per-character em-advance of the chosen font family so
// the width fit is right (DejaVu mono ≈0.60; Unifont leaves headroom for the
// occasional full-width CJK glyph in a famous kaomoji).
function textBlock(
  lines: readonly string[],
  o: { cx: number; cy: number; maxW: number; maxH: number; color: string; family: string; advance: number },
): string {
  const drawn = lines.filter((l) => l.length);
  if (!drawn.length) return "";
  const widest = Math.max(1, ...lines.map((l) => l.length));
  const n = lines.length;
  const LH = 1.14;                                  // line-height multiple
  const fsW = o.maxW / (widest * o.advance);
  const fsH = o.maxH / ((n - 1) * LH + 1);          // n baselines, last needs 1 em
  const fs = Math.min(fsW, fsH);
  const step = fs * LH;
  const y0 = o.cy - (step * (n - 1)) / 2;
  let body = "";
  lines.forEach((l, i) => {
    if (!l.length) return;
    body += `<text x="${o.cx.toFixed(1)}" y="${(y0 + i * step).toFixed(1)}" fill="${o.color}">${esc(l)}</text>`;
  });
  return (
    `<g font-family="${o.family}, monospace" font-weight="bold" font-size="${fs.toFixed(1)}" ` +
    `text-anchor="middle" dominant-baseline="central">${body}</g>`
  );
}

// ---------------------------------------------------------------- mid tier: subject in a starfield
const STARS = ["*", ".", "o", "+", "'", "`", "\u00b7"] as const; // last is · (renders in DejaVu)
function sceneArt(r: Rng, color: string, S: number): string {
  const dim = "#5a5750";
  const subjects = sceneSubjects();
  const subj = subjects[Math.floor(r() * subjects.length)];

  // ambient dust scattered across the box region (avoid the label band y>0.62)
  let amb = "";
  const N = 70;
  for (let i = 0; i < N; i++) {
    const x = 0.08 + r() * 0.84, y = 0.08 + r() * 0.50;
    const ch = STARS[Math.floor(r() * STARS.length)];
    const fs = 14 + Math.floor(r() * 22);
    const op = (0.20 + r() * 0.42).toFixed(2);
    amb += `<text x="${(x * S).toFixed(0)}" y="${(y * S).toFixed(0)}" font-family="DejaVu Sans Mono, monospace" font-size="${fs}" fill="${dim}" opacity="${op}" text-anchor="middle">${esc(ch)}</text>`;
  }
  // a few faint "planets" in the trait color for depth
  let planets = "";
  for (let i = 0; i < 3; i++) {
    const x = 0.16 + r() * 0.68, y = 0.10 + r() * 0.34;
    planets += `<text x="${(x * S).toFixed(0)}" y="${(y * S).toFixed(0)}" font-family="DejaVu Sans Mono, monospace" font-weight="bold" font-size="30" fill="${color}" opacity="0.55" text-anchor="middle">-O-</text>`;
  }
  // the subject, drawn on top in the trait color
  const subject = textBlock(subj.art, {
    cx: S / 2, cy: S * ART_CY, maxW: S * 0.62, maxH: S * 0.44,
    color, family: "DejaVu Sans Mono", advance: 0.60,
  });
  return amb + planets + subject;
}

// ---------------------------------------------------------------- short tier: minimalist kaomoji
function kaomojiArt(r: Rng, color: string, S: number): string {
  const face: Face = KAOMOJI[Math.floor(r() * KAOMOJI.length)];
  const ascii = isAsciiFace(face);
  // Unifont carries the exotic glyphs (ツ, ಠ, ┻); some are full-width, so give
  // its width fit extra headroom.
  return textBlock(face, {
    cx: S / 2, cy: S * ART_CY, maxW: S * 0.64, maxH: S * 0.42,
    color, family: ascii ? "DejaVu Sans Mono" : "Unifont", advance: ascii ? 0.60 : 0.74,
  });
}

// ---------------------------------------------------------------- label (color-parametrized)
// Same geometry as renderHandleCard's labelBlock, but the @handle and footer ink
// colors are passed in so the white-ground variant can render dark text on paper.
function labelBlockC(display: string, S: number, footer: string, labelColor: string, footerColor: string): string {
  const text = "@" + display;
  const fs = Math.min(S * 0.06, (S - S * 0.23) / (text.length * 0.6));
  return (
    `<text x="${S / 2}" y="${S * 0.80}" font-family="Courier Prime, monospace" font-weight="700" font-size="${fs.toFixed(0)}" text-anchor="middle" dominant-baseline="middle" fill="${labelColor}">${esc(text)}</text>` +
    `<text x="${S / 2}" y="${S * 0.90}" font-family="Courier Prime, monospace" font-weight="700" font-size="${(S * 0.019).toFixed(0)}" letter-spacing="${(S * 0.005).toFixed(1)}" text-anchor="middle" fill="${footerColor}">${esc(footer)}</text>`
  );
}

// ---------------------------------------------------------------- exports
export interface AsciiCardOptions { seed: string; size?: number; footer?: string; }

/** The revealed ASCII card. Seed MUST be the mint transaction id (blind reveal + verifiable).
 *  Which art engine runs is decided by the handle's price tier. */
export function renderAsciiCard(handle: string, opts: AsciiCardOptions): string {
  if (!opts.seed) throw new Error("renderAsciiCard requires opts.seed (the mint transaction id)");
  const S = opts.size ?? CANVAS;
  const footer = opts.footer ?? "PROOFOFWRITING";
  const display = displayHandle(handle);
  const txid = opts.seed;
  const tier = priceForHandle(handle).tier;
  const r = rngFromSeed(txid);

  // color rolls FIRST in every tier (keeps the base tier's roll order intact)
  const color = COLORS[Math.floor(r() * COLORS.length)];

  let art: string;
  let white = false;                               // rare white-ground short-tier variant
  if (tier === "short") {
    // ~10% of kaomoji cards invert to an ink-on-paper card. Rolled INSIDE the
    // short branch so mid/base roll order is untouched. On paper the face is
    // drawn in a darkened trait color for legibility.
    white = r() < 0.10;
    art = kaomojiArt(r, white ? shade(color, -0.34) : color, S);
  } else if (tier === "mid") {
    art = sceneArt(r, color, S);
  } else {
    const names = subjectNames();
    const subject = names[Math.floor(r() * names.length)];
    const cells = fillMask(library().masks[subject], r, txid, color);
    art = artGroup(cells, S);
  }

  const ground = white ? PAPER_WHITE : CHARCOAL;
  const label = white
    ? labelBlockC(display, S, footer, "#2b2823", "#7a7568")
    : labelBlock(display, S, footer);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">` +
    `<rect width="${S}" height="${S}" fill="${ground}"/>` +
    frame(S, color, white ? 0.8 : 0.5) +
    art +
    label +
    `</svg>`
  );
}

export interface AsciiCardTraits { tier: Tier; subject: string; color: string; colorName: string; background: "charcoal" | "paper"; }
/** The traits a (handle, token id) produces, without building the art. Same roll
 *  order as renderAsciiCard, so it replays exactly. */
export function asciiCardTraits(handle: string, seed: string): AsciiCardTraits {
  const tier = priceForHandle(handle).tier;
  const r = rngFromSeed(seed);
  const ci = Math.floor(r() * COLORS.length);
  const color = COLORS[ci], colorName = COLOR_NAMES[ci];
  let subject: string;
  let background: "charcoal" | "paper" = "charcoal";
  if (tier === "short") {
    if (r() < 0.10) background = "paper";          // same roll as renderAsciiCard's white variant
    subject = KAOMOJI[Math.floor(r() * KAOMOJI.length)].join(" / ");
  } else if (tier === "mid") {
    const subs = sceneSubjects();
    subject = subs[Math.floor(r() * subs.length)].name;
  } else {
    const names = subjectNames();
    subject = names[Math.floor(r() * names.length)];
  }
  return { tier, subject, color, colorName, background };
}
