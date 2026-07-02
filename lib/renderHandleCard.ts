// =============================================================================
//  renderHandleCard.ts  (FINAL — isometric voxel edition, blind reveal)
//
//  Produces the deterministic NFT card for a minted handle. The artwork is
//  seeded from the MINT TRANSACTION id (opts.seed), NOT the handle — so it
//  cannot be previewed before minting, but is fully reproducible/verifiable
//  afterward from the on-chain token id. The handle is only the label.
//
//  Traits (all derived from the seed, in this fixed order):
//    1. count  — uniform 1..1000 cubes (pure chance, equal odds per value)
//    2. color  — one of 5 (equal odds)
//    3. form   — uniform among the forms valid at that count (count-gated)
//
//  The mint pipeline rasterizes the returned SVG to PNG (resvg + Courier Prime)
//  and hosts it keyed by the token id.
//
//  Also exports renderMysteryCard() — the covered "mint to reveal" placeholder
//  the mint page shows before the reveal.
// =============================================================================

import { displayHandle } from "./handleSkeleton";

// ---------------------------------------------------------------- PRNG
function xmur3(str: string) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
}
function sfc32(a: number, b: number, c: number, d: number) {
  return () => { a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0; let t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0; return (t >>> 0) / 4294967296; };
}
const rngFromSeed = (seed: string) => { const s = xmur3(seed); return sfc32(s(), s(), s(), s()); };

// ---------------------------------------------------------------- palette
const CHARCOAL = "#171513", PAPER = "#ece6d9", DIM = "#8a8172";
const COLORS = ["#e6b93f", "#3e8d8a", "#9a5b7a", "#d2603f", "#4f7fd4"]; // gold, teal, plum, coral, blue
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function shade(hex: string, pct: number) {
  const n = parseInt(hex.slice(1), 16); let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = pct < 0 ? 0 : 255, p = Math.abs(pct);
  r = Math.round((f - r) * p) + r; g = Math.round((f - g) * p) + g; b = Math.round((f - b) * p) + b;
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// ---------------------------------------------------------------- voxel helpers
type Vox = [number, number, number];
type Rng = () => number;
function norm(v: Vox[]): Vox[] {
  if (!v.length) return [[0, 0, 0]];
  let mz = 1e9, mx = 1e9, my = 1e9;
  for (const p of v) { mz = Math.min(mz, p[2]); mx = Math.min(mx, p[0]); my = Math.min(my, p[1]); }
  return v.map((p) => [p[0] - mx, p[1] - my, p[2] - mz] as Vox);
}
function fitImplicit(pred: (x: number, y: number, z: number) => boolean, N: number): Vox[] {
  let res = Math.max(1, Math.round(Math.cbrt(N / 0.5))), best: Vox[] | null = null;
  for (let it = 0; it < 9; it++) {
    const v: Vox[] = [];
    for (let x = -res; x <= res; x++) for (let y = -res; y <= res; y++) for (let z = -res; z <= res; z++) if (pred(x / res, y / res, z / res)) v.push([x, y, z]);
    if (!best || Math.abs(v.length - N) < Math.abs(best.length - N)) best = v;
    if (!v.length) { res++; continue; }
    if (v.length < N * 0.8) res++; else if (v.length > N * 1.3) res--; else break;
    if (res < 1) { res = 1; break; }
  }
  return norm(best || [[0, 0, 0]]);
}
function fitSil(p2: (x: number, z: number) => boolean, N: number): Vox[] {
  const t = N < 70 ? 2 : 3; let res = Math.max(2, Math.round(Math.sqrt(N / t))), best: { cells: number[][]; c: number } | null = null;
  for (let it = 0; it < 10; it++) {
    const cells: number[][] = [];
    for (let x = -res; x <= res; x++) for (let z = -res; z <= res; z++) if (p2(x / res, z / res)) cells.push([x, z]);
    const cnt = cells.length * t;
    if (!best || Math.abs(cnt - N) < Math.abs(best.c - N)) best = { cells, c: cnt };
    if (!cells.length) { res++; continue; }
    if (cnt < N * 0.8) res++; else if (cnt > N * 1.3) res--; else break;
    if (res < 2) { res = 2; break; }
  }
  const out: Vox[] = []; for (const [x, z] of best!.cells) for (let y = 0; y < t; y++) out.push([x, y, z]);
  return norm(out);
}
const ngon = (n: number, ap: number) => (x: number, z: number) => { for (let k = 0; k < n; k++) { const phi = k * 2 * Math.PI / n + Math.PI / 2; if (x * Math.cos(phi) + z * Math.sin(phi) > ap) return false; } return true; };
function starVerts(m: number, Ro: number, Ri: number) { const v: number[][] = []; for (let k = 0; k < m; k++) { const ao = k * 2 * Math.PI / m - Math.PI / 2, ai = ao + Math.PI / m; v.push([Ro * Math.cos(ao), Ro * Math.sin(ao)]); v.push([Ri * Math.cos(ai), Ri * Math.sin(ai)]); } return v; }
function inPoly(px: number, pz: number, vs: number[][]) { let inside = false; for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) { const xi = vs[i][0], zi = vs[i][1], xj = vs[j][0], zj = vs[j][1]; if (((zi > pz) !== (zj > pz)) && (px < (xj - xi) * (pz - zi) / (zj - zi) + xi)) inside = !inside; } return inside; }

