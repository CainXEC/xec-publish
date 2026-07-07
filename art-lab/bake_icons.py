#!/usr/bin/env python3
"""bake_icons.py — the OFFLINE FREEZE step for the 3-SOURCE base-tier library.

Bakes silhouette masks for the base (10,000 XEC) tier from THREE permissively
licensed monochrome sources, all at the same frozen 46x26 sampling params, into
one lib/nft-art/masks/library.json. The runtime TS renderer consumes the JSON
only and NEVER re-samples a glyph (the inviolable approved-art rule).

Sources (keys are prefixed so the three sets never collide):
  - Noto Emoji          (OFL)        -> unprefixed keys   (noto_library_curated.json)
  - Tabler Icons filled (MIT)        -> "ti-<name>" keys  (tabler_filled_curated.json
                                                           + tabler_filled_codepoints.json)
  - Material Symbols filled (Apache-2.0) -> "ms-<name>" keys (material_filled_curated.json)

The emoji masks reproduce byte-identically to the previous emoji-only bake
(same sampler, params, and source), so the freeze is preserved; the icon masks
are simply added. Fonts live in art-lab/*.ttf and are committed for provenance.

Run: python3 bake_icons.py
"""
import json, os, sys
import PIL
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, '..', 'lib', 'nft-art', 'masks'))

# Grid + frozen library sampling params (identical to bake_masks.py / noto1).
W, H = 64, 32
LIB_MAX_COLS = 46
LIB_MAX_ROWS = 26
THRESHOLD = 110
RENDER_PX = 560

NOTO_TTF = os.path.join(HERE, 'NotoEmoji.ttf')
TABLER_TTF = os.path.join(HERE, 'tabler-icons-filled.ttf')
MATERIAL_TTF = os.path.join(HERE, 'material-symbols-filled.ttf')


# ---------------------------------------------------------------- sampler (font-parametric)
# Byte-for-byte the same procedure as noto1.glyph_mask_centered, but the font is
# a parameter so the identical freeze applies to every source.
def glyph_mask_centered(font, ch, max_cols=LIB_MAX_COLS, max_rows=LIB_MAX_ROWS):
    img = Image.new('L', (900, 900), 0)
    ImageDraw.Draw(img).text((450, 450), ch, font=font, fill=255, anchor='mm')
    bb = img.getbbox()
    if not bb:
        return set()
    gx0, gy0, gx1, gy1 = bb
    gw, gh = gx1 - gx0, gy1 - gy0
    s = max(gw / max_cols, gh / (2 * max_rows))
    cols = max(1, int(gw / s))
    rows = max(1, int(gh / (2 * s)))
    px = img.load()
    raw = set()
    for cy in range(rows):
        for cx in range(cols):
            sx = int(gx0 + (cx + 0.5) * s)
            sy = int(gy0 + (cy + 0.5) * 2 * s)
            tot = 0
            n = 0
            for dy in (-2, 0, 2):
                for dx in (-2, 0, 2):
                    x, y = sx + dx, sy + dy
                    if 0 <= x < 900 and 0 <= y < 900:
                        tot += px[x, y]
                        n += 1
            if n and tot / n > THRESHOLD:
                raw.add((cx, cy))
    if not raw:
        return set()
    xs = [x for (x, _) in raw]
    ys = [y for (_, y) in raw]
    mw, mh = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
    ox = (W - mw) // 2 - min(xs)
    oy = (H - mh) // 2 - min(ys)
    return {(x + ox, y + oy) for (x, y) in raw}


def pack(cells):
    return sorted(y * W + x for (x, y) in cells)


def bbox_of(cells):
    xs = [x for (x, _) in cells]
    ys = [y for (_, y) in cells]
    return [min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1]


# ---------------------------------------------------------------- tofu guard (emoji only)
# NotoEmoji does not cover every curated codepoint; a missing glyph renders as
# the .notdef box. Skip any glyph byte-identical to .notdef. Tabler/Material only
# bake glyphs already present in their cmap, so they cannot tofu.
_TOFU_FONT = ImageFont.truetype(NOTO_TTF, 100)


