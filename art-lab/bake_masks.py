#!/usr/bin/env python3
"""bake_masks.py — the OFFLINE FREEZE step of the Gen 1 art engine.

Silhouette masks are the font-dependent, sampling-dependent part of a piece.
This script derives them ONCE from NotoEmoji.ttf at frozen sampling params and
writes them to lib/nft-art/masks/ as JSON. The runtime TS renderer consumes the
JSON only and NEVER re-samples a glyph — that is the inviolable approved-art
rule: a mask, once baked, is frozen at its exact sampling params.

Inputs
  - art-lab/noto_library_curated.json : {name -> emoji char}, the common library.
                                        Baked at the LIBRARY params (46x26).
  - art-lab/rares.json (OPTIONAL)     : the pinned rare compositions. Each rare
                                        pins its OWN sampling params (e.g. the
                                        Alice rabbit = U+1F430 at 44x21). If this
                                        file is absent, rares are skipped with a
                                        notice — this script will NOT invent
                                        frozen params for a rare.

Outputs (under lib/nft-art/masks/)
  - library.json : all curated subjects at library params.
  - rares.json   : the pinned rares (only if art-lab/rares.json is present).

Cell encoding: each filled cell (x,y) on the 64x32 grid is packed as a single
int v = y*64 + x  (0..2047). TS unpacks as x = v % 64, y = v // 64. Cells are
sorted ascending for stable, reviewable diffs.

Run: python3 bake_masks.py
"""
import json, os, sys
import PIL
from PIL import Image, ImageDraw, ImageFont

# Import the mask sampler from the existing, approved generators. Importing does
# NOT run their __main__ (which would need the Linux DejaVu text font); we only
# borrow the pure Noto-sampling function and its constants.
import noto1
from glyphgen1 import W, H

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, '..', 'lib', 'nft-art', 'masks'))

# The LIBRARY sampling params — the defaults baked into glyph_mask_centered.
# These are the frozen params for every common (non-rare) subject.
LIB_MAX_COLS = 46
LIB_MAX_ROWS = 26
THRESHOLD = 110        # cell-center average brightness cutoff (see noto1)
RENDER_PX = 560        # glyph render size before thresholding


# ---------------------------------------------------------------- tofu guard
# NotoEmoji.ttf does not cover every codepoint in the curated list; a missing
# glyph renders as the font's .notdef box (a hollow rectangle). Baking that
# yields a "tofu" mask, so ~1 in 3 blind reveals would show a blank box instead
# of art. We skip any glyph whose rendered bitmap is byte-identical to .notdef,
# using a Private-Use codepoint (guaranteed absent) as the reference box.
_TOFU_FONT = ImageFont.truetype(noto1.NOTO, 100)


def _glyph_bytes(char):
    im = Image.new('L', (160, 160), 0)
    ImageDraw.Draw(im).text((20, 20), char, font=_TOFU_FONT, fill=255)
    return im.tobytes()


_NOTDEF = _glyph_bytes('\ue123')  # Private-Use Area -> the .notdef box


def is_tofu(char):
    return _glyph_bytes(char) == _NOTDEF


def pack(cells):
    """Pack a set of (x,y) grid cells into a sorted list of ints y*W + x."""
    return sorted(y * W + x for (x, y) in cells)


def bbox_of(cells):
    if not cells:
        return None
    xs = [x for (x, _) in cells]
    ys = [y for (_, y) in cells]
    return [min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1]


def bake_one(char, max_cols, max_rows):
    """Return (packed_cells, bbox) for a single glyph at the given params."""
    mask = noto1.glyph_mask_centered(char, max_cols=max_cols, max_rows=max_rows)
    return pack(mask), bbox_of(mask)


def bake_library():
    src = os.path.join(HERE, 'noto_library_curated.json')
    lib = json.load(open(src, encoding='utf-8'))
    masks = {}
    empty = []
    tofu = []
    for name in sorted(lib):
        char = lib[name]
        if is_tofu(char):
            tofu.append(name)
            continue
        cells, bbox = bake_one(char, LIB_MAX_COLS, LIB_MAX_ROWS)
        if not cells:
            empty.append(name)
            continue
        masks[name] = {'char': char, 'bbox': bbox, 'cells': cells}
    meta = {
        'generator': 'art-lab/bake_masks.py',
        'source': 'noto_library_curated.json',
        'font': 'NotoEmoji.ttf',
        'grid': [W, H],
        'sampling': {
            'max_cols': LIB_MAX_COLS,
            'max_rows': LIB_MAX_ROWS,
            'threshold': THRESHOLD,
            'render_px': RENDER_PX,
        },
        'cell_encoding': 'int v = y*%d + x; x = v %% %d, y = v // %d' % (W, W, W),
        'pillow': PIL.__version__,
        'count': len(masks),
    }
    return {'meta': meta, 'masks': masks}, empty, tofu


def bake_rares():
    """Bake the pinned rares IF a manifest exists. Never fabricate params.

    art-lab/rares.json schema (each rare pins its own sampling params):
      { "firstline_rabbit": { "char": "\ud83d\udc30",
                               "max_cols": 44, "max_rows": 21 }, ... }
    """
    src = os.path.join(HERE, 'rares.json')
    if not os.path.exists(src):
        return None
    spec = json.load(open(src, encoding='utf-8'))
    masks = {}
    for name in sorted(spec):
        r = spec[name]
        cells, bbox = bake_one(r['char'], r['max_cols'], r['max_rows'])
        masks[name] = {
            'char': r['char'],
            'max_cols': r['max_cols'],
            'max_rows': r['max_rows'],
            'bbox': bbox,
            'cells': cells,
        }
    meta = {
        'generator': 'art-lab/bake_masks.py',
        'source': 'rares.json',
        'font': 'NotoEmoji.ttf',
        'grid': [W, H],
        'threshold': THRESHOLD,
        'render_px': RENDER_PX,
        'cell_encoding': 'int v = y*%d + x' % W,
        'pillow': PIL.__version__,
        'count': len(masks),
    }
    return {'meta': meta, 'masks': masks}


def write_json(path, obj):
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(',', ':'))
        fh.write('\n')


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    library, empty, tofu = bake_library()
    lib_path = os.path.join(OUT_DIR, 'library.json')
    write_json(lib_path, library)
    print('wrote %s (%d masks, %d cells total)' % (
        os.path.relpath(lib_path), library['meta']['count'],
        sum(len(m['cells']) for m in library['masks'].values())))
    if tofu:
        print('  skipped %d tofu (not in NotoEmoji.ttf): %s%s' % (
            len(tofu), ', '.join(tofu[:8]), ' ...' if len(tofu) > 8 else ''))
    if empty:
        print('  skipped %d empty-mask subjects: %s%s' % (
            len(empty), ', '.join(empty[:8]), ' ...' if len(empty) > 8 else ''))

    rares = bake_rares()
    if rares is None:
        print('rares: art-lab/rares.json not found -> skipped '
              '(no frozen rare params will be invented).')
    else:
        rares_path = os.path.join(OUT_DIR, 'rares.json')
        write_json(rares_path, rares)
        print('wrote %s (%d rare masks)' % (
            os.path.relpath(rares_path), rares['meta']['count']))


if __name__ == '__main__':
    sys.exit(main())