// ---------------------------------------------------------------- form library (55)
const G: Record<string, (r: Rng, N: number) => Vox[]> = {};
G.monument = () => [[0, 0, 0]];
// solids
G.sphere = (r, N) => fitImplicit((x, y, z) => x * x + y * y + z * z <= 1, N);
G.ellipsoid = (r, N) => { const a = .6 + r() * .4, b = .6 + r() * .4, c = .6 + r() * .4; return fitImplicit((x, y, z) => (x / a) ** 2 + (y / b) ** 2 + (z / c) ** 2 <= 1, N); };
G.octahedron = (r, N) => fitImplicit((x, y, z) => Math.abs(x) + Math.abs(y) + Math.abs(z) <= 1, N);
G.cube = (r, N) => fitImplicit((x, y, z) => Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= 0.92, N);
G.superegg = (r, N) => fitImplicit((x, y, z) => Math.abs(x) ** 3 + Math.abs(y) ** 3 + Math.abs(z) ** 3 <= 1, N);
G.cone = (r, N) => fitImplicit((x, y, z) => x * x + z * z <= ((1 - y) / 2) ** 2 && y >= -1 && y <= 1, N);
G.bicone = (r, N) => fitImplicit((x, y, z) => Math.abs(y) <= 1 - Math.sqrt(x * x + z * z), N);
G.cylinder = (r, N) => fitImplicit((x, y, z) => x * x + z * z <= 0.62 * 0.62 && Math.abs(y) <= 1, N);
G.capsule = (r, N) => fitImplicit((x, y, z) => { const cy = Math.max(-0.55, Math.min(0.55, y)); return x * x + (y - cy) ** 2 + z * z <= 0.42 * 0.42; }, N);
G.torus = (r, N) => fitImplicit((x, y, z) => (Math.sqrt(x * x + z * z) - 0.62) ** 2 + y * y <= 0.3 * 0.3, N);
G.pyramid = (r, N) => fitImplicit((x, y, z) => { const yy = (y + 1) / 2; return Math.max(Math.abs(x), Math.abs(z)) <= (1 - yy) && y >= -1 && y <= 1; }, N);
G.frustum = (r, N) => fitImplicit((x, y, z) => { const yy = (y + 1) / 2; return Math.max(Math.abs(x), Math.abs(z)) <= 0.9 - 0.45 * yy && Math.abs(y) <= 1; }, N);
G.prism = (r, N) => fitImplicit((x, y, z) => z >= -0.9 && z <= 1 - 2 * Math.abs(x) && Math.abs(y) <= 0.9, N);
G.dome = (r, N) => fitImplicit((x, y, z) => x * x + y * y + z * z <= 1 && y >= 0, N);
G.hourglass = (r, N) => fitImplicit((x, y, z) => x * x + z * z <= 0.16 + 0.72 * y * y && Math.abs(y) <= 1, N);
G.bowl = (r, N) => fitImplicit((x, y, z) => y >= 2 * (x * x + z * z) - 1 && y <= 0.9 && x * x + z * z <= 1, N);
G.gyroid = (r, N) => { const f = 3.1; return fitImplicit((x, y, z) => { const g = Math.sin(x * f) * Math.cos(y * f) + Math.sin(y * f) * Math.cos(z * f) + Math.sin(z * f) * Math.cos(x * f); return Math.abs(g) < 0.7 && x * x + y * y + z * z <= 1; }, N); };
G.schwarz = (r, N) => { const f = 3.0; return fitImplicit((x, y, z) => Math.abs(Math.cos(x * f) + Math.cos(y * f) + Math.cos(z * f)) < 0.62 && x * x + y * y + z * z <= 1, N); };
// silhouettes
G.heart = (r, N) => fitSil((x, z) => { const hx = x * 1.25, hy = z * 1.25; return (hx * hx + hy * hy - 1) ** 3 - hx * hx * hy * hy * hy <= 0; }, N);
G.star5 = (r, N) => { const vs = starVerts(5, 1, 0.4); return fitSil((x, z) => inPoly(x, z, vs), N); };
G.star6 = (r, N) => { const vs = starVerts(6, 1, 0.5); return fitSil((x, z) => inPoly(x, z, vs), N); };
G.crescent = (r, N) => fitSil((x, z) => (x * x + z * z <= 1) && !(((x - 0.5) ** 2 + z * z) <= 0.8 * 0.8), N);
G.hexagon = (r, N) => fitSil(ngon(6, 0.87), N);
G.pentagon = (r, N) => fitSil(ngon(5, 0.82), N);
G.octagon = (r, N) => fitSil(ngon(8, 0.92), N);
G.cross = (r, N) => fitSil((x, z) => (Math.abs(x) <= 0.34 || Math.abs(z) <= 0.34) && Math.max(Math.abs(x), Math.abs(z)) <= 1, N);
G.triangle = (r, N) => fitSil((x, z) => z >= -0.9 && z <= 1 - 2 * Math.abs(x), N);
G.diamond2d = (r, N) => fitSil((x, z) => Math.abs(x) + Math.abs(z) <= 1, N);
G.arrow = (r, N) => fitSil((x, z) => (z >= 0 && z <= 1 - 1.6 * Math.abs(x)) || (Math.abs(x) <= 0.28 && z < 0 && z >= -1), N);
G.infinity = (r, N) => fitSil((x, z) => ((x - 0.42) ** 2 + z * z <= 0.42 * 0.42) || ((x + 0.42) ** 2 + z * z <= 0.42 * 0.42), N);
G.flower = (r, N) => fitSil((x, z) => { const a = Math.atan2(z, x); return Math.hypot(x, z) <= 0.33 + 0.62 * Math.abs(Math.sin(3 * a)); }, N);
G.gear = (r, N) => fitSil((x, z) => { const a = Math.atan2(z, x), rr = Math.hypot(x, z), outer = 0.72 + 0.16 * (Math.cos(9 * a) > 0 ? 1 : 0); return rr <= outer && rr >= 0.3; }, N);
G.spiral = (r, N) => fitSil((x, z) => { const a = Math.atan2(z, x), rr = Math.hypot(x, z); return rr <= 1 && Math.abs(((rr * 3.5) - (a / (2 * Math.PI))) % 1 - 0.5) < 0.18; }, N);
// architecture
G.arch = (r, N) => { const Wd = Math.max(4, Math.round(Math.cbrt(N)) + 2), H = Wd + 1, t = Math.max(2, Math.round(N / (Wd * H * 1.4))); const o: Vox[] = []; for (let y = 0; y < t; y++) { for (let z = 0; z < H; z++) { o.push([0, y, z]); o.push([Wd - 1, y, z]); } for (let x = 0; x < Wd; x++) o.push([x, y, H - 1]); } return norm(o); };
G.tower = (r, N) => { const cells = new Map<string, number>(), k = (x: number, y: number) => x + "," + y; cells.set("0,0", 1); let cols: number[][] = [[0, 0]], c = 1; const R = Math.max(1, Math.round(Math.sqrt(N) / 2.4)); let g = 0; while (c < N && g++ < N * 40) { if (r() < 0.6) { const q = cols[Math.floor(r() * cols.length)]; cells.set(k(q[0], q[1]), cells.get(k(q[0], q[1]))! + 1); c++; } else { const q = cols[Math.floor(r() * cols.length)], d = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(r() * 4)], nx = q[0] + d[0], ny = q[1] + d[1]; if (Math.abs(nx) <= R && Math.abs(ny) <= R && !cells.has(k(nx, ny))) { cells.set(k(nx, ny), 1); cols.push([nx, ny]); c++; } } } const o: Vox[] = []; for (const [key, h] of cells) { const [x, y] = key.split(",").map(Number); for (let z = 0; z < h; z++) o.push([x, y, z]); } return norm(o); };
G.staircase = (r, N) => { const w = Math.max(2, Math.round(Math.sqrt(N / 4))), steps = Math.max(3, Math.round(N / (w * 3))); const o: Vox[] = []; const seen = new Set<string>(); const put = (v: Vox) => { const kk = v.join(","); if (!seen.has(kk)) { seen.add(kk); o.push(v); } }; for (let s = 0; s < steps; s++) for (let y = 0; y < w; y++) { put([s, y, s]); put([s, y, Math.max(0, s - 1)]); put([s, y, 0]); } return norm(o); };
G.lattice = (r, N) => { const E = Math.max(3, Math.round(Math.cbrt(N / 4)) + 2), o: Vox[] = [], edge = (v: Vox) => { let c = 0; if (v[0] === 0 || v[0] === E - 1) c++; if (v[1] === 0 || v[1] === E - 1) c++; if (v[2] === 0 || v[2] === E - 1) c++; return c >= 2; }; for (let x = 0; x < E; x++) for (let y = 0; y < E; y++) for (let z = 0; z < E; z++) if (edge([x, y, z])) o.push([x, y, z]); return norm(o); };
G.ziggurat = (r, N) => { const L = Math.max(2, Math.round(Math.cbrt(N / 3))), o: Vox[] = []; for (let l = 0; l < L; l++) { const s = L - l; for (let x = -s; x <= s; x++) for (let y = -s; y <= s; y++) o.push([x, y, l]); } return norm(o); };
G.bridge = (r, N) => { const Wd = Math.max(6, Math.round(Math.cbrt(N)) + 4), H = Math.max(3, Math.round(Wd / 2)), t = Math.max(2, Math.round(N / (Wd * 4))); const o: Vox[] = []; for (let y = 0; y < t; y++) { for (let x = 0; x < Wd; x++) { o.push([x, y, H]); o.push([x, y, H + 1]); } for (const px of [0, Math.floor(Wd / 2), Wd - 1]) for (let z = 0; z < H; z++) o.push([px, y, z]); } return norm(o); };
G.columns = (r, N) => { const n = Math.max(2, Math.round(Math.cbrt(N / 6))), H = Math.max(4, Math.round(Math.cbrt(N)) + 2), t = 2, gap = 2; const o: Vox[] = []; const span = (n - 1) * gap; for (let i = 0; i < n; i++) for (let y = 0; y < t; y++) for (let z = 0; z < H; z++) o.push([i * gap, y, z]); for (let x = 0; x <= span; x++) for (let y = 0; y < t; y++) { o.push([x, y, H]); o.push([x, y, 0]); } return norm(o); };
G.helix = (r, N) => { const R = Math.max(3, Math.round(Math.cbrt(N) / 1.05)), o: Vox[] = [], set = new Set<string>(), put = (v: Vox) => { const k = v.join(","); if (!set.has(k) && v[2] >= 0) { set.add(k); o.push(v); } }; const rise = 0.14; let a = 0, guard = 0; while (o.length < N && guard++ < N * 12) { const x = Math.round(R * Math.cos(a)), y = Math.round(R * Math.sin(a)), z = Math.round(a * rise * R); put([x, y, z]); put([x, y, z + 1]); a += 0.32 / R; } return norm(o); };
G.castle = (r, N) => { const Wd = Math.max(3, Math.round(Math.cbrt(N)) + 1), H = Math.max(3, Wd); const o: Vox[] = []; const wall = (x: number, y: number) => x === 0 || x === Wd - 1 || y === 0 || y === Wd - 1; for (let x = 0; x < Wd; x++) for (let y = 0; y < Wd; y++) for (let z = 0; z < H; z++) if (wall(x, y)) o.push([x, y, z]); for (let x = 0; x < Wd; x++) for (let y = 0; y < Wd; y++) if (wall(x, y) && (x + y) % 2 === 0) o.push([x, y, H]); return norm(o); };
G.tunnel = (r, N) => { const Wd = Math.max(4, Math.round(Math.cbrt(N)) + 2), Hh = Wd, Dp = Wd, rr = Math.max(1, Wd / 3); const o: Vox[] = []; const cy = (Hh - 1) / 2, cz = (Dp - 1) / 2; for (let x = 0; x < Wd; x++) for (let y = 0; y < Hh; y++) for (let z = 0; z < Dp; z++) if ((y - cy) ** 2 + (z - cz) ** 2 > rr * rr) o.push([x, y, z]); return norm(o); };
G.checker = (r, N) => { const Wd = Math.max(4, Math.round(Math.sqrt(N / 2))), o: Vox[] = []; for (let x = 0; x < Wd; x++) for (let y = 0; y < Wd; y++) for (let z = 0; z < 2; z++) if ((x + y + z) % 2 === 0) o.push([x, y, z]); return norm(o); };
G.monolith = (r, N) => { const H = Math.max(5, Math.round(Math.cbrt(N) * 2.2)), Wd = Math.max(1, Math.round(H / 4)), Dp = Math.max(1, Math.round(H / 9)); const o: Vox[] = []; for (let x = 0; x < Wd; x++) for (let y = 0; y < Dp; y++) for (let z = 0; z < H; z++) o.push([x, y, z]); return norm(o); };
// organic / fractal
G.blob = (r, N) => { const set = new Set(["0,0,0"]), occ: Vox[] = [[0, 0, 0]], D = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]; let g = 0; while (set.size < N && g++ < N * 60) { const v = occ[Math.floor(r() * occ.length)], d = D[Math.floor(r() * 6)], n: Vox = [v[0] + d[0], v[1] + d[1], v[2] + d[2]]; if (n[2] < 0) continue; const kk = n.join(","); if (!set.has(kk)) { set.add(kk); occ.push(n); } } return norm(occ); };
G.symmetric = (r, N) => { const h = G.blob(r, Math.ceil(N / 2)), mx = Math.max(...h.map((v) => v[0])), set = new Set<string>(), o: Vox[] = []; for (const v of h) for (const w of [v, [mx - v[0], v[1], v[2]] as Vox]) { const kk = w.join(","); if (!set.has(kk)) { set.add(kk); o.push(w); } } return norm(o); };
G.coral = (r, N) => { const set = new Set(["0,0,0"]), o: Vox[] = [[0, 0, 0]]; let tips: Vox[] = [[0, 0, 0]], c = 1, g = 0; const add = (n: Vox) => { const kk = n.join(","); if (!set.has(kk) && n[2] >= 0) { set.add(kk); o.push(n); c++; return true; } return false; }; while (c < N && tips.length && g++ < N * 30) { const ti = Math.floor(r() * tips.length), t = tips[ti]; const up = [[0, 0, 1], [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 0, 0], [0, 1, 0]][Math.floor(r() * 7)]; const n: Vox = [t[0] + up[0], t[1] + up[1], t[2] + up[2]]; if (add(n)) { add([n[0] + 1, n[1], n[2]]); tips[ti] = n; if (r() < 0.3) tips.push(n.slice() as Vox); } else tips.splice(ti, 1); } return norm(o); };
G.dendrite = (r, N) => G.coral(r, Math.round(N * 0.8));
G.worm = (r, N) => { const o: Vox[] = [], set = new Set<string>(); let p: Vox = [0, 0, 0], dir = [1, 0, 0]; const put = (v: Vox) => { const kk = v.join(","); if (!set.has(kk) && v[2] >= 0) { set.add(kk); o.push(v); } }; let g = 0; while (o.length < N && g++ < N * 8) { for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) put([p[0], p[1] + dx, p[2] + dy]); if (r() < 0.35) { const dirs = [[1, 0, 0], [0, 0, 1], [0, 0, -1], [-1, 0, 0]]; dir = dirs[Math.floor(r() * dirs.length)]; } p = [p[0] + dir[0], p[1], p[2] + dir[2]]; if (p[2] < 0) p[2] = 0; } return norm(o); };
G.shell = (r, N) => { const solid = G.blob(r, Math.round(N * 1.8)), set = new Set(solid.map((v) => v.join(","))); const D = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]; let s = solid.filter((v) => D.some((d) => !set.has([v[0] + d[0], v[1] + d[1], v[2] + d[2]].join(",")))); s = s.filter(() => r() > 0.12); return norm(s); };
G.mountain = (r, N) => { const W = Math.max(4, Math.round(Math.sqrt(N / 4))), o: Vox[] = [], ph = [r() * 6, r() * 6]; for (let x = -W; x <= W; x++) for (let y = -W; y <= W; y++) { const d = Math.hypot(x, y) / W; let h = Math.round((1 - d) * W * 1.3 + 2 * Math.sin(x * 0.9 + ph[0]) + 2 * Math.sin(y * 0.9 + ph[1])); if (h < 1) h = d < 0.95 ? 1 : 0; for (let z = 0; z < h; z++) o.push([x, y, z]); } return norm(o); };
G.menger = (r, N) => { const L = N < 120 ? 1 : 2, size = 3 ** L, inside = (x: number, y: number, z: number) => { for (let i = 0; i < L; i++) { const a = (x % 3 === 1 ? 1 : 0) + (y % 3 === 1 ? 1 : 0) + (z % 3 === 1 ? 1 : 0); if (a >= 2) return false; x = (x / 3) | 0; y = (y / 3) | 0; z = (z / 3) | 0; } return true; }, o: Vox[] = []; for (let x = 0; x < size; x++) for (let y = 0; y < size; y++) for (let z = 0; z < size; z++) if (inside(x, y, z)) o.push([x, y, z]); return norm(o); };
G.vicsek = (r, N) => { const L = N < 80 ? 1 : 2, size = 3 ** L, inside = (x: number, y: number, z: number) => { for (let i = 0; i < L; i++) { const a = (x % 3 === 1 ? 1 : 0) + (y % 3 === 1 ? 1 : 0) + (z % 3 === 1 ? 1 : 0); if (a < 2) return false; x = (x / 3) | 0; y = (y / 3) | 0; z = (z / 3) | 0; } return true; }, o: Vox[] = []; for (let x = 0; x < size; x++) for (let y = 0; y < size; y++) for (let z = 0; z < size; z++) if (inside(x, y, z)) o.push([x, y, z]); return norm(o); };
G.rune = (r, N) => { const W = 5, H = 7, grid: number[][] = []; for (let z = 0; z < H; z++) for (let x = 0; x < Math.ceil(W / 2); x++) { if (r() < 0.5) { grid.push([x, z]); grid.push([W - 1 - x, z]); } } if (!grid.length) grid.push([2, 3]); const t = N < 70 ? 2 : 3, o: Vox[] = [], uniq = new Set<string>(); for (const [x, z] of grid) { const kk = x + "," + z; if (uniq.has(kk)) continue; uniq.add(kk); for (let y = 0; y < t; y++) o.push([x, y, z]); } return norm(o); };