def _glyph_bytes(char):
    im = Image.new('L', (160, 160), 0)
    ImageDraw.Draw(im).text((20, 20), char, font=_TOFU_FONT, fill=255)
    return im.tobytes()


_NOTDEF = _glyph_bytes('\ue123')


def is_tofu(char):
    return _glyph_bytes(char) == _NOTDEF


def bake_source(font_path, items, prefix, tofu_check):
    """items: list of (key, char). Returns {prefixed_key: mask}, skipped counts."""
    font = ImageFont.truetype(font_path, RENDER_PX)
    masks = {}
    tofu = []
    empty = []
    for key, char in items:
        if tofu_check and is_tofu(char):
            tofu.append(key)
            continue
        m = glyph_mask_centered(font, char)
        if not m:
            empty.append(key)
            continue
        cells = pack(m)
        masks[prefix + key] = {'char': char, 'bbox': bbox_of(m), 'cells': cells}
    return masks, tofu, empty


def emoji_items():
    lib = json.load(open(os.path.join(HERE, 'noto_library_curated.json'), encoding='utf-8'))
    return [(name, lib[name]) for name in sorted(lib)]


def tabler_items():
    names = json.load(open(os.path.join(HERE, 'tabler_filled_curated.json'), encoding='utf-8'))
    cp = json.load(open(os.path.join(HERE, 'tabler_filled_codepoints.json'), encoding='utf-8'))
    out = []
    for name in sorted(names):
        if name in cp:
            out.append((name, chr(int(cp[name], 16))))
    return out


def material_items():
    from fontTools.ttLib import TTFont
    names = set(json.load(open(os.path.join(HERE, 'material_filled_curated.json'), encoding='utf-8')))
    cmap = TTFont(MATERIAL_TTF).getBestCmap()
    n2c = {}
    for codepoint, gname in cmap.items():
        n2c.setdefault(gname, codepoint)
    return [(name, chr(n2c[name])) for name in sorted(names) if name in n2c]


def write_json(path, obj):
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(',', ':'))
        fh.write('\n')


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    masks = {}
    counts = {}

    for label, font_path, items, prefix, tofu in [
        ('emoji', NOTO_TTF, emoji_items(), '', True),
        ('tabler', TABLER_TTF, tabler_items(), 'ti-', False),
        ('material', MATERIAL_TTF, material_items(), 'ms-', False),
    ]:
        m, tf, em = bake_source(font_path, items, prefix, tofu)
        masks.update(m)
        counts[label] = len(m)
        note = ''
        if tf:
            note += ' (%d tofu)' % len(tf)
        if em:
            note += ' (%d empty)' % len(em)
        print('  %-9s %4d masks%s' % (label, len(m), note))

    meta = {
        'generator': 'art-lab/bake_icons.py',
        'sources': {
            'emoji': {'font': 'NotoEmoji.ttf', 'license': 'OFL', 'prefix': ''},
            'tabler': {'font': 'tabler-icons-filled.ttf', 'license': 'MIT', 'prefix': 'ti-'},
            'material': {'font': 'material-symbols-filled.ttf', 'license': 'Apache-2.0', 'prefix': 'ms-'},
        },
        'grid': [W, H],
        'sampling': {'max_cols': LIB_MAX_COLS, 'max_rows': LIB_MAX_ROWS,
                     'threshold': THRESHOLD, 'render_px': RENDER_PX},
        'cell_encoding': 'int v = y*%d + x; x = v %% %d, y = v // %d' % (W, W, W),
        'pillow': PIL.__version__,
        'per_source': counts,
        'count': len(masks),
    }
    out = {'meta': meta, 'masks': masks}
    lib_path = os.path.join(OUT_DIR, 'library.json')
    write_json(lib_path, out)
    print('wrote %s (%d masks total, x5 colors = %d effective)' % (
        os.path.relpath(lib_path), len(masks), len(masks) * 5))


if __name__ == '__main__':
    sys.exit(main())