// ---------------------------------------------------------------- count-gating
//  Each form declares the minimum cube count at which it reads well. Count is
//  rolled FIRST (uniform 1..1000), then a form is chosen uniformly among those
//  valid for that count — so counts stay uniform and forms don't skew the odds.
const MIN2 = "blob cube tower monolith worm sphere cylinder pyramid cone prism staircase octahedron capsule frustum dome symmetric coral dendrite superegg bicone ellipsoid mountain".split(" ");
const MIN40 = "heart star5 star6 crescent hexagon pentagon octagon cross triangle diamond2d arrow infinity flower gear spiral arch columns bridge castle tunnel checker lattice ziggurat helix shell gyroid schwarz torus rune bowl hourglass".split(" ");
const MIN15 = ["menger", "vicsek"];
const FORMS: { name: string; min: number }[] = [
  ...MIN2.map((name) => ({ name, min: 2 })),
  ...MIN15.map((name) => ({ name, min: 15 })),
  ...MIN40.map((name) => ({ name, min: 40 })),
];
function pickForm(r: Rng, N: number): string {
  if (N <= 1) return "monument";
  const valid = FORMS.filter((f) => N >= f.min);
  if (!valid.length) return "blob";
  return valid[Math.floor(r() * valid.length)].name;
}

// ---------------------------------------------------------------- render (face-culled)
function facesAt(sx: number, sy: number, w: number, color: string) {
  const half = w / 2, q = w / 4, ch = w * 0.53;
  return [
    [[[sx, sy - q], [sx + half, sy], [sx, sy + q], [sx - half, sy]], shade(color, 0.24)],
    [[[sx - half, sy], [sx, sy + q], [sx, sy + q + ch], [sx - half, sy + ch]], shade(color, -0.34)],
    [[[sx + half, sy], [sx, sy + q], [sx, sy + q + ch], [sx + half, sy + ch]], color],
  ] as [number[][], string][];
}
function renderVoxels(voxels: Vox[], color: string, S: number): string {
  const w = 60, half = w / 2, q = w / 4, ch = w * 0.53;
  const occ = new Set(voxels.map((v) => v.join(",")));
  const items = voxels.map(([x, y, z]) => ({ x, y, z, sx: (x - y) * half, sy: (x + y) * q - z * ch, key: x + y + z + z * 0.0001 }));
  items.sort((a, b) => a.key - b.key);
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  const drawn: [number[][], string][][] = [];
  for (const it of items) {
    const f = facesAt(it.sx, it.sy, w, color); const keep: [number[][], string][] = [];
    if (!occ.has(`${it.x},${it.y},${it.z + 1}`)) keep.push(f[0]);       // top (+z)
    if (!occ.has(`${it.x},${it.y + 1},${it.z}`)) keep.push(f[1]);       // left (+y)
    if (!occ.has(`${it.x + 1},${it.y},${it.z}`)) keep.push(f[2]);       // right (+x)
    for (const [poly] of keep) for (const p of poly) { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); }
    drawn.push(keep);
  }
  const bw = maxX - minX || 1, bh = maxY - minY || 1, maxW = S * 0.74, maxH = S * 0.56, MAXSC = S * 0.32 / w;
  const sc = Math.min(maxW / bw, maxH / bh, MAXSC), bcx = (minX + maxX) / 2, bcy = (minY + maxY) / 2, CX = S / 2, CY = S * 0.39;
  const tx = (p: number[]) => [(p[0] - bcx) * sc + CX, (p[1] - bcy) * sc + CY];
  const cubePx = w * sc, sw = cubePx < 6 ? 0 : Math.min(1.5, cubePx * 0.045);
  const sa = sw > 0.3 ? ` stroke="${CHARCOAL}" stroke-width="${sw.toFixed(2)}" stroke-linejoin="round"` : "";
  let o = "";
  for (const keep of drawn) for (const [poly, col] of keep) o += `<polygon points="${poly.map((p) => { const c = tx(p); return c[0].toFixed(1) + "," + c[1].toFixed(1); }).join(" ")}" fill="${col}"${sa}/>`;
  return o;
}

function frame(S: number, color: string, opacity: number) {
  const fi = Math.round(S * 0.043), fr = Math.round(S * 0.04);
  return `<rect x="${fi}" y="${fi}" width="${S - fi * 2}" height="${S - fi * 2}" rx="${fr}" fill="none" stroke="${color}" stroke-width="${(S * 0.005).toFixed(1)}" opacity="${opacity}"/>`;
}
function labelBlock(display: string, S: number, footer: string) {
  const text = "@" + display; const fs = Math.min(S * 0.06, (S - S * 0.23) / (text.length * 0.6));
  return (
    `<text x="${S / 2}" y="${S * 0.80}" font-family="Courier Prime, monospace" font-weight="700" font-size="${fs.toFixed(0)}" text-anchor="middle" dominant-baseline="middle" fill="${PAPER}">${esc(text)}</text>` +
    `<text x="${S / 2}" y="${S * 0.90}" font-family="Courier Prime, monospace" font-weight="700" font-size="${(S * 0.019).toFixed(0)}" letter-spacing="${(S * 0.005).toFixed(1)}" text-anchor="middle" fill="${DIM}">${esc(footer)}</text>`
  );
}

// ---------------------------------------------------------------- exports
export interface HandleCardOptions { seed: string; size?: number; footer?: string; }

/** The revealed card. Seed MUST be the mint transaction id (blind reveal + verifiable). */
export function renderHandleCard(handle: string, opts: HandleCardOptions): string {
  const S = opts.size ?? 1024;
  const footer = opts.footer ?? "PROOFOFWRITING";
  const display = displayHandle(handle);
  if (!opts.seed) throw new Error("renderHandleCard requires opts.seed (the mint transaction id)");
  const r = rngFromSeed(opts.seed);

  const N = 1 + Math.floor(r() * 1000);          // 1..1000, uniform
  const color = COLORS[Math.floor(r() * COLORS.length)];
  const formName = pickForm(r, N);
  let voxels: Vox[];
  try { voxels = (G[formName] || G.blob)(r, N); if (!voxels || !voxels.length) voxels = [[0, 0, 0]]; }
  catch { voxels = [[0, 0, 0]]; }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">` +
    `<rect width="${S}" height="${S}" fill="${CHARCOAL}"/>` +
    frame(S, color, 0.5) +
    renderVoxels(voxels, color, S) +
    labelBlock(display, S, footer) +
    `</svg>`
  );
}

/** The traits a token id produces — count / color / form — without building geometry.
 *  Same roll order as renderHandleCard, so it's exact. Handy for gallery captions. */
export interface CardTraits { count: number; color: string; colorName: string; form: string; }
const COLOR_NAMES = ["gold", "teal", "plum", "coral", "blue"];
export function handleCardTraits(seed: string): CardTraits {
  const r = rngFromSeed(seed);
  const count = 1 + Math.floor(r() * 1000);
  const ci = Math.floor(r() * COLORS.length);
  const form = pickForm(r, count);
  return { count, color: COLORS[ci], colorName: COLOR_NAMES[ci], form };
}

/** The covered placeholder shown on the mint page before payment (no art). */
export function renderMysteryCard(handle: string, opts: { size?: number; footer?: string } = {}): string {
  const S = opts.size ?? 1024;
  const footer = opts.footer ?? "MINT TO REVEAL";
  const display = displayHandle(handle) || "yourname";
  const qx = S / 2, qy = S * 0.35, qs = S * 0.22;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">` +
    `<rect width="${S}" height="${S}" fill="${CHARCOAL}"/>` +
    frame(S, DIM, 0.4) +
    // a covered/embossed panel with a question mark
    `<rect x="${qx - qs}" y="${qy - qs}" width="${qs * 2}" height="${qs * 2}" rx="${S * 0.03}" fill="#211d18" stroke="#3a352e" stroke-width="${S * 0.004}"/>` +
    `<text x="${qx}" y="${qy}" font-family="Courier Prime, monospace" font-weight="700" font-size="${S * 0.2}" text-anchor="middle" dominant-baseline="central" fill="#3a352e">?</text>` +
    labelBlock(display, S, footer) +
    `</svg>`
  );
}
